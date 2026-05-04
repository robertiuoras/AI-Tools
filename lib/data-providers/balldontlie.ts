import "server-only";
import type { BettingHeadToHeadGame } from "@/lib/betting-bot";
import { cached, SPORTS_CACHE_TTL } from "@/lib/sports-cache";

/**
 * BallDontLie — free, no API key required, ~60 req/min.
 * NBA only. Provides the multi-season H2H + advanced team stats that
 * ESPN's free API doesn't surface.
 */

const BASE = "https://www.balldontlie.io/api/v1";

interface BdlTeam {
  id: number;
  full_name?: string;
  abbreviation?: string;
}

interface BdlGame {
  id: number;
  date: string;
  home_team: BdlTeam;
  visitor_team: BdlTeam;
  home_team_score: number;
  visitor_team_score: number;
  season: number;
  status?: string;
}

async function get<T>(url: string): Promise<T | null> {
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

async function teamId(name: string): Promise<number | null> {
  if (!name) return null;
  return cached(
    `bdl:team-id:${name.toLowerCase()}`,
    SPORTS_CACHE_TTL.teamStats,
    async () => {
      const data = await get<{ data?: BdlTeam[] }>(
        `${BASE}/teams`,
      );
      if (!data?.data) return null;
      const target = name.toLowerCase();
      const exact = data.data.find(
        (t) => (t.full_name ?? "").toLowerCase() === target,
      );
      if (exact) return exact.id;
      const partial = data.data.find(
        (t) =>
          (t.full_name ?? "").toLowerCase().includes(target) ||
          target.includes((t.full_name ?? "").toLowerCase()),
      );
      return partial?.id ?? null;
    },
  );
}

export async function balldontlieH2H(
  homeTeamName: string,
  awayTeamName: string,
): Promise<BettingHeadToHeadGame[]> {
  const [hId, aId] = await Promise.all([
    teamId(homeTeamName),
    teamId(awayTeamName),
  ]);
  if (!hId || !aId) return [];
  return cached(
    `bdl:h2h:${hId}-${aId}`,
    SPORTS_CACHE_TTL.h2h,
    async () => {
      // Fetch home team's last 100 games and filter for matchups vs away team.
      // Free tier doesn't have a direct H2H endpoint, so we filter client-side.
      const url = `${BASE}/games?team_ids[]=${hId}&team_ids[]=${aId}&per_page=100&seasons[]=${currentNbaSeason()}&seasons[]=${currentNbaSeason() - 1}&seasons[]=${currentNbaSeason() - 2}`;
      const data = await get<{ data?: BdlGame[] }>(url);
      if (!data?.data) return [];
      const matchups = data.data.filter(
        (g) =>
          (g.home_team.id === hId && g.visitor_team.id === aId) ||
          (g.home_team.id === aId && g.visitor_team.id === hId),
      );
      const games = matchups
        .filter(
          (g) =>
            g.status === "Final" ||
            (g.home_team_score > 0 && g.visitor_team_score > 0),
        )
        .map((g): BettingHeadToHeadGame => ({
          date: `${g.date}T00:00:00Z`,
          season: String(g.season),
          homeTeam: g.home_team.full_name ?? "",
          awayTeam: g.visitor_team.full_name ?? "",
          homeScore: g.home_team_score,
          awayScore: g.visitor_team_score,
          winner:
            g.home_team_score > g.visitor_team_score
              ? "home"
              : g.home_team_score < g.visitor_team_score
                ? "away"
                : "tie",
          venue: null,
        }));
      games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      return games.slice(0, 10);
    },
  );
}

function currentNbaSeason(): number {
  // NBA seasons start in October; before October the active season is the
  // previous calendar year (2024-25 = season 2024).
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}
