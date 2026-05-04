import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Internal Elo engine for the AI Betting Bot.
 *
 * Why: ESPN's free API gives PPG/FG%/etc. but no power ratings (Elo,
 * KenPom, EPA). The 16%-weight "Power ratings & advanced metrics" prompt
 * factor was the worst-served. Computing our own Elo from historical
 * results we already see costs nothing and gets sharper every game.
 *
 * Persistence: ratings live in `elo_ratings` (sport, team_id) → rating.
 * The settlement loop calls `recordEloFromResult` whenever a tracked bet
 * settles, so the rating drifts toward truth without any cron.
 *
 * Degrades silently: when the Supabase table doesn't exist (or the env
 * vars aren't set), every read returns null and writes are no-ops — the
 * bot just operates without the Elo block, exactly like today.
 */

const STARTING_RATING = 1500;

/** K-factor per sport — bigger K = ratings move faster per game.
 *  Tuned roughly to 538 / FiveThirtyEight published values. */
const SPORT_K: Record<string, number> = {
  "basketball/nba": 20,
  "basketball/wnba": 22,
  "basketball/mens-college-basketball": 30,
  "football/nfl": 24,
  "football/college-football": 26,
  "hockey/nhl": 18,
  "baseball/mlb": 8,
  "soccer/usa.1": 32,
  "soccer/eng.1": 32,
  "soccer/esp.1": 32,
  "soccer/ita.1": 32,
  "soccer/ger.1": 32,
  "soccer/fra.1": 32,
  "soccer/uefa.champions": 28,
  "soccer/uefa.europa": 28,
  "soccer/eng.fa": 32,
  // Euroleague (not an ESPN path; we key it explicitly when we call in)
  "basketball/euroleague": 28,
};

/** Home advantage in Elo points per sport (added to the home team's rating
 *  when computing expected score). */
const SPORT_HOME_ADVANTAGE: Record<string, number> = {
  "basketball/nba": 90,
  "basketball/wnba": 70,
  "basketball/mens-college-basketball": 110,
  "football/nfl": 55,
  "football/college-football": 65,
  "hockey/nhl": 50,
  "baseball/mlb": 24,
  "soccer/usa.1": 60,
  "soccer/eng.1": 65,
  "soccer/esp.1": 65,
  "soccer/ita.1": 60,
  "soccer/ger.1": 60,
  "soccer/fra.1": 60,
  "soccer/uefa.champions": 55,
  "soccer/uefa.europa": 55,
  "soccer/eng.fa": 65,
  "basketball/euroleague": 80,
};

function k(sport: string): number {
  return SPORT_K[sport] ?? 22;
}

function homeAdv(sport: string): number {
  return SPORT_HOME_ADVANTAGE[sport] ?? 50;
}

/** Win probability from rating gap (with +/- 400 mapping to 10x odds). */
export function eloWinProbability(
  homeRating: number,
  awayRating: number,
  sport: string,
): number {
  const diff = homeRating + homeAdv(sport) - awayRating;
  return 1 / (1 + Math.pow(10, -diff / 400));
}

function admin() {
  return supabaseAdmin as unknown as {
    from: (t: string) => any;
  };
}

interface EloRow {
  sport: string;
  team_id: string;
  rating: number;
  games_count: number;
  last_game_at: string | null;
}

export async function getEloRatings(
  sport: string,
  teamIds: string[],
): Promise<Map<string, EloRow>> {
  const out = new Map<string, EloRow>();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return out;
  if (teamIds.length === 0) return out;
  try {
    const { data, error } = await admin()
      .from("elo_ratings")
      .select("sport, team_id, rating, games_count, last_game_at")
      .eq("sport", sport)
      .in("team_id", teamIds);
    if (error || !Array.isArray(data)) return out;
    for (const row of data as EloRow[]) {
      out.set(row.team_id, {
        sport: row.sport,
        team_id: row.team_id,
        rating: Number(row.rating) || STARTING_RATING,
        games_count: Number(row.games_count) || 0,
        last_game_at: row.last_game_at ?? null,
      });
    }
  } catch {
    // table missing or auth failure — return empty map, the caller will
    // treat it as "no Elo data yet".
  }
  return out;
}

