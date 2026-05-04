import { NextRequest, NextResponse } from "next/server";
import { runBacktest, type BacktestGame } from "@/lib/backtest";
import { sportFromHint } from "@/lib/sports-data";

/**
 * GET /api/projects/ai-betting-bot/backtest?sport=<label>&days=<n>
 *
 * Runs a walk-forward Elo backtest over the last `days` of completed
 * fixtures for the given sport. Designed to answer one question fast:
 * does the engine show calibrated, better-than-coin-flip probabilities
 * on this sport?
 *
 * Sources:
 *   - top-5 soccer (EPL / La Liga / Serie A / Bundesliga / Ligue 1):
 *     api-football /fixtures (needs API_FOOTBALL_KEY or RAPIDAPI_KEY)
 *   - other sports: ESPN scoreboard (no key needed) walked day-by-day
 *
 * Defaults to 90 days. Capped at 365 to keep latency reasonable.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

interface EspnEvent {
  date?: string;
  status?: { type?: { completed?: boolean; state?: string; name?: string } };
  competitions?: Array<{
    competitors?: Array<{
      homeAway?: string;
      team?: { id?: string | number };
      score?: string | number;
    }>;
  }>;
}

function isCompleted(ev: EspnEvent): boolean {
  const t = ev.status?.type;
  if (!t) return false;
  if (t.completed === true) return true;
  if (t.state === "post") return true;
  const n = t.name ?? "";
  return (
    n === "STATUS_FINAL" ||
    n === "STATUS_FULL_TIME" ||
    n === "STATUS_AFTER_PENALTIES" ||
    n === "STATUS_AFTER_EXTRA_TIME"
  );
}

async function fetchEspnGames(
  sportPath: string,
  days: number,
): Promise<BacktestGame[]> {
  const out: BacktestGame[] = [];
  const today = new Date();
  // Walk one week at a time to avoid hammering ESPN.
  for (let i = 0; i < days; i += 7) {
    const start = new Date(today);
    start.setDate(start.getDate() - days + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const range = `${ymd(start)}-${ymd(end)}`;
    try {
      const res = await fetch(
        `${ESPN_BASE}/${sportPath}/scoreboard?dates=${range}&limit=400`,
        { signal: AbortSignal.timeout(12_000) },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { events?: EspnEvent[] };
      for (const ev of data.events ?? []) {
        if (!isCompleted(ev)) continue;
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const home = comp.competitors?.find((c) => c.homeAway === "home");
        const away = comp.competitors?.find((c) => c.homeAway === "away");
        if (!home?.team?.id || !away?.team?.id) continue;
        const hs = home.score != null ? Number(home.score) : NaN;
        const as = away.score != null ? Number(away.score) : NaN;
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        out.push({
          date: ev.date ?? "",
          homeId: String(home.team.id),
          awayId: String(away.team.id),
          homeScore: hs,
          awayScore: as,
        });
      }
    } catch {
      // skip the week, keep going
    }
  }
  return out;
}

interface AfFixture {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  teams?: { home?: { id?: number }; away?: { id?: number } };
  goals?: { home?: number | null; away?: number | null };
}

const AF_LEAGUE_ID: Record<string, number> = {
  "soccer/eng.1": 39,
  "soccer/esp.1": 140,
  "soccer/ita.1": 135,
  "soccer/ger.1": 78,
  "soccer/fra.1": 61,
};

function apiFootballAuth(): { base: string; headers: Record<string, string> } | null {
  const direct = process.env.API_FOOTBALL_KEY;
  if (direct) {
    return {
      base: "https://v3.football.api-sports.io",
      headers: { "x-apisports-key": direct, Accept: "application/json" },
    };
  }
  const rapid = process.env.RAPIDAPI_KEY;
  if (rapid) {
    return {
      base: "https://api-football-v1.p.rapidapi.com/v3",
      headers: {
        "x-rapidapi-key": rapid,
        "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
        Accept: "application/json",
      },
    };
  }
  return null;
}

async function fetchApiFootballGames(
  sportPath: string,
  seasons: number[],
): Promise<BacktestGame[]> {
  const cfg = apiFootballAuth();
  const leagueId = AF_LEAGUE_ID[sportPath];
  if (!cfg || !leagueId) return [];
  const out: BacktestGame[] = [];
  for (const season of seasons) {
    try {
      const res = await fetch(
        `${cfg.base}/fixtures?league=${leagueId}&season=${season}&status=FT-AET-PEN`,
        { headers: cfg.headers, signal: AbortSignal.timeout(12_000) },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { response?: AfFixture[] };
      for (const fx of data.response ?? []) {
        const short = fx.fixture?.status?.short ?? "";
        if (!["FT", "AET", "PEN"].includes(short)) continue;
        const hId = fx.teams?.home?.id;
        const aId = fx.teams?.away?.id;
        const hs = fx.goals?.home;
        const as = fx.goals?.away;
        if (
          hId == null ||
          aId == null ||
          hs == null ||
          as == null ||
          !fx.fixture?.date
        ) {
          continue;
        }
        out.push({
          date: fx.fixture.date,
          homeId: String(hId),
          awayId: String(aId),
          homeScore: hs,
          awayScore: as,
        });
      }
    } catch {
      // try next season
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const sportLabel = params.get("sport") ?? "EPL";
  const daysParam = Number(params.get("days") ?? "90");
  const days = Math.min(365, Math.max(7, Number.isFinite(daysParam) ? daysParam : 90));

  const sport = sportFromHint(sportLabel);
  if (!sport) {
    return NextResponse.json(
      { error: `Unknown sport: ${sportLabel}` },
      { status: 400 },
    );
  }

  // Soccer top-5 → api-football (richer historical coverage).
  // Everything else → ESPN scoreboard.
  let games: BacktestGame[] = [];
  let source = "";
  if (AF_LEAGUE_ID[sport.path]) {
    const now = new Date();
    const currentSeason = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    const seasons = days > 200 ? [currentSeason, currentSeason - 1] : [currentSeason];
    games = await fetchApiFootballGames(sport.path, seasons);
    source = "api-football";
    if (games.length === 0) {
      games = await fetchEspnGames(sport.path, days);
      source = "espn (api-football empty / unconfigured)";
    }
  } else {
    games = await fetchEspnGames(sport.path, days);
    source = "espn";
  }

  if (games.length === 0) {
    return NextResponse.json(
      {
        error:
          "No completed games returned. Check API_FOOTBALL_KEY for soccer, otherwise ESPN may be off-season.",
        sport: sport.label,
        source,
        days,
      },
      { status: 404 },
    );
  }

  const result = runBacktest(games, { sport: sport.path, warmupGamesPerTeam: 5 });
  return NextResponse.json({
    sport: sport.label,
    sportPath: sport.path,
    source,
    requestedDays: days,
    gamesIngested: games.length,
    ...result,
  });
}
