import "server-only";
import type { BettingHeadToHeadGame } from "@/lib/betting-bot";
import { cached, SPORTS_CACHE_TTL } from "@/lib/sports-cache";

/**
 * TheSportsDB — free, no key required (public test key "3").
 *
 * Used as a universal fallback for venue metadata (incl. lat/lon for
 * the weather provider) and prior-season H2H lookups when the league-
 * specific provider misses. Returns null/[] on any failure.
 */

const BASE = "https://www.thesportsdb.com/api/v1/json/3";

interface SportsDBVenue {
  strVenue?: string | null;
  strCity?: string | null;
  strCountry?: string | null;
  strLocation?: string | null;
}

interface SportsDBTeam {
  idTeam?: string;
  strTeam?: string;
  strStadium?: string | null;
  strStadiumLocation?: string | null;
  strCountry?: string | null;
}

interface SportsDBEvent {
  dateEvent?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  strVenue?: string | null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Look up a team's stadium / location for the weather forecast. */
export async function sportsdbTeamVenue(
  teamName: string,
): Promise<{ venue: string | null; location: string | null; country: string | null } | null> {
  if (!teamName) return null;
  return cached(`sportsdb:team-venue:${teamName.toLowerCase()}`, SPORTS_CACHE_TTL.venue, async () => {
    const data = await getJson<{ teams?: SportsDBTeam[] }>(
      `${BASE}/searchteams.php?t=${encodeURIComponent(teamName)}`,
    );
    const team = data?.teams?.[0];
    if (!team) return null;
    return {
      venue: team.strStadium ?? null,
      location: team.strStadiumLocation ?? null,
      country: team.strCountry ?? null,
    };
  });
}

/** Last 5 H2H meetings (any season) between two teams. */
export async function sportsdbHeadToHead(
  homeTeamName: string,
  awayTeamName: string,
): Promise<BettingHeadToHeadGame[]> {
  if (!homeTeamName || !awayTeamName) return [];
  const key = `sportsdb:h2h:${homeTeamName.toLowerCase()}|${awayTeamName.toLowerCase()}`;
  return cached(key, SPORTS_CACHE_TTL.h2h, async () => {
    const home = await getJson<{ teams?: SportsDBTeam[] }>(
      `${BASE}/searchteams.php?t=${encodeURIComponent(homeTeamName)}`,
    );
    const away = await getJson<{ teams?: SportsDBTeam[] }>(
      `${BASE}/searchteams.php?t=${encodeURIComponent(awayTeamName)}`,
    );
    const homeId = home?.teams?.[0]?.idTeam;
    const awayId = away?.teams?.[0]?.idTeam;
    if (!homeId || !awayId) return [];
    const lastH = await getJson<{ results?: SportsDBEvent[] }>(
      `${BASE}/eventslast.php?id=${homeId}`,
    );
    const lastA = await getJson<{ results?: SportsDBEvent[] }>(
      `${BASE}/eventslast.php?id=${awayId}`,
    );
    const all = [...(lastH?.results ?? []), ...(lastA?.results ?? [])];
    const matchups = all.filter(
      (ev) =>
        ev.strHomeTeam &&
        ev.strAwayTeam &&
        ((ev.strHomeTeam.toLowerCase() === homeTeamName.toLowerCase() &&
          ev.strAwayTeam.toLowerCase() === awayTeamName.toLowerCase()) ||
          (ev.strHomeTeam.toLowerCase() === awayTeamName.toLowerCase() &&
            ev.strAwayTeam.toLowerCase() === homeTeamName.toLowerCase())),
    );
    const seen = new Set<string>();
    const games: BettingHeadToHeadGame[] = [];
    for (const ev of matchups) {
      const date = ev.dateEvent ?? "";
      const k = `${date}|${ev.strHomeTeam}|${ev.strAwayTeam}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const home = ev.intHomeScore != null ? Number(ev.intHomeScore) : null;
      const away = ev.intAwayScore != null ? Number(ev.intAwayScore) : null;
      games.push({
        date: date ? `${date}T00:00:00Z` : "",
        season: null,
        homeTeam: ev.strHomeTeam ?? "",
        awayTeam: ev.strAwayTeam ?? "",
        homeScore: home,
        awayScore: away,
        winner:
          home == null || away == null
            ? null
            : home > away
              ? "home"
              : home < away
                ? "away"
                : "tie",
        venue: ev.strVenue ?? null,
      });
    }
    games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return games.slice(0, 5);
  });
}
