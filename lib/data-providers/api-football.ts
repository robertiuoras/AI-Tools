import "server-only";
import type {
  BettingHeadToHeadGame,
  BettingLineupPlayer,
  BettingProviderPrediction,
  BettingRealDataPlayer,
} from "@/lib/betting-bot";
import type { EspnPastGame } from "@/lib/sports-data";
import { cached, SPORTS_CACHE_TTL } from "@/lib/sports-cache";

/**
 * API-Football. Free tier is 100 requests/day, plenty with our cache layer.
 *
 * Two auth modes — set whichever env var you have:
 *   - API_FOOTBALL_KEY   (direct sign-up at api-football.com)
 *     → host v3.football.api-sports.io, header x-apisports-key
 *   - RAPIDAPI_KEY       (RapidAPI marketplace)
 *     → host api-football-v1.p.rapidapi.com, header x-rapidapi-key
 *
 * If neither is set, every export here returns null/[] and the caller
 * falls through to the next provider in the chain.
 *
 * Endpoints we use (same paths under both hosts):
 *   - /teams                  → resolve team id from name
 *   - /fixtures/headtohead    → multi-season H2H
 *   - /fixtures/lineups       → confirmed/predicted lineups
 *   - /injuries               → team injury list
 *   - /predictions            → home/draw/away win probabilities
 */

interface AuthConfig {
  base: string;
  headers: Record<string, string>;
}