export async function getElo(
  sport: string,
  teamId: string,
): Promise<EloRow | null> {
  const m = await getEloRatings(sport, [teamId]);
  return m.get(teamId) ?? null;
}

/**
 * Update both teams' ratings after a completed game. Margin-of-victory
 * multiplier (538 style) softens blowouts so a 30-point win doesn't
 * over-credit a team beyond what the matchup suggests.
 */
export async function recordEloFromResult(input: {
  sport: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  gameDate?: string | null;
}): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  if (!input.homeTeamId || !input.awayTeamId) return;
  if (!Number.isFinite(input.homeScore) || !Number.isFinite(input.awayScore)) {
    return;
  }

  try {
    const map = await getEloRatings(input.sport, [
      input.homeTeamId,
      input.awayTeamId,
    ]);
    const homeRow = map.get(input.homeTeamId);
    const awayRow = map.get(input.awayTeamId);
    const homeRating = homeRow?.rating ?? STARTING_RATING;
    const awayRating = awayRow?.rating ?? STARTING_RATING;

    const expectedHome = eloWinProbability(homeRating, awayRating, input.sport);
    const expectedAway = 1 - expectedHome;

    let actualHome: number;
    if (input.homeScore > input.awayScore) actualHome = 1;
    else if (input.homeScore < input.awayScore) actualHome = 0;
    else actualHome = 0.5;
    const actualAway = 1 - actualHome;

    // Margin-of-victory multiplier (538). Anchored so 1-pt wins ≈ 1.0 and
    // 20-pt blowouts ≈ 1.5–2x depending on rating gap.
    const margin = Math.abs(input.homeScore - input.awayScore);
    const ratingDiff = Math.abs(homeRating + homeAdv(input.sport) - awayRating);
    const movMult = Math.log(margin + 1) * (2.2 / (ratingDiff * 0.001 + 2.2));
    const adjustedK = k(input.sport) * Math.max(0.6, Math.min(2.5, movMult || 1));

    const newHome = homeRating + adjustedK * (actualHome - expectedHome);
    const newAway = awayRating + adjustedK * (actualAway - expectedAway);

    const ts = input.gameDate
      ? new Date(input.gameDate).toISOString()
      : new Date().toISOString();

    await Promise.all([
      admin()
        .from("elo_ratings")
        .upsert(
          {
            sport: input.sport,
            team_id: input.homeTeamId,
            rating: Number(newHome.toFixed(2)),
            games_count: (homeRow?.games_count ?? 0) + 1,
            last_game_at: ts,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "sport,team_id" },
        ),
      admin()
        .from("elo_ratings")
        .upsert(
          {
            sport: input.sport,
            team_id: input.awayTeamId,
            rating: Number(newAway.toFixed(2)),
            games_count: (awayRow?.games_count ?? 0) + 1,
            last_game_at: ts,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "sport,team_id" },
        ),
    ]);
  } catch {
    // best-effort; swallow
  }
}

/**
 * Bulk-feed historical results into the Elo table. Useful for the
 * one-time bootstrap when a sport has no rows yet — feed it a chronological
 * list of completed games and it will produce sensible ratings.
 */
export async function recordEloBatch(
  sport: string,
  games: Array<{
    homeTeamId: string;
    awayTeamId: string;
    homeScore: number;
    awayScore: number;
    gameDate?: string | null;
  }>,
): Promise<void> {
  // Sort oldest-first so each subsequent game uses up-to-date ratings.
  const sorted = [...games].sort((a, b) => {
    const ta = a.gameDate ? Date.parse(a.gameDate) : 0;
    const tb = b.gameDate ? Date.parse(b.gameDate) : 0;
    return ta - tb;
  });
  for (const g of sorted) {
    await recordEloFromResult({ sport, ...g });
  }
}
