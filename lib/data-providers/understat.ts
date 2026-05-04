import "server-only";
import type { BettingTeamXg } from "@/lib/betting-bot";
import { cached, SPORTS_CACHE_TTL } from "@/lib/sports-cache";

/**
 * understat.com — free xG / xGA data for the top-5 European leagues.
 * No API; the league page embeds the season's per-team totals as a
 * JSON-encoded JavaScript variable (`var teamsData = JSON.parse('…');`).
 * We fetch the HTML, extract the variable, and JSON.parse it.
 *
 * Coverage: EPL, La Liga, Serie A, Bundesliga, Ligue 1.
 * Cache: 6 hours per league (xG totals barely move during the day).
 *
 * If understat changes its embed shape (rare), this returns null and the
 * bot operates without the xG block — like every other provider here.
 */

const LEAGUE_SLUG: Record<string, string> = {
  "soccer/eng.1": "EPL",
  "soccer/esp.1": "La_liga",
  "soccer/ita.1": "Serie_A",
  "soccer/ger.1": "Bundesliga",
  "soccer/fra.1": "Ligue_1",
};

interface UnderstatTeamRow {
  /** Per-match aggregate stats from the embedded `history` array. */
  history?: Array<{
    xG?: number | string;
    xGA?: number | string;
    scored?: number | string;
    missed?: number | string;
  }>;
  title?: string;
  id?: string | number;
}

type UnderstatTeams = Record<string, UnderstatTeamRow>;

function decodeJsonString(raw: string): string {
  // understat encodes the JSON string as escaped hex (e.g. \x22, \x5c).
  return raw.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function aggregate(history: NonNullable<UnderstatTeamRow["history"]>): BettingTeamXg | null {
  if (history.length === 0) return null;
  let xg = 0;
  let xga = 0;
  let goals = 0;
  let conceded = 0;
  for (const m of history) {
    xg += Number(m.xG ?? 0);
    xga += Number(m.xGA ?? 0);
    goals += Number(m.scored ?? 0);
    conceded += Number(m.missed ?? 0);
  }
  const matches = history.length;
  return {
    matches,
    xgPerMatch: Number((xg / matches).toFixed(3)),
    xgaPerMatch: Number((xga / matches).toFixed(3)),
    goalsPerMatch: Number((goals / matches).toFixed(3)),
    concededPerMatch: Number((conceded / matches).toFixed(3)),
  };
}

async function fetchLeagueTeams(
  leagueSlug: string,
  season: number,
): Promise<UnderstatTeams | null> {
  return cached(
    `understat:league:${leagueSlug}:${season}`,
    SPORTS_CACHE_TTL.teamStats,
    async () => {
      try {
        const res = await fetch(
          `https://understat.com/league/${leagueSlug}/${season}`,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; AI-Tools-Betting-Bot/1.0)",
              Accept: "text/html",
            },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!res.ok) return null;
        const html = await res.text();
        // The variable name is `teamsData`; payload is single-quoted with
        // hex escapes. Capture lazily up to the closing JSON.parse(' …').
        const m = html.match(
          /var\s+teamsData\s*=\s*JSON\.parse\(\s*'([^']+)'\s*\)/,
        );
        if (!m) return null;
        const decoded = decodeJsonString(m[1]!);
        const parsed = JSON.parse(decoded) as UnderstatTeams;
        return parsed;
      } catch {
        return null;
      }
    },
  );
}

function currentSeason(): number {
  const now = new Date();
  // Top-5 European leagues start in August.
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

function nameMatches(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\bfc\b|\bcf\b|\bclub\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

export async function understatTeamXg(
  sportPath: string,
  teamName: string,
): Promise<BettingTeamXg | null> {
  const slug = LEAGUE_SLUG[sportPath];
  if (!slug || !teamName) return null;
  const teams = await fetchLeagueTeams(slug, currentSeason());
  if (!teams) return null;
  // Find the matching team. understat keys by numeric id; team name is in `.title`.
  for (const row of Object.values(teams)) {
    const title = row.title ?? "";
    if (!title) continue;
    if (nameMatches(title, teamName)) {
      return aggregate(row.history ?? []);
    }
  }
  return null;
}
