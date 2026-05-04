import "server-only";
import type {
  BettingHeadToHeadGame,
  BettingLineupPlayer,
  BettingProviderPrediction,
  BettingRealDataPlayer,
} from "@/lib/betting-bot";
import { cached, SPORTS_CACHE_TTL } from "@/lib/sports-cache";

/**
 * API-Football via RapidAPI — free tier is 100 requests/day, which is
 * plenty when paired with the sports-cache layer. Keyed via the
 * RAPIDAPI_KEY env var; if it's missing, every export here returns null/[]
 * and the caller falls through to the next provider in the chain.
 *
 * Endpoints we use:
 *   - /teams                  → resolve team id from name
 *   - /fixtures/headtohead    → multi-season H2H
 *   - /fixtures/lineups       → confirmed/predicted lineups
 *   - /injuries               → team injury list
 *   - /predictions            → home/draw/away win probabilities
 */

const BASE = "https://api-football-v1.p.rapidapi.com/v3";

function headers(): Record<string, string> | null {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return null;
  return {
    "x-rapidapi-key": key,
    "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
    Accept: "application/json",
  };
}

async function get<T>(path: string): Promise<T | null> {
  const h = headers();
  if (!h) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: h,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface AfTeam {
  team?: { id?: number; name?: string };
}
interface AfFixture {
  fixture?: { id?: number; date?: string; venue?: { name?: string } };
  league?: { season?: number };
  teams?: {
    home?: { id?: number; name?: string };
    away?: { id?: number; name?: string };
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

async function resolveTeamId(name: string): Promise<number | null> {
  if (!name) return null;
  return cached(
    `apifootball:team-id:${name.toLowerCase()}`,
    SPORTS_CACHE_TTL.teamStats,
    async () => {
      const data = await get<{ response?: AfTeam[] }>(
        `/teams?search=${encodeURIComponent(name)}`,
      );
      const id = data?.response?.[0]?.team?.id;
      return typeof id === "number" ? id : null;
    },
  );
}

export async function apiFootballHeadToHead(
  homeTeamName: string,
  awayTeamName: string,
): Promise<BettingHeadToHeadGame[]> {
  if (!headers()) return [];
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
  if (!headers()) return [];
  const id = await resolveTeamId(teamName);
  if (!id) return [];
  return cached(
    `apifootball:injuries:${id}`,
    SPORTS_CACHE_TTL.injuries,
    async () => {
      const data = await get<{ response?: AfInjuryItem[] }>(
        `/injuries?team=${id}&season=${new Date().getFullYear()}`,
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
  if (!headers()) return null;
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
  if (!headers()) return null;
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
