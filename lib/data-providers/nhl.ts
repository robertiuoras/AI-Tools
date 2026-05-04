import "server-only";
import type { BettingHeadToHeadGame } from "@/lib/betting-bot";
import { cached, SPORTS_CACHE_TTL } from "@/lib/sports-cache";

/**
 * NHL official public API (api-web.nhle.com). Free, no key.
 * Used for multi-season H2H lookups beyond ESPN's current-season window.
 */

const BASE = "https://api-web.nhle.com/v1";

interface NhlTeamRow {
  id?: number;
  abbrev?: string;
  name?: { default?: string };
  fullName?: string;
}

interface NhlGameRow {
  id?: number;
  gameDate?: string;
  homeTeam?: { id?: number; abbrev?: string; score?: number; commonName?: { default?: string } };
  awayTeam?: { id?: number; abbrev?: string; score?: number; commonName?: { default?: string } };
  venue?: { default?: string };
  gameState?: string;
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

async function teamAbbrev(name: string): Promise<string | null> {
  if (!name) return null;
  return cached(
    `nhl:team-abbrev:${name.toLowerCase()}`,
    SPORTS_CACHE_TTL.teamStats,
    async () => {
      const data = await get<{ teams?: NhlTeamRow[] }>(`/standings/now`);
      const teams = (data as any)?.standings ?? [];
      const target = name.toLowerCase();
      const exact = teams.find(
        (t: any) => (t.teamName?.default ?? "").toLowerCase() === target,
      );
      if (exact?.teamAbbrev?.default) return exact.teamAbbrev.default as string;
      const partial = teams.find(
        (t: any) =>
          (t.teamName?.default ?? "").toLowerCase().includes(target) ||
          target.includes((t.teamName?.default ?? "").toLowerCase()),
      );
      return partial?.teamAbbrev?.default ?? null;
    },
  );
}

export async function nhlHeadToHead(
  homeTeamName: string,
  awayTeamName: string,
): Promise<BettingHeadToHeadGame[]> {
  const [hAbbr, aAbbr] = await Promise.all([
    teamAbbrev(homeTeamName),
    teamAbbrev(awayTeamName),
  ]);
  if (!hAbbr || !aAbbr) return [];
  return cached(
    `nhl:h2h:${hAbbr}-${aAbbr}`,
    SPORTS_CACHE_TTL.h2h,
    async () => {
      // Pull both teams' season schedules across the last two seasons,
      // intersect by date+opponent to get H2H meetings.
      const seasons = currentNhlSeasons();
      const seen = new Set<string>();
      const games: BettingHeadToHeadGame[] = [];
      for (const season of seasons) {
        const data = await get<{ games?: NhlGameRow[] }>(
          `/club-schedule-season/${hAbbr}/${season}`,
        );
        for (const g of data?.games ?? []) {
          const opp =
            g.homeTeam?.abbrev === hAbbr
              ? g.awayTeam?.abbrev
              : g.homeTeam?.abbrev;
          if (opp !== aAbbr) continue;
          if (g.gameState && g.gameState !== "OFF" && g.gameState !== "FINAL") {
            continue;
          }
          const date = g.gameDate ?? "";
          if (!date || seen.has(date)) continue;
          seen.add(date);
          const home = g.homeTeam?.commonName?.default ?? g.homeTeam?.abbrev ?? "";
          const away = g.awayTeam?.commonName?.default ?? g.awayTeam?.abbrev ?? "";
          const hs = g.homeTeam?.score ?? null;
          const as = g.awayTeam?.score ?? null;
          games.push({
            date: `${date}T00:00:00Z`,
            season: String(season),
            homeTeam: home,
            awayTeam: away,
            homeScore: hs,
            awayScore: as,
            winner:
              hs == null || as == null
                ? null
                : hs > as
                  ? "home"
                  : hs < as
                    ? "away"
                    : "tie",
            venue: g.venue?.default ?? null,
          });
        }
      }
      games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      return games.slice(0, 10);
    },
  );
}

function currentNhlSeasons(): number[] {
  // Current and previous NHL season-id (e.g. 20242025).
  const now = new Date();
  const startYear =
    now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  const currentSeason = startYear * 10000 + (startYear + 1);
  const prevSeason = (startYear - 1) * 10000 + startYear;
  return [currentSeason, prevSeason];
}
