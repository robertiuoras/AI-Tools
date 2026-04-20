import "server-only";

import type {
  BettingBookOdds,
  BettingHeadToHeadGame,
} from "@/lib/betting-bot";

/**
 * Wrappers around ESPN's free public (unofficial) JSON endpoints.
 * No API key required, no rate-limit headers published but they're lenient —
 * we set short timeouts and silently degrade when anything fails.
 *
 * The AI Betting Bot uses this module to *ground* its analysis in real data
 * instead of letting the LLM hallucinate rosters, venues, and dates. If a
 * sport can't be resolved (esports, niche markets), callers fall back to
 * pure-LLM mode with a visible "low data" warning.
 */

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

type SportSpec = { match: RegExp; path: string; label: string };

const SPORT_PATHS: SportSpec[] = [
  { match: /\b(nba|national basketball)\b/i, path: "basketball/nba", label: "NBA" },
  { match: /\b(wnba)\b/i, path: "basketball/wnba", label: "WNBA" },
  { match: /\b(nfl)\b/i, path: "football/nfl", label: "NFL" },
  { match: /\b(ncaaf|college football|cfb)\b/i, path: "football/college-football", label: "NCAAF" },
  { match: /\b(ncaab|ncaa basketball|college basketball|cbb)\b/i, path: "basketball/mens-college-basketball", label: "NCAAB" },
  { match: /\b(nhl)\b/i, path: "hockey/nhl", label: "NHL" },
  { match: /\b(mlb)\b/i, path: "baseball/mlb", label: "MLB" },
  { match: /\b(mls)\b/i, path: "soccer/usa.1", label: "MLS" },
  { match: /\b(epl|premier league|english premier)\b/i, path: "soccer/eng.1", label: "EPL" },
  { match: /\b(la ?liga)\b/i, path: "soccer/esp.1", label: "La Liga" },
  { match: /\b(serie a)\b/i, path: "soccer/ita.1", label: "Serie A" },
  { match: /\b(bundesliga)\b/i, path: "soccer/ger.1", label: "Bundesliga" },
  { match: /\b(ligue 1)\b/i, path: "soccer/fra.1", label: "Ligue 1" },
  { match: /\b(champions league|ucl)\b/i, path: "soccer/uefa.champions", label: "Champions League" },
  { match: /\b(europa league|uel)\b/i, path: "soccer/uefa.europa", label: "Europa League" },
  { match: /\b(fa cup)\b/i, path: "soccer/eng.fa", label: "FA Cup" },
];

export type SportKey = { path: string; label: string };

/** Resolve a sport from a free-text hint (query or explicit sport field). */
export function sportFromHint(hint: string): SportKey | null {
  for (const s of SPORT_PATHS) {
    if (s.match.test(hint)) return { path: s.path, label: s.label };
  }
  return null;
}

/** Every soccer league ESPN exposes, in popularity order. Used when the
 *  parser only knows "Soccer" generically — we probe each one and keep
 *  the league that actually contains the requested fixture. */
const SOCCER_LEAGUES: SportKey[] = SPORT_PATHS.filter((s) =>
  s.path.startsWith("soccer/"),
).map((s) => ({ path: s.path, label: s.label }));

/**
 * Return every candidate league we should probe for this request. Unlike
 * `sportFromHint`, we never give up: when the LLM only knows "soccer" /
 * "football" generically we fan out to all soccer leagues. If the hint
 * contains no sport signal at all we still return [] so callers can fall
 * back to qualitative mode cleanly.
 */
export function sportCandidatesFromHint(hint: string): SportKey[] {
  const matched = SPORT_PATHS.filter((s) => s.match.test(hint)).map((s) => ({
    path: s.path,
    label: s.label,
  }));
  if (matched.length > 0) return matched;

  if (/\b(soccer|football|futbol|fútbol|association football)\b/i.test(hint)) {
    return SOCCER_LEAGUES;
  }
  return [];
}

export type EspnTeamLite = {
  id: string;
  displayName: string;
  shortName: string;
  abbreviation: string;
  logo: string | null;
  record: string | null;
  score: number | null;
};

export type EspnFixture = {
  id: string;
  date: string;
  name: string;
  shortName: string;
  venue: { fullName: string; city: string | null; state: string | null } | null;
  status: string;
  homeTeam: EspnTeamLite;
  awayTeam: EspnTeamLite;
  /** The raw odds spread/overUnder block ESPN bundles with the event, if any. */
  odds: {
    provider: string | null;
    spread: number | null;
    overUnder: number | null;
    homeMoneyline: number | null;
    awayMoneyline: number | null;
  } | null;
};

