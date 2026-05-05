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
  league?: { id?: number; name?: string; season?: number };
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
  team?: { id?: number; name?: string };
  startXI?: Array<{ player?: { name?: string; pos?: string; number?: number } }>;
  substitutes?: Array<{ player?: { name?: string; pos?: string; number?: number } }>;
}
interface AfPredictionItem {
  predictions?: {
    percent?: { home?: string; draw?: string; away?: string };
    advice?: string;
  };
}
interface AfStandingTeam {
  rank?: number;
  points?: number;
  form?: string;
  team?: { id?: number; name?: string };
}

interface AfFixtureStatisticsItem {
  team?: { id?: number };
  statistics?: Array<{ type?: string; value?: string | number | null }>;
}

function parseCornerCountFromRow(row: AfFixtureStatisticsItem): number | null {
  const hit = (row.statistics ?? []).find((s) => {
    const t = String(s.type ?? "").toLowerCase();
    return t.includes("corner");
  });
  if (!hit) return null;
  const raw = hit.value;
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function homeAwayCornerCounts(
  fx: AfFixture,
  sRows: AfFixtureStatisticsItem[],
): { homeCorners: number; awayCorners: number } | null {
  const homeId = fx.teams?.home?.id;
  const awayId = fx.teams?.away?.id;
  if (typeof homeId !== "number" || typeof awayId !== "number") return null;
  const byId = new Map<number, AfFixtureStatisticsItem>();
  for (const r of sRows) {
    const tid = r.team?.id;
    if (typeof tid === "number") byId.set(tid, r);
  }
  let homeRow = byId.get(homeId);
  let awayRow = byId.get(awayId);
  if (!homeRow || !awayRow) {
    const hasIds = sRows.every((r) => typeof r.team?.id === "number");
    if (!hasIds && sRows.length >= 2) {
      homeRow = sRows[0];
      awayRow = sRows[1];
    } else {
      return null;
    }
  }
  const hc = parseCornerCountFromRow(homeRow);
  const ac = parseCornerCountFromRow(awayRow);
  if (hc == null || ac == null) return null;
  return { homeCorners: hc, awayCorners: ac };
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

function normalizeTeamQuery(value: string): string {
  const n = normalizeTeamName(value);
  if (!n) return n;
  return n
    .replace(/\batl\b/g, "atletico")
    .replace(/\bpsg\b/g, "paris saint germain")
    .replace(/\bman utd\b/g, "manchester united")
    .replace(/\bman city\b/g, "manchester city")
    .trim();
}

function pickBestTeamId(rows: AfTeam[], queryName: string): number | null {
  if (!rows.length) return null;
  const q = normalizeTeamQuery(queryName);
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
    // De-prioritise youth/reserve/women squads when searching first teams.
    if (/\b(u17|u18|u19|u20|u21|u23|ii|b|women|feminino|femenino)\b/.test(n)) {
      score -= 30;
    }
    if (/\bmadrid\b/.test(q) && /\bmadrid\b/.test(n)) score += 8;
    if (/\batletico\b/.test(q) && /\batletico\b/.test(n)) score += 8;

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

      const normName = normalizeTeamQuery(name);
      if (normName && normName !== normalizeTeamName(name)) {
        const retryNorm = await get<{ response?: AfTeam[] }>(
          `/teams?search=${encodeURIComponent(normName)}`,
        );
        const retryNormRows = retryNorm?.response ?? [];
        const retryNormBest = pickBestTeamId(retryNormRows, name);
        if (retryNormBest) return retryNormBest;
      }

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
      `/fixtures/headtohead?h2h=${hId}-${aId}`,
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
      .filter((g): g is BettingHeadToHeadGame => g !== null)
      .slice(0, 10);
  });
}

function injuriesFromApiRows(rows: AfInjuryItem[]): BettingRealDataPlayer[] {
  const seen = new Set<string>();
  const out: BettingRealDataPlayer[] = [];
  const unknownNames: string[] = [];
  for (const r of rows) {
    const name = r.player?.name ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const status = (r.type ?? "Unknown").trim();
    const detail = (r.reason ?? "").trim();
    if (/^unknown$/i.test(status) && !detail) {
      unknownNames.push(name);
      continue;
    }
    out.push({
      name,
      position: r.player?.position ?? null,
      status,
      detail,
      headshot: null,
    });
  }
  if (out.length === 0 && unknownNames.length > 0) {
    for (const name of unknownNames.slice(0, 8)) {
      out.push({
        name,
        position: null,
        status: "Unspecified",
        detail: "Provider listed player without injury type — verify before betting.",
        headshot: null,
      });
    }
  }
  return out.slice(0, 30);
}