function authConfig(): AuthConfig | null {
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

async function get<T>(path: string): Promise<T | null> {
  const cfg = authConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.base}${path}`, {
      headers: cfg.headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface AfTeam {
  team?: { id?: number; name?: string; logo?: string };
}
interface AfFixture {
  fixture?: { id?: number; date?: string; venue?: { name?: string }; status?: { short?: string } };
  league?: { season?: number };
  teams?: {
    home?: { id?: number; name?: string; logo?: string; winner?: boolean | null };
    away?: { id?: number; name?: string; logo?: string; winner?: boolean | null };
  };
  goals?: { home?: number | null; away?: number | null };
}
interface AfInjuryItem {
  player?: { name?: string; position?: string };
  fixture?: { date?: string };
  type?: string;
  reason?: string;
}
interface AfLineupItem {
  startXI?: Array<{ player?: { name?: string; pos?: string; number?: number } }>;
  substitutes?: Array<{ player?: { name?: string; pos?: string; number?: number } }>;
}
interface AfPredictionItem {
  predictions?: {
    percent?: { home?: string; draw?: string; away?: string };
    advice?: string;
  };
}

function normalizeTeamName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|ac|sc|afc|cfc|club|de)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBestTeamId(rows: AfTeam[], queryName: string): number | null {
  if (!rows.length) return null;
  const q = normalizeTeamName(queryName);
  let bestId: number | null = null;
  let bestScore = -1;

  for (const row of rows) {
    const id = row.team?.id;
    const name = row.team?.name ?? "";
    if (typeof id !== "number" || !name) continue;
    const n = normalizeTeamName(name);
    if (!n) continue;

    let score = 0;
    if (n === q) score += 100;
    if (n.includes(q) || q.includes(n)) score += 30;

    const qTokens = q.split(" ").filter(Boolean);
    const nTokens = n.split(" ").filter(Boolean);
    const overlap = qTokens.filter((t) => nTokens.includes(t)).length;
    score += overlap * 5;

    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  return bestId ?? rows[0]?.team?.id ?? null;
}

/**
 * api-football labels each season by its start year. La Liga 2024-25 is
 * `season=2024`, EPL 2025-26 is `season=2025`. So in May we still want
 * the previous calendar year. Pass this everywhere we need a season param.
 */
function currentSoccerSeason(): number {
  const now = new Date();
  // European seasons start in August. Months 0-6 (Jan-Jul) are inside the
  // season that started the previous calendar year.
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

async function resolveTeamId(name: string): Promise<number | null> {
  if (!name) return null;
  return cached(
    `apifootball:team-id:${name.toLowerCase()}`,
    SPORTS_CACHE_TTL.teamStats,
    async () => {
      const data = await get<{ response?: AfTeam[] }>(
        `/teams?search=${encodeURIComponent(name)}`,
      );
      const directRows = data?.response ?? [];
      const directBest = pickBestTeamId(directRows, name);
      if (directBest) return directBest;

      const asciiName = name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
      if (asciiName && asciiName.toLowerCase() !== name.toLowerCase()) {
        const retry = await get<{ response?: AfTeam[] }>(
          `/teams?search=${encodeURIComponent(asciiName)}`,
        );
        const retryRows = retry?.response ?? [];
        const retryBest = pickBestTeamId(retryRows, name);
        if (retryBest) return retryBest;
      }

      return null;
    },
  );
}

export async function apiFootballHeadToHead(
  homeTeamName: string,
  awayTeamName: string,
): Promise<BettingHeadToHeadGame[]> {
  if (!authConfig()) return [];
  const [hId, aId] = await Promise.all([
    resolveTeamId(homeTeamName),
    resolveTeamId(awayTeamName),
  ]);
  if (!hId || !aId) return [];
  const key = `apifootball:h2h:${hId}-${aId}`;
  return cached(key, SPORTS_CACHE_TTL.h2h, async () => {
    const data = await get<{ response?: AfFixture[] }>(
      `/fixtures/headtohead?h2h=${hId}-${aId}&last=10`,
    );
    const rows = data?.response ?? [];
    return rows
      .map((fx): BettingHeadToHeadGame | null => {
        const home = fx.teams?.home?.name ?? "";
        const away = fx.teams?.away?.name ?? "";
        const date = fx.fixture?.date ?? "";
        if (!home || !away || !date) return null;
        const h = fx.goals?.home ?? null;
        const a = fx.goals?.away ?? null;
        return {
          date,
          season: fx.league?.season != null ? String(fx.league.season) : null,
          homeTeam: home,
          awayTeam: away,
          homeScore: h,
          awayScore: a,
          winner:
            h == null || a == null
              ? null
              : h > a
                ? "home"
                : h < a
                  ? "away"
                  : "tie",
          venue: fx.fixture?.venue?.name ?? null,
        };
      })
      .filter((g): g is BettingHeadToHeadGame => g !== null);
  });
}

export async function apiFootballInjuries(
  teamName: string,
): Promise<BettingRealDataPlayer[]> {
  if (!authConfig()) return [];
  const id = await resolveTeamId(teamName);
  if (!id) return [];
  return cached(
    `apifootball:injuries:${id}`,
    SPORTS_CACHE_TTL.injuries,
    async () => {
      const data = await get<{ response?: AfInjuryItem[] }>(
        `/injuries?team=${id}&season=${currentSoccerSeason()}`,
      );
      const rows = data?.response ?? [];
      const seen = new Set<string>();
      const out: BettingRealDataPlayer[] = [];
      for (const r of rows) {
        const name = r.player?.name ?? "";
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({
          name,
          position: r.player?.position ?? null,
          status: r.type ?? "Unknown",
          detail: r.reason ?? "",
          headshot: null,
        });
      }
      return out.slice(0, 30);
    },
  );
}

export async function apiFootballLineupForFixture(
  homeTeamName: string,
  awayTeamName: string,
  kickoffIso: string | null,
): Promise<{ home: BettingLineupPlayer[]; away: BettingLineupPlayer[] } | null> {
  if (!authConfig()) return null;
  const [hId, aId] = await Promise.all([
    resolveTeamId(homeTeamName),
    resolveTeamId(awayTeamName),
  ]);
  if (!hId || !aId) return null;
  const dateKey = (kickoffIso ?? "").slice(0, 10);
  return cached(
    `apifootball:lineup:${hId}-${aId}:${dateKey}`,
    SPORTS_CACHE_TTL.lineups,
    async () => {
      const fixtures = await get<{ response?: AfFixture[] }>(
        `/fixtures/headtohead?h2h=${hId}-${aId}&next=1`,
      );
      const fxId = fixtures?.response?.[0]?.fixture?.id;
      if (!fxId) return null;
      const data = await get<{ response?: AfLineupItem[] }>(
        `/fixtures/lineups?fixture=${fxId}`,
      );
      const rows = data?.response ?? [];
      const toPlayers = (
        items: NonNullable<AfLineupItem["startXI"]>,
        status: string,
      ): BettingLineupPlayer[] =>
        items.map((i) => ({
          name: i.player?.name ?? "",
          position: i.player?.pos ?? null,
          status,
          number: i.player?.number ?? null,
        }));
      const home: BettingLineupPlayer[] = [];
      const away: BettingLineupPlayer[] = [];
      if (rows[0]) {
        home.push(...toPlayers(rows[0].startXI ?? [], "starter"));
        home.push(...toPlayers(rows[0].substitutes ?? [], "bench"));
      }
      if (rows[1]) {
        away.push(...toPlayers(rows[1].startXI ?? [], "starter"));
        away.push(...toPlayers(rows[1].substitutes ?? [], "bench"));
      }
      if (home.length === 0 && away.length === 0) return null;
      return { home, away };
    },
  );
}

export async function apiFootballPrediction(
  homeTeamName: string,
  awayTeamName: string,
): Promise<BettingProviderPrediction | null> {
  if (!authConfig()) return null;
  const [hId, aId] = await Promise.all([
    resolveTeamId(homeTeamName),
    resolveTeamId(awayTeamName),
  ]);
  if (!hId || !aId) return null;
  return cached(
    `apifootball:prediction:${hId}-${aId}`,
    SPORTS_CACHE_TTL.predictions,
    async () => {
      const fixtures = await get<{ response?: AfFixture[] }>(
        `/fixtures/headtohead?h2h=${hId}-${aId}&next=1`,
      );
      const fxId = fixtures?.response?.[0]?.fixture?.id;
      if (!fxId) return null;
      const data = await get<{ response?: AfPredictionItem[] }>(
        `/predictions?fixture=${fxId}`,
      );
      const p = data?.response?.[0]?.predictions;
      if (!p) return null;
      const num = (s: string | undefined): number | null => {
        if (!s) return null;
        const n = Number.parseFloat(s.replace("%", ""));
        return Number.isFinite(n) ? n : null;
      };
      return {
        source: "api-football",
        homeWinPct: num(p.percent?.home),
        drawPct: num(p.percent?.draw),
        awayWinPct: num(p.percent?.away),
        advice: p.advice ?? null,
      };
    },
  );
}

/**
 * Last `limit` completed fixtures for a team — used as a soccer fallback
 * when ESPN's schedule endpoint comes back empty (which it often does
 * for European leagues). Returns the same EspnPastGame shape so the
 * existing form / streak / margin helpers work without translation.
 */
export async function apiFootballRecentGames(
  teamName: string,
  limit = 10,
): Promise<EspnPastGame[]> {
  if (!authConfig()) return [];
  const id = await resolveTeamId(teamName);
  if (!id) return [];
  return cached(
    `apifootball:recent:${id}:${limit}`,
    SPORTS_CACHE_TTL.schedule,
    async () => {
      const data = await get<{ response?: AfFixture[] }>(
        `/fixtures?team=${id}&last=${limit}`,
      );
      const rows = data?.response ?? [];
      const out: EspnPastGame[] = [];
      for (const fx of rows) {
        const home = fx.teams?.home;
        const away = fx.teams?.away;
        const date = fx.fixture?.date ?? "";
        if (!home || !away || !date) continue;
        // Only count completed games — short codes: FT (full time),
        // AET (after extra time), PEN (after penalties).
        const short = fx.fixture?.status?.short ?? "";
        if (!["FT", "AET", "PEN"].includes(short)) continue;
        const isHome = home.id === id;
        const me = isHome ? home : away;
        const opp = isHome ? away : home;
        const myScore = (isHome ? fx.goals?.home : fx.goals?.away) ?? null;
        const oppScore = (isHome ? fx.goals?.away : fx.goals?.home) ?? null;
        const wonFlag = me.winner;
        const result: "W" | "L" | "T" | null =
          wonFlag === true
            ? "W"
            : wonFlag === false
              ? "L"
              : myScore != null && oppScore != null
                ? myScore > oppScore
                  ? "W"
                  : myScore < oppScore
                    ? "L"
                    : "T"
                : null;
        out.push({
          id: String(fx.fixture?.id ?? ""),
          date,
          opponent: {
            id: String(opp.id ?? ""),
            displayName: opp.name ?? "",
            abbreviation: (opp.name ?? "").slice(0, 3).toUpperCase(),
            logo: opp.logo ?? null,
          },
          homeAway: isHome ? "home" : "away",
          teamScore: myScore,
          oppScore,
          result,
        });
      }
      return out;
    },
  );
}