async function espnGet<T = unknown>(url: string): Promise<T | null> {
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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

type RawEvent = {
  id?: string | number;
  date?: string;
  name?: string;
  shortName?: string;
  status?: { type?: { name?: string } };
  competitions?: Array<{
    venue?: {
      fullName?: string;
      address?: { city?: string; state?: string };
    };
    competitors?: Array<{
      homeAway?: string;
      team?: {
        id?: string | number;
        displayName?: string;
        shortDisplayName?: string;
        name?: string;
        abbreviation?: string;
        location?: string;
        logo?: string;
      };
      records?: Array<{ summary?: string }>;
      score?: string | number;
      winner?: boolean;
    }>;
    odds?: Array<{
      provider?: { name?: string };
      details?: string;
      spread?: number;
      overUnder?: number;
      homeTeamOdds?: { moneyLine?: number };
      awayTeamOdds?: { moneyLine?: number };
    }>;
  }>;
};

type ScoreboardResponse = { events?: RawEvent[] };

type RawCompetitor = NonNullable<
  NonNullable<RawEvent["competitions"]>[number]["competitors"]
>[number];

function toTeamLite(c: RawCompetitor): EspnTeamLite {
  return {
    id: String(c.team?.id ?? ""),
    displayName: c.team?.displayName ?? "",
    shortName: c.team?.shortDisplayName ?? c.team?.name ?? "",
    abbreviation: c.team?.abbreviation ?? "",
    logo: c.team?.logo ?? null,
    record: c.records?.[0]?.summary ?? null,
    score: c.score != null ? Number(c.score) : null,
  };
}

function toFixture(event: RawEvent): EspnFixture | null {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const oddsBlock = comp.odds?.[0] ?? null;
  return {
    id: String(event.id ?? ""),
    date: event.date ?? "",
    name: event.name ?? "",
    shortName: event.shortName ?? "",
    venue: comp.venue
      ? {
          fullName: comp.venue.fullName ?? "",
          city: comp.venue.address?.city ?? null,
          state: comp.venue.address?.state ?? null,
        }
      : null,
    status: event.status?.type?.name ?? "UNKNOWN",
    homeTeam: toTeamLite(home),
    awayTeam: toTeamLite(away),
    odds: oddsBlock
      ? {
          provider: oddsBlock.provider?.name ?? null,
          spread: typeof oddsBlock.spread === "number" ? oddsBlock.spread : null,
          overUnder:
            typeof oddsBlock.overUnder === "number" ? oddsBlock.overUnder : null,
          homeMoneyline:
            typeof oddsBlock.homeTeamOdds?.moneyLine === "number"
              ? oddsBlock.homeTeamOdds!.moneyLine!
              : null,
          awayMoneyline:
            typeof oddsBlock.awayTeamOdds?.moneyLine === "number"
              ? oddsBlock.awayTeamOdds!.moneyLine!
              : null,
        }
      : null,
  };
}

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function teamNameTokens(t: EspnTeamLite): string[] {
  return tokenise(`${t.displayName} ${t.shortName} ${t.abbreviation}`);
}

function tokenOverlap(hintTokens: string[], nameTokens: string[]): number {
  if (!hintTokens.length || !nameTokens.length) return 0;
  const set = new Set(nameTokens);
  let hits = 0;
  for (const tok of hintTokens) {
    if (set.has(tok)) hits += 1;
  }
  return hits;
}

/**
 * Search the scoreboard over an inclusive date range and return the best
 * event matching the team hint(s).
 *
 * When `teams` has 2 names we require EACH of them to match a different
 * competitor (home/away) — this prevents generic-token collisions like
 * "West Ham United" vs "Crystal Palace" grabbing a different "…United"
 * fixture (Leeds, Manchester, Newcastle, Sheffield, …) just because
 * "united" is a hint token.
 *
 * When only one team is given (or we fall back to token mode) we keep the
 * older loose scoring but still tie-break by distance from `preferredIso`
 * so the next closest occurrence of that matchup wins.
 */
export async function findFixture(
  sportPath: string,
  startDate: Date,
  endDate: Date,
  teamHint: string,
  teams?: string[],
  preferredIso?: string | null,
): Promise<EspnFixture | null> {
  const start = yyyymmdd(startDate);
  const end = yyyymmdd(endDate);
  const range = start === end ? start : `${start}-${end}`;
  const data = await espnGet<ScoreboardResponse>(
    `${ESPN_BASE}/${sportPath}/scoreboard?dates=${range}&limit=400`,
  );
  if (!data?.events?.length) return null;

  const hintTokens = tokenise(teamHint);
  const perTeamTokens = (teams ?? [])
    .map((t) => tokenise(t))
    .filter((toks) => toks.length > 0)
    .slice(0, 2);

  const referenceMs = preferredIso
    ? new Date(preferredIso).getTime()
    : Date.now();

  let best:
    | { fx: EspnFixture; score: number; bothTeamsMatched: boolean; dateDelta: number }
    | null = null;
  for (const event of data.events) {
    const fx = toFixture(event);
    if (!fx) continue;
    const homeTokens = teamNameTokens(fx.homeTeam);
    const awayTokens = teamNameTokens(fx.awayTeam);

    let score = 0;
    let bothTeamsMatched = false;

    if (perTeamTokens.length === 2) {
      const [tA, tB] = perTeamTokens as [string[], string[]];
      const aHome = tokenOverlap(tA, homeTokens);
      const aAway = tokenOverlap(tA, awayTokens);
      const bHome = tokenOverlap(tB, homeTokens);
      const bAway = tokenOverlap(tB, awayTokens);
      const scenario1 = aHome > 0 && bAway > 0 ? aHome + bAway : 0;
      const scenario2 = aAway > 0 && bHome > 0 ? aAway + bHome : 0;
      const dualScore = Math.max(scenario1, scenario2);
      if (dualScore > 0) {
        // Dual match beats any single-team fallback decisively.
        score = dualScore + 100;
        bothTeamsMatched = true;
      } else {
        // Fallback: single-team best overlap (treated as "maybe", never wins
        // vs a real dual match because of the +100 bonus above).
        score =
          Math.max(aHome, aAway, bHome, bAway) > 0
            ? Math.max(aHome, aAway) + Math.max(bHome, bAway)
            : 0;
      }
    } else if (perTeamTokens.length === 1) {
      const [tA] = perTeamTokens as [string[]];
      score = Math.max(tokenOverlap(tA, homeTokens), tokenOverlap(tA, awayTokens));
    } else {
      const names = [...homeTokens, ...awayTokens];
      score = tokenOverlap(hintTokens, names);
    }

    if (score === 0) continue;

    const eventMs = new Date(fx.date).getTime();
    const dateDelta = Number.isFinite(eventMs)
      ? Math.abs(eventMs - referenceMs)
      : Number.POSITIVE_INFINITY;

    if (
      !best ||
      score > best.score ||
      (score === best.score && dateDelta < best.dateDelta)
    ) {
      best = { fx, score, bothTeamsMatched, dateDelta };
    }
  }

  // Safety net: if the caller asked for two specific teams and we never
  // matched both, refuse the wrong-fixture candidate rather than returning
  // it — the caller will widen the window / fall back to qualitative mode.
  if (perTeamTokens.length === 2 && best && !best.bothTeamsMatched) {
    return null;
  }
  return best?.fx ?? null;
}

/* ── Injuries ─────────────────────────────────────────────────────────── */

type RawInjuryEntry = {
  status?: string;
  longComment?: string;
  shortComment?: string;
  type?: { description?: string };
  athlete?: {
    id?: string | number;
    displayName?: string;
    position?: { abbreviation?: string };
    headshot?: { href?: string };
  };
};

type RawInjuryTeam = {
  id?: string | number;
  team?: { id?: string | number; displayName?: string };
  injuries?: RawInjuryEntry[];
};

type InjuriesResponse = { injuries?: RawInjuryTeam[] };

export type EspnInjury = {
  playerId: string;
  playerName: string;
  position: string | null;
  status: string;
  detail: string;
  headshot: string | null;
};

export async function getTeamInjuries(
  sportPath: string,
  teamId: string,
): Promise<EspnInjury[]> {
  if (!teamId) return [];
  const data = await espnGet<InjuriesResponse>(
    `${ESPN_BASE}/${sportPath}/injuries?limit=300`,
  );
  if (!data?.injuries?.length) return [];
  const block =
    data.injuries.find((t) => String(t.id ?? "") === teamId) ??
    data.injuries.find((t) => String(t.team?.id ?? "") === teamId);
  if (!block?.injuries?.length) return [];
  return block.injuries
    .map(
      (inj): EspnInjury => ({
        playerId: String(inj.athlete?.id ?? ""),
        playerName: inj.athlete?.displayName ?? "Unknown",
        position: inj.athlete?.position?.abbreviation ?? null,
        status: (inj.status ?? "Questionable").trim(),
        detail:
          inj.longComment?.trim() ||
          inj.shortComment?.trim() ||
          inj.type?.description?.trim() ||
          "",
        headshot: inj.athlete?.headshot?.href ?? null,
      }),
    )
    .slice(0, 12);
}

/* ── Recent games ─────────────────────────────────────────────────────── */

type ScheduleResponse = { events?: RawEvent[] };

export type EspnPastGame = {
  id: string;
  date: string;
  opponent: {
    id: string;
    displayName: string;
    abbreviation: string;
    logo: string | null;
  };
  homeAway: "home" | "away";
  teamScore: number | null;
  oppScore: number | null;
  result: "W" | "L" | "T" | null;
};

export async function getRecentGames(
  sportPath: string,
  teamId: string,
  limit = 10,
): Promise<EspnPastGame[]> {
  if (!teamId) return [];
  const data = await espnGet<ScheduleResponse>(
    `${ESPN_BASE}/${sportPath}/teams/${teamId}/schedule`,
  );
  if (!data?.events?.length) return [];
  const past = data.events.filter(
    (e) => e.status?.type?.name === "STATUS_FINAL",
  );
  past.sort(
    (a, b) =>
      new Date(b.date ?? "").getTime() - new Date(a.date ?? "").getTime(),
  );

  const out: EspnPastGame[] = [];
  for (const event of past.slice(0, limit)) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const me = comp.competitors?.find(
      (c) => String(c.team?.id ?? "") === teamId,
    );
    const opp = comp.competitors?.find(
      (c) => String(c.team?.id ?? "") !== teamId,
    );
    if (!me || !opp) continue;
    out.push({
      id: String(event.id ?? ""),
      date: event.date ?? "",
      opponent: {
        id: String(opp.team?.id ?? ""),
        displayName: opp.team?.displayName ?? "",
        abbreviation: opp.team?.abbreviation ?? "",
        logo: opp.team?.logo ?? null,
      },
      homeAway: me.homeAway === "home" ? "home" : "away",
      teamScore: me.score != null ? Number(me.score) : null,
      oppScore: opp.score != null ? Number(opp.score) : null,
      result:
        me.winner === true ? "W" : me.winner === false ? "L" : null,
    });
  }
  return out;
}

