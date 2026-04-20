import "server-only";

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

/**
 * Search the scoreboard over an inclusive date range and return the best
 * event matching one or both of the team hints. Hints are free-text
 * snippets like "Arsenal" or "Lakers Chiefs".
 */
export async function findFixture(
  sportPath: string,
  startDate: Date,
  endDate: Date,
  teamHint: string,
): Promise<EspnFixture | null> {
  const start = yyyymmdd(startDate);
  const end = yyyymmdd(endDate);
  const range = start === end ? start : `${start}-${end}`;
  const data = await espnGet<ScoreboardResponse>(
    `${ESPN_BASE}/${sportPath}/scoreboard?dates=${range}&limit=400`,
  );
  if (!data?.events?.length) return null;

  const hintTokens = teamHint
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

  let best: { fx: EspnFixture; score: number } | null = null;
  for (const event of data.events) {
    const fx = toFixture(event);
    if (!fx) continue;
    const names = [
      fx.homeTeam.displayName,
      fx.homeTeam.shortName,
      fx.homeTeam.abbreviation,
      fx.awayTeam.displayName,
      fx.awayTeam.shortName,
      fx.awayTeam.abbreviation,
    ]
      .map((s) => s.toLowerCase())
      .join(" ");

    let score = 0;
    for (const tok of hintTokens) {
      if (names.includes(tok)) score += 2;
    }
    if (score === 0) continue;
    if (!best || score > best.score) best = { fx, score };
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
} {
  const valid = games.filter(
    (g) => g.teamScore != null && g.oppScore != null,
  );
  if (!valid.length) return { ppg: null, opp: null, wins: 0, losses: 0 };
  const ppg =
    valid.reduce((a, g) => a + (g.teamScore ?? 0), 0) / valid.length;
  const opp =
    valid.reduce((a, g) => a + (g.oppScore ?? 0), 0) / valid.length;
  const wins = valid.filter((g) => g.result === "W").length;
  const losses = valid.filter((g) => g.result === "L").length;
  return {
    ppg: Number(ppg.toFixed(1)),
    opp: Number(opp.toFixed(1)),
    wins,
    losses,
  };
}
