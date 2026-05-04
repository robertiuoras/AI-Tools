import "server-only";
import type { BettingHeadToHeadGame } from "@/lib/betting-bot";
import { cached, SPORTS_CACHE_TTL } from "@/lib/sports-cache";

/**
 * Euroleague Basketball — official live-stats JSON feed (api-live.euroleague.net).
 * Free, no API key. Used for H2H lookups; ESPN doesn't cover Euroleague.
 *
 * Endpoint shapes are best-effort — if the feed shape changes upstream,
 * we silently return [] and the bot just operates without Euroleague H2H.
 */

const BASE = "https://api-live.euroleague.net/v1";

interface ElGame {
  date?: string;
  hometeam?: string;
  awayteam?: string;
  homescore?: number | null;
  awayscore?: number | null;
  played?: boolean;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function nameMatch(a: string, b: string): boolean {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  return na === nb || na.includes(nb) || nb.includes(na);
}

export async function euroleagueH2H(
  homeTeamName: string,
  awayTeamName: string,
): Promise<BettingHeadToHeadGame[]> {
  if (!homeTeamName || !awayTeamName) return [];
  return cached(
    `el:h2h:${homeTeamName.toLowerCase()}|${awayTeamName.toLowerCase()}`,
    SPORTS_CACHE_TTL.h2h,
    async () => {
      // Pull current + previous season results, filter for the matchup.
      const seasonNow = currentEuroleagueSeason();
      const seasons = [seasonNow, seasonNow - 1];
      const all: BettingHeadToHeadGame[] = [];
      for (const season of seasons) {
        const data = await get<{ game?: ElGame[] }>(
          `/results?seasonCode=E${season}`,
        );
        for (const g of data?.game ?? []) {
          if (!g.played) continue;
          const home = g.hometeam ?? "";
          const away = g.awayteam ?? "";
          if (!home || !away) continue;
          const isHvA = nameMatch(home, homeTeamName) && nameMatch(away, awayTeamName);
          const isAvH = nameMatch(home, awayTeamName) && nameMatch(away, homeTeamName);
          if (!isHvA && !isAvH) continue;
          const date = g.date ?? "";
          all.push({
            date: date ? `${date}T00:00:00Z` : "",
            season: String(season),
            homeTeam: home,
            awayTeam: away,
            homeScore: g.homescore ?? null,
            awayScore: g.awayscore ?? null,
            winner:
              g.homescore == null || g.awayscore == null
                ? null
                : g.homescore > g.awayscore
                  ? "home"
                  : g.homescore < g.awayscore
                    ? "away"
                    : "tie",
            venue: null,
          });
        }
      }
      all.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      return all.slice(0, 10);
    },
  );
}

function currentEuroleagueSeason(): number {
  // Euroleague seasons run Sept-May; before September the active season is
  // the previous calendar year (E2024 = 2024-25).
  const now = new Date();
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}