/* ── Event summary (used by the settlement job) ───────────────────────── */

export type EspnEventSummary = {
  id: string;
  date: string;
  status: string;
  completed: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
};

/**
 * Fetch a single event's current status/score. We hit the scoreboard with an
 * explicit date window so the endpoint is cheap and consistent; the direct
 * `summary?event=` endpoint is fatter and sometimes 404s for older events.
 */
export async function getEventSummary(
  sportPath: string,
  eventId: string,
  kickoffIso: string | null,
): Promise<EspnEventSummary | null> {
  // A 3-day window centred on the kickoff is safe — game might have
  // started on kickoff-day and finished on the next (late NBA, overseas
  // soccer). If we don't know the kickoff, widen to ±7 days.
  const anchor = kickoffIso ? new Date(kickoffIso) : new Date();
  const radiusDays = kickoffIso ? 3 : 7;
  const start = new Date(anchor);
  start.setDate(start.getDate() - radiusDays);
  const end = new Date(anchor);
  end.setDate(end.getDate() + radiusDays);
  const range = `${yyyymmdd(start)}-${yyyymmdd(end)}`;

  const data = await espnGet<ScoreboardResponse>(
    `${ESPN_BASE}/${sportPath}/scoreboard?dates=${range}&limit=400`,
  );
  const event = data?.events?.find((e) => String(e.id ?? "") === eventId);
  if (!event) return null;

  const comp = event.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const statusName = event.status?.type?.name ?? "UNKNOWN";
  return {
    id: eventId,
    date: event.date ?? "",
    status: statusName,
    completed: statusName === "STATUS_FINAL",
    homeTeamId: String(home.team?.id ?? ""),
    awayTeamId: String(away.team?.id ?? ""),
    homeScore: home.score != null ? Number(home.score) : null,
    awayScore: away.score != null ? Number(away.score) : null,
  };
}