export async function apiFootballInjuries(
  teamName: string,
): Promise<BettingRealDataPlayer[]> {
  if (!authConfig()) return [];
  const id = await resolveTeamId(teamName);
  if (!id) return [];
  return cached(
    `apifootball:injuries:v2:${id}`,
    SPORTS_CACHE_TTL.injuries,
    async () => {
      const seasonCandidates = [
        currentSoccerSeason(),
        currentSoccerSeason() - 1,
        2024,
        2023,
        2022,
      ];

      for (const season of seasonCandidates) {
        const data = await get<{ response?: AfInjuryItem[]; errors?: unknown }>(
          `/injuries?team=${id}&season=${season}`,
        );
        const rows = data?.response ?? [];
        if (rows.length === 0) continue;
        const built = injuriesFromApiRows(rows);
        if (built.length > 0) return built;
      }

      const loose = await get<{ response?: AfInjuryItem[]; errors?: unknown }>(
        `/injuries?team=${id}`,
      );
      const looseRows = loose?.response ?? [];
      if (looseRows.length > 0) {
        const built = injuriesFromApiRows(looseRows);
        if (built.length > 0) return built;
      }
      return [];
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
        `/fixtures/headtohead?h2h=${hId}-${aId}&next=5`,
      );
      const candidates = fixtures?.response ?? [];
      let rows: AfLineupItem[] = [];
      for (const fx of candidates) {
        const fxId = fx.fixture?.id;
        if (!fxId) continue;
        const data = await get<{ response?: AfLineupItem[] }>(
          `/fixtures/lineups?fixture=${fxId}`,
        );
        rows = data?.response ?? [];
        if (rows.length > 0) break;
      }
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
      let homeItem = rows.find((r) => r.team?.id === hId);
      let awayItem = rows.find((r) => r.team?.id === aId);
      if (!homeItem && rows[0]) homeItem = rows[0];
      if (!awayItem && rows[1]) awayItem = rows[1];
      if (homeItem && awayItem === homeItem && rows.length > 1) {
        awayItem = rows.find((r) => r !== homeItem) ?? awayItem;
      }
      const home: BettingLineupPlayer[] = [];
      const away: BettingLineupPlayer[] = [];
      if (homeItem) {
        home.push(...toPlayers(homeItem.startXI ?? [], "starter"));
        home.push(...toPlayers(homeItem.substitutes ?? [], "bench"));
      }
      if (awayItem && awayItem !== homeItem) {
        away.push(...toPlayers(awayItem.startXI ?? [], "starter"));
        away.push(...toPlayers(awayItem.substitutes ?? [], "bench"));
      }
      if (home.length === 0 && away.length === 0) return null;
      return { home, away };
    },
  );
}