/** Compact WLLWW-style string for the most recent N games. */
export function streakString(games: EspnPastGame[], n = 10): string {
  return games
    .slice(0, n)
    .map((g) => g.result ?? "·")
    .join("");
}

/** Helpful average for the LLM — points/goals scored & allowed. */
export function averageScore(games: EspnPastGame[]): {
  ppg: number | null;
  opp: number | null;
  wins: number;
  losses: number;
  homeWins: number;
  homeLosses: number;
  awayWins: number;
  awayLosses: number;
  marginAvg: number | null;
} {
  const valid = games.filter(
    (g) => g.teamScore != null && g.oppScore != null,
  );
  if (!valid.length) {
    return {
      ppg: null,
      opp: null,
      wins: 0,
      losses: 0,
      homeWins: 0,
      homeLosses: 0,
      awayWins: 0,
      awayLosses: 0,
      marginAvg: null,
    };
  }
  const ppg =
    valid.reduce((a, g) => a + (g.teamScore ?? 0), 0) / valid.length;
  const opp =
    valid.reduce((a, g) => a + (g.oppScore ?? 0), 0) / valid.length;
  const wins = valid.filter((g) => g.result === "W").length;
  const losses = valid.filter((g) => g.result === "L").length;
  const homeWins = valid.filter(
    (g) => g.homeAway === "home" && g.result === "W",
  ).length;
  const homeLosses = valid.filter(
    (g) => g.homeAway === "home" && g.result === "L",
  ).length;
  const awayWins = valid.filter(
    (g) => g.homeAway === "away" && g.result === "W",
  ).length;
  const awayLosses = valid.filter(
    (g) => g.homeAway === "away" && g.result === "L",
  ).length;
  const marginAvg =
    valid.reduce(
      (a, g) => a + ((g.teamScore ?? 0) - (g.oppScore ?? 0)),
      0,
    ) / valid.length;
  return {
    ppg: Number(ppg.toFixed(1)),
    opp: Number(opp.toFixed(1)),
    wins,
    losses,
    homeWins,
    homeLosses,
    awayWins,
    awayLosses,
    marginAvg: Number(marginAvg.toFixed(1)),
  };
}

/** Days between the team's last completed game and the scheduled kickoff.
 *  Returns null if we don't have enough info. Rest-day fatigue is a pro-level
 *  signal — 0 = back-to-back, 1 = one day off, 3+ = well-rested. */
export function restDaysBefore(
  recentGames: EspnPastGame[],
  kickoffIso: string | null,
): number | null {
  if (!kickoffIso || !recentGames.length) return null;
  const last = recentGames[0];
  if (!last?.date) return null;
  const kickoff = new Date(kickoffIso).getTime();
  const lastGame = new Date(last.date).getTime();
  if (!Number.isFinite(kickoff) || !Number.isFinite(lastGame)) return null;
  const days = (kickoff - lastGame) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.round(days));
}

/* ── Head-to-head ─────────────────────────────────────────────────────── */

/**
 * Last `limit` completed meetings between the two teams, most-recent first.
 * We reuse the schedule endpoint for one team and filter events where the
 * other team is the opponent. ESPN's schedule only returns the current
 * season so for out-of-season sports H2H may come back empty — that's
 * honest "no recent data" rather than invented data.
 */
export async function getHeadToHead(
  sportPath: string,
  homeTeamId: string,
  awayTeamId: string,
  limit = 5,
): Promise<BettingHeadToHeadGame[]> {
  if (!homeTeamId || !awayTeamId) return [];

  // Pull both teams' schedules in parallel — some seasons the "home" side
  // doesn't have the meeting on its schedule yet but the visitor's does.
  const [aData, bData] = await Promise.all([
    espnGet<ScheduleResponse>(
      `${ESPN_BASE}/${sportPath}/teams/${homeTeamId}/schedule`,
    ),
    espnGet<ScheduleResponse>(
      `${ESPN_BASE}/${sportPath}/teams/${awayTeamId}/schedule`,
    ),
  ]);

  const events = [...(aData?.events ?? []), ...(bData?.events ?? [])];
  const seen = new Set<string>();
  const meetings: BettingHeadToHeadGame[] = [];

  for (const ev of events) {
    const id = String(ev.id ?? "");
    if (!id || seen.has(id)) continue;
    if (ev.status?.type?.name !== "STATUS_FINAL") continue;
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    const homeId = String(home.team?.id ?? "");
    const awayId = String(away.team?.id ?? "");
    const pair = new Set([homeId, awayId]);
    if (!pair.has(homeTeamId) || !pair.has(awayTeamId)) continue;

    const homeScore = home.score != null ? Number(home.score) : null;
    const awayScore = away.score != null ? Number(away.score) : null;
    let winner: BettingHeadToHeadGame["winner"] = null;
    if (home.winner === true) winner = "home";
    else if (away.winner === true) winner = "away";
    else if (
      homeScore != null &&
      awayScore != null &&
      homeScore === awayScore
    )
      winner = "tie";

    seen.add(id);
    meetings.push({
      date: ev.date ?? "",
      season: null,
      homeTeam: home.team?.displayName ?? "",
      awayTeam: away.team?.displayName ?? "",
      homeScore,
      awayScore,
      winner,
      venue: comp.venue?.fullName ?? null,
    });
  }

  meetings.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  return meetings.slice(0, limit);
}