export async function apiFootballPrediction(
  homeTeamName: string,
  awayTeamName: string,
  kickoffIso?: string | null,
): Promise<BettingProviderPrediction | null> {
  if (!authConfig()) return null;
  const [hId, aId] = await Promise.all([
    resolveTeamId(homeTeamName),
    resolveTeamId(awayTeamName),
  ]);
  if (!hId || !aId) return null;
  const dateKey = (kickoffIso ?? "").length >= 10 ? kickoffIso!.slice(0, 10) : "na";
  return cached(
    `apifootball:prediction:v2:${hId}-${aId}:${dateKey}`,
    SPORTS_CACHE_TTL.predictions,
    async () => {
      const ko = kickoffIso ? Date.parse(kickoffIso) : NaN;
      const wantDay = kickoffIso && kickoffIso.length >= 10 ? kickoffIso.slice(0, 10) : null;

      const resolveFixtureId = async (): Promise<number | null> => {
        const tryNext = await get<{ response?: AfFixture[] }>(
          `/fixtures/headtohead?h2h=${hId}-${aId}&next=15`,
        );
        const nextRows = tryNext?.response ?? [];
        if (wantDay) {
          const dayHit = nextRows.find(
            (fx) => (fx.fixture?.date ?? "").slice(0, 10) === wantDay,
          );
          if (dayHit?.fixture?.id) return dayHit.fixture.id;
        }
        if (Number.isFinite(ko)) {
          let best: AfFixture | null = null;
          let bestD = Infinity;
          for (const fx of nextRows) {
            const t = Date.parse(fx.fixture?.date ?? "");
            if (!Number.isFinite(t)) continue;
            const d = Math.abs(t - ko);
            if (d < bestD) {
              bestD = d;
              best = fx;
            }
          }
          if (best?.fixture?.id && bestD <= 72 * 3600 * 1000) return best.fixture.id;
        }
        const notStarted = nextRows.find((fx) =>
          ["NS", "TBD"].includes(fx.fixture?.status?.short ?? ""),
        );
        if (notStarted?.fixture?.id) return notStarted.fixture.id;

        const tryLast = await get<{ response?: AfFixture[] }>(
          `/fixtures/headtohead?h2h=${hId}-${aId}&last=15`,
        );
        const lastRows = tryLast?.response ?? [];
        if (wantDay) {
          const dayHit = lastRows.find(
            (fx) => (fx.fixture?.date ?? "").slice(0, 10) === wantDay,
          );
          if (dayHit?.fixture?.id) return dayHit.fixture.id;
        }
        return nextRows[0]?.fixture?.id ?? lastRows[0]?.fixture?.id ?? null;
      };

      const fxId = await resolveFixtureId();
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
      const seasonCandidates = [
        currentSoccerSeason(),
        currentSoccerSeason() - 1,
        2024,
        2023,
      ];

      for (const season of seasonCandidates) {
        const data = await get<{ response?: AfFixture[]; errors?: unknown }>(
          `/fixtures?team=${id}&season=${season}`,
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

        if (out.length > 0) {
          out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
          return out.slice(0, limit);
        }
      }
      // Free-tier fallback: when season-based queries are sparse or mis-mapped,
      // use latest completed fixtures without season filter.
      const latest = await get<{ response?: AfFixture[] }>(`/fixtures?team=${id}&last=25`);
      const latestRows = latest?.response ?? [];
      const latestOut: EspnPastGame[] = [];
      for (const fx of latestRows) {
        const home = fx.teams?.home;
        const away = fx.teams?.away;
        const date = fx.fixture?.date ?? "";
        if (!home || !away || !date) continue;
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
        latestOut.push({
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
      if (latestOut.length > 0) {
        latestOut.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        return latestOut.slice(0, limit);
      }
      return [];
    },
  );
}

export async function apiFootballRecentCornerAverages(
  teamName: string,
  limit = 10,
): Promise<{ cornersForAvg: number; cornersAgainstAvg: number; sample: number } | null> {
  if (!authConfig()) return null;
  const id = await resolveTeamId(teamName);
  if (!id) return null;
  return cached(
    `apifootball:corners:v2:${id}:${limit}`,
    SPORTS_CACHE_TTL.teamStats,
    async () => {
      const accumulateCorners = async (
        played: AfFixture[],
      ): Promise<{ cornersForAvg: number; cornersAgainstAvg: number; sample: number } | null> => {
        let forSum = 0;
        let againstSum = 0;
        let sample = 0;
        for (const fx of played) {
          const fxId = fx.fixture?.id;
          if (!fxId) continue;
          const stats = await get<{ response?: AfFixtureStatisticsItem[] }>(
            `/fixtures/statistics?fixture=${fxId}`,
          );
          const sRows = stats?.response ?? [];
          if (sRows.length < 2) continue;
          const counts = homeAwayCornerCounts(fx, sRows);
          if (!counts) continue;
          const isHome = fx.teams?.home?.id === id;
          const teamCorners = isHome ? counts.homeCorners : counts.awayCorners;
          const oppCorners = isHome ? counts.awayCorners : counts.homeCorners;
          forSum += teamCorners;
          againstSum += oppCorners;
          sample += 1;
        }
        if (sample === 0) return null;
        return {
          cornersForAvg: Number((forSum / sample).toFixed(2)),
          cornersAgainstAvg: Number((againstSum / sample).toFixed(2)),
          sample,
        };
      };

      const seasonCandidates = [
        currentSoccerSeason(),
        currentSoccerSeason() - 1,
        2024,
        2023,
      ];

      for (const season of seasonCandidates) {
        const data = await get<{ response?: AfFixture[] }>(
          `/fixtures?team=${id}&season=${season}`,
        );
        const rows = data?.response ?? [];
        const played = rows
          .filter((fx) => {
            const short = fx.fixture?.status?.short ?? "";
            return ["FT", "AET", "PEN"].includes(short);
          })
          .sort(
            (a, b) =>
              Date.parse(b.fixture?.date ?? "") - Date.parse(a.fixture?.date ?? ""),
          )
          .slice(0, limit);
        if (played.length === 0) continue;
        const agg = await accumulateCorners(played);
        if (agg) return agg;
      }

      const latest = await get<{ response?: AfFixture[] }>(`/fixtures?team=${id}&last=25`);
      const played = (latest?.response ?? [])
        .filter((fx) => {
          const short = fx.fixture?.status?.short ?? "";
          return ["FT", "AET", "PEN"].includes(short);
        })
        .sort(
          (a, b) => Date.parse(b.fixture?.date ?? "") - Date.parse(a.fixture?.date ?? ""),
        )
        .slice(0, limit);

      return accumulateCorners(played);
    },
  );
}

export async function apiFootballTeamStanding(
  teamName: string,
): Promise<{ league: string | null; rank: number | null; points: number | null; form: string | null } | null> {
  if (!authConfig()) return null;
  const id = await resolveTeamId(teamName);
  if (!id) return null;
  return cached(
    `apifootball:standing:${id}`,
    SPORTS_CACHE_TTL.teamStats,
    async () => {
      const latest = await get<{ response?: AfFixture[] }>(`/fixtures?team=${id}&last=1`);
      const fx = latest?.response?.[0];
      const leagueId = fx?.league?.id;
      const season = fx?.league?.season;
      if (!leagueId || !season) return null;
      const standings = await get<{
        response?: Array<{
          league?: { name?: string; standings?: AfStandingTeam[][] };
        }>;
      }>(`/standings?league=${leagueId}&season=${season}`);
      const table = standings?.response?.[0]?.league?.standings?.[0] ?? [];
      const row = table.find((r) => r.team?.id === id);
      if (!row) return null;
      return {
        league: standings?.response?.[0]?.league?.name ?? null,
        rank: row.rank ?? null,
        points: row.points ?? null,
        form: row.form ?? null,
      };
    },
  );
}