/* ── Team style / statistics ─────────────────────────────────────────── */

type RawStatCategory = {
  name?: string;
  displayName?: string;
  stats?: Array<{
    name?: string;
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    value?: number | string;
    displayValue?: string;
  }>;
};

type TeamStatsResponse = {
  splits?: {
    categories?: RawStatCategory[];
  };
  results?: {
    stats?: {
      splitCategories?: RawStatCategory[];
    };
  };
};

/** Which stats are most useful per sport for a betting matchup read-out. */
const STYLE_STAT_KEYS: Record<string, string[]> = {
  "basketball/nba": [
    "avgPoints",
    "avgPointsAgainst",
    "fieldGoalPct",
    "threePointFieldGoalPct",
    "avgRebounds",
    "avgAssists",
    "avgTurnovers",
    "avgStealsPerGame",
    "avgBlocksPerGame",
    "paceOfPlay",
  ],
  "basketball/wnba": [
    "avgPoints",
    "avgPointsAgainst",
    "fieldGoalPct",
    "threePointFieldGoalPct",
    "avgRebounds",
    "avgAssists",
    "avgTurnovers",
  ],
  "basketball/mens-college-basketball": [
    "avgPoints",
    "avgPointsAgainst",
    "fieldGoalPct",
    "threePointFieldGoalPct",
  ],
  "football/nfl": [
    "totalYardsPerGame",
    "passingYardsPerGame",
    "rushingYardsPerGame",
    "pointsPerGame",
    "yardsAllowedPerGame",
    "pointsAllowedPerGame",
    "turnoverDifferential",
    "thirdDownConvPct",
  ],
  "hockey/nhl": [
    "avgGoals",
    "avgGoalsAgainst",
    "powerPlayPct",
    "penaltyKillPct",
    "shotsPerGame",
    "savePct",
  ],
  "baseball/mlb": [
    "teamBattingAvg",
    "onBasePct",
    "sluggingPct",
    "runsPerGame",
    "earnedRunAvg",
    "whip",
  ],
};

const DEFAULT_STYLE_KEYS = [
  "avgPoints",
  "avgPointsAgainst",
  "avgGoals",
  "avgGoalsAgainst",
  "goalsFor",
  "goalsAgainst",
  "fieldGoalPct",
  "threePointFieldGoalPct",
];

/** Fetch a small set of offense/defense style stats for a team. */
export async function getTeamStyle(
  sportPath: string,
  teamId: string,
): Promise<Array<{ key: string; label: string; value: string }>> {
  if (!teamId) return [];
  const data = await espnGet<TeamStatsResponse>(
    `${ESPN_BASE}/${sportPath}/teams/${teamId}/statistics`,
  );
  const categories =
    data?.splits?.categories ?? data?.results?.stats?.splitCategories ?? [];
  if (!categories.length) return [];

  const wanted = new Set(STYLE_STAT_KEYS[sportPath] ?? DEFAULT_STYLE_KEYS);
  const hits: Array<{ key: string; label: string; value: string }> = [];
  for (const cat of categories) {
    for (const s of cat.stats ?? []) {
      const k = s.name ?? s.abbreviation ?? "";
      if (!k || !wanted.has(k)) continue;
      const label = s.displayName ?? s.shortDisplayName ?? k;
      const value = s.displayValue ?? String(s.value ?? "");
      if (!value) continue;
      hits.push({ key: k, label, value });
      if (hits.length >= 10) break;
    }
    if (hits.length >= 10) break;
  }
  return hits;
}

/* ── ESPN pickcenter (US-book odds consensus) ─────────────────────────── */

type RawPickcenterEntry = {
  provider?: { id?: number | string; name?: string };
  details?: string;
  spread?: number;
  overUnder?: number;
  overOdds?: number;
  underOdds?: number;
  homeTeamOdds?: {
    moneyLine?: number;
    spreadOdds?: number;
  };
  awayTeamOdds?: {
    moneyLine?: number;
    spreadOdds?: number;
  };
  lastUpdated?: string;
};

type SummaryResponse = {
  pickcenter?: RawPickcenterEntry[];
};

/** American odds → decimal. */
function americanToDecimal(american: number | null | undefined): number | null {
  if (typeof american !== "number" || !Number.isFinite(american)) return null;
  if (american === 0) return null;
  return american > 0
    ? Number((american / 100 + 1).toFixed(4))
    : Number((100 / Math.abs(american) + 1).toFixed(4));
}

/**
 * Multi-book board from ESPN's summary endpoint. Usually returns ESPN BET,
 * Caesars, DraftKings and FanDuel — all US books. Useful as a sanity check
 * even for NZ bettors since lines move together.
 */
export async function getEventPickcenter(
  sportPath: string,
  eventId: string,
): Promise<BettingBookOdds[]> {
  if (!eventId) return [];
  const data = await espnGet<SummaryResponse>(
    `${ESPN_BASE}/${sportPath}/summary?event=${eventId}`,
  );
  if (!data?.pickcenter?.length) return [];

  return data.pickcenter
    .map((p): BettingBookOdds | null => {
      const name = p.provider?.name ?? "Unknown";
      const key =
        String(p.provider?.id ?? name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-") || "unknown";
      return {
        key,
        provider: name,
        region: "us",
        entainFamily: false,
        moneylineHome: americanToDecimal(p.homeTeamOdds?.moneyLine),
        moneylineAway: americanToDecimal(p.awayTeamOdds?.moneyLine),
        draw: null,
        spreadPoint: typeof p.spread === "number" ? p.spread : null,
        spreadHomeOdds: americanToDecimal(p.homeTeamOdds?.spreadOdds),
        spreadAwayOdds: americanToDecimal(p.awayTeamOdds?.spreadOdds),
        total: typeof p.overUnder === "number" ? p.overUnder : null,
        overOdds: americanToDecimal(p.overOdds),
        underOdds: americanToDecimal(p.underOdds),
        lastUpdateIso: p.lastUpdated ?? null,
      };
    })
    .filter((x): x is BettingBookOdds => x !== null);
}

/* ── The-Odds-API (Entain / AU & NZ books) ────────────────────────────── */

const ODDS_API_SPORT_MAP: Record<string, string> = {
  "basketball/nba": "basketball_nba",
  "basketball/wnba": "basketball_wnba",
  "basketball/mens-college-basketball": "basketball_ncaab",
  "football/nfl": "americanfootball_nfl",
  "football/college-football": "americanfootball_ncaaf",
  "hockey/nhl": "icehockey_nhl",
  "baseball/mlb": "baseball_mlb",
  "soccer/eng.1": "soccer_epl",
  "soccer/esp.1": "soccer_spain_la_liga",
  "soccer/ita.1": "soccer_italy_serie_a",
  "soccer/ger.1": "soccer_germany_bundesliga",
  "soccer/fra.1": "soccer_france_ligue_one",
  "soccer/uefa.champions": "soccer_uefa_champs_league",
  "soccer/uefa.europa": "soccer_uefa_europa_league",
  "soccer/usa.1": "soccer_usa_mls",
};

/** Books owned by Entain plc — same price feed as Betcha.co.nz. */
const ENTAIN_KEYS = new Set<string>([
  "ladbrokes_au",
  "neds",
  "coral",
  "ladbrokes_uk",
  "bwin",
]);

type OddsApiEvent = {
  id?: string;
  sport_key?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: Array<{
    key?: string;
    title?: string;
    last_update?: string;
    markets?: Array<{
      key?: string;
      outcomes?: Array<{
        name?: string;
        price?: number;
        point?: number;
      }>;
    }>;
  }>;
};

function nameMatches(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const an = norm(a);
  const bn = norm(b);
  if (!an || !bn) return false;
  if (an === bn) return true;
  // One containing the other (handles "Cleveland Cavaliers" vs "Cavaliers").
  if (an.includes(bn) || bn.includes(an)) return true;
  // Last-word match (handles "Cleveland" vs "Cleveland Cavaliers").
  const aTokens = an.split(" ");
  const bTokens = bn.split(" ");
  const aTail = aTokens[aTokens.length - 1] ?? "";
  const bTail = bTokens[bTokens.length - 1] ?? "";
  return aTail.length >= 3 && aTail === bTail;
}

/**
 * Ask The-Odds-API for Entain-family prices (Ladbrokes/Neds — Betcha's
 * sister books) plus a few other NZ/AU books for cross-reference.
 *
 * Returns [] when:
 *   • ODDS_API_KEY env var is not set (opt-in to preserve the free quota)
 *   • sport isn't on the mapping table
 *   • no event matches the fixture
 *   • network/API error
 */
export async function getEntainOdds(
  sportPath: string,
  homeTeamName: string,
  awayTeamName: string,
  kickoffIso: string | null,
): Promise<BettingBookOdds[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) return [];
  const sportKey = ODDS_API_SPORT_MAP[sportPath];
  if (!sportKey) return [];

  // Regions param pulls books from those markets. We ask for au (Ladbrokes
  // AU, Neds, TAB AU, Sportsbet, Pointsbet) and uk (Ladbrokes UK, Coral —
  // also Entain-owned). us is kept as a sanity fallback.
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?regions=au,uk,us&markets=h2h,spreads,totals&oddsFormat=decimal&apiKey=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const events = (await res.json()) as OddsApiEvent[];

    // Pick the event that matches our fixture. Name-based match; if a
    // kickoff is supplied, tie-break by closest commence_time.
    const kickoffMs = kickoffIso ? new Date(kickoffIso).getTime() : null;
    let best: { ev: OddsApiEvent; delta: number } | null = null;
    for (const ev of events) {
      if (
        !ev.home_team ||
        !ev.away_team ||
        !nameMatches(ev.home_team, homeTeamName) ||
        !nameMatches(ev.away_team, awayTeamName)
      )
        continue;
      const delta =
        kickoffMs && ev.commence_time
          ? Math.abs(new Date(ev.commence_time).getTime() - kickoffMs)
          : 0;
      if (!best || delta < best.delta) best = { ev, delta };
    }
    if (!best) return [];

    const ev = best.ev;
    const books: BettingBookOdds[] = [];
    for (const b of ev.bookmakers ?? []) {
      if (!b.key || !b.markets?.length) continue;
      const h2h = b.markets.find((m) => m.key === "h2h");
      const spreads = b.markets.find((m) => m.key === "spreads");
      const totals = b.markets.find((m) => m.key === "totals");

      const h2hHome = h2h?.outcomes?.find(
        (o) => o.name && nameMatches(o.name, homeTeamName),
      );
      const h2hAway = h2h?.outcomes?.find(
        (o) => o.name && nameMatches(o.name, awayTeamName),
      );
      const draw = h2h?.outcomes?.find(
        (o) => (o.name ?? "").toLowerCase() === "draw",
      );
      const spHome = spreads?.outcomes?.find(
        (o) => o.name && nameMatches(o.name, homeTeamName),
      );
      const spAway = spreads?.outcomes?.find(
        (o) => o.name && nameMatches(o.name, awayTeamName),
      );
      const over = totals?.outcomes?.find(
        (o) => (o.name ?? "").toLowerCase() === "over",
      );
      const under = totals?.outcomes?.find(
        (o) => (o.name ?? "").toLowerCase() === "under",
      );

      const region: BettingBookOdds["region"] = b.key.endsWith("_au")
        ? "au"
        : b.key.endsWith("_uk")
          ? "uk"
          : b.key.endsWith("_nz") || b.key === "tab"
            ? "nz"
            : b.key.startsWith("bet365")
              ? "uk"
              : "unknown";

      books.push({
        key: b.key,
        provider: b.title ?? b.key,
        region,
        entainFamily: ENTAIN_KEYS.has(b.key),
        moneylineHome: typeof h2hHome?.price === "number" ? h2hHome.price : null,
        moneylineAway: typeof h2hAway?.price === "number" ? h2hAway.price : null,
        draw: typeof draw?.price === "number" ? draw.price : null,
        spreadPoint: typeof spHome?.point === "number" ? spHome.point : null,
        spreadHomeOdds: typeof spHome?.price === "number" ? spHome.price : null,
        spreadAwayOdds: typeof spAway?.price === "number" ? spAway.price : null,
        total: typeof over?.point === "number" ? over.point : null,
        overOdds: typeof over?.price === "number" ? over.price : null,
        underOdds: typeof under?.price === "number" ? under.price : null,
        lastUpdateIso: b.last_update ?? null,
      });
    }

    // Sort: Entain family first (Betcha's sister books), then AU, then UK,
    // then US — most-relevant for the NZ bettor at the top.
    const rank = (b: BettingBookOdds) =>
      b.entainFamily
        ? 0
        : b.region === "au"
          ? 1
          : b.region === "nz"
            ? 2
            : b.region === "uk"
              ? 3
              : b.region === "us"
                ? 4
                : 5;
    books.sort((a, b) => rank(a) - rank(b));
    return books;
  } catch {
    return [];
  }
}
