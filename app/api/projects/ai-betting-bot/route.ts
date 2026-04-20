import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";
import {
  METRIC_FRAMEWORK,
  BETTING_STAGES,
  parseOdds,
  type BettingAnalysisResult,
  type BettingChatPayload,
  type BettingFixture,
  type BettingMetricScore,
  type BettingRealData,
  type BettingRealDataTeam,
  type BettingStreamEvent,
  type BettingVerdict,
  type ParsedOdds,
} from "@/lib/betting-bot";
import {
  averageScore,
  findFixture,
  getEntainOdds,
  getEventPickcenter,
  getHeadToHead,
  getRecentGames,
  getTeamInjuries,
  getTeamStyle,
  restDaysBefore,
  sportFromHint,
  streakString,
  type EspnFixture,
  type EspnPastGame,
  type EspnInjury,
} from "@/lib/sports-data";
import {
  buildCalibrationSummary,
  formatCalibrationForPrompt,
  listTrackedBets,
} from "@/lib/betting-bot-bets";

/**
 * AI Betting Bot — streaming endpoint, grounded in ESPN's public sports API
 * -------------------------------------------------------------------------
 * Pipeline per request:
 *
 *   1.  Rate-limit + validate the chat payload.
 *   2.  Parse the natural-language query with a cheap LLM call into:
 *         { sport, teams[], dateHint, marketHint, pickSide }
 *       Today's date is always injected so "tomorrow" means *actual tomorrow*.
 *   3.  Map sport → ESPN path, then query the scoreboard in a date window
 *       around the user's hint and fuzzy-match the team name to find the
 *       real fixture (home team, away team, kickoff, venue, optional odds).
 *   4.  Pull injuries (per team) and the last 10 completed games (per team)
 *       from ESPN — same source a professional bettor would open.
 *   5.  Stream a *grounded* research transcript: the model sees the real
 *       fixture / injuries / form and is explicitly told NOT to invent
 *       stats. The UI renders each STAGE::/THINK:: line live.
 *   6.  Run a non-streaming json_object call to produce the final verdict.
 *   7.  Server recomputes edge / Kelly only when odds are present; otherwise
 *       the UI shows a "Add odds to price the edge" state.
 *
 * The whole response is SSE (text/event-stream) so the client can light up
 * stages the moment each piece arrives.
 */

const MODEL_PARSE = "gpt-4o-mini";
const MODEL_STREAM = "gpt-4o-mini";
const MODEL_STRUCT = "gpt-4o-mini";

const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function confidenceBinFor(
  pct: number,
): BettingAnalysisResult["confidenceBin"] {
  if (pct >= 72) return "elite";
  if (pct >= 60) return "high";
  if (pct >= 48) return "moderate";
  return "low";
}

function verdictLabelFor(v: BettingVerdict): string {
  switch (v) {
    case "strong_bet":
      return "Strong bet";
    case "bet":
      return "Bet";
    case "lean":
      return "Lean";
    case "pass":
      return "Pass";
    case "fade":
      return "Fade (other side)";
  }
}

function kellyFraction(fairProb: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const p = clamp(fairProb, 0, 1);
  const q = 1 - p;
  return (b * p - q) / b;
}

function normaliseVerdict(v: unknown): BettingVerdict {
  const s = String(v ?? "").toLowerCase().replace(/[^a-z_]/g, "");
  if (s === "strongbet" || s === "strong_bet") return "strong_bet";
  if (s === "bet") return "bet";
  if (s === "lean") return "lean";
  if (s === "fade") return "fade";
  return "pass";
}

function normaliseMetrics(raw: unknown): BettingMetricScore[] {
  const byKey = new Map<string, BettingMetricScore>();
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const key = typeof o.key === "string" ? o.key.trim() : "";
      if (!key) continue;
      const score = clamp(Number(o.score ?? 0), 0, 10);
      const confidence = clamp(Number(o.confidence ?? 0), 0, 10);
      const direction = ((): BettingMetricScore["direction"] => {
        const d = String(o.direction ?? "").toLowerCase();
        if (d === "for" || d === "against" || d === "neutral") return d;
        if (score >= 6) return "for";
        if (score <= 4) return "against";
        return "neutral";
      })();
      byKey.set(key.toLowerCase(), {
        key,
        score,
        confidence,
        direction,
        reasoning:
          typeof o.reasoning === "string" && o.reasoning.trim()
            ? o.reasoning.trim()
            : "insufficient data",
      });
    }
  }
  return METRIC_FRAMEWORK.map((m) => {
    const hit = byKey.get(m.key.toLowerCase());
    if (hit) return { ...hit, key: m.key };
    return {
      key: m.key,
      score: 5,
      confidence: 0,
      direction: "neutral",
      reasoning: "insufficient data",
    };
  });
}

function computeComposite(metrics: BettingMetricScore[]): number {
  let total = 0;
  let weightSum = 0;
  for (const m of metrics) {
    const frame = METRIC_FRAMEWORK.find((f) => f.key === m.key);
    const w = frame?.weight ?? 5;
    const effectiveWeight = w * (0.5 + m.confidence / 20);
    const effectiveScore = m.confidence === 0 ? 5 : m.score;
    total += effectiveScore * effectiveWeight;
    weightSum += effectiveWeight;
  }
  if (weightSum === 0) return 50;
  return clamp((total / weightSum) * 10, 0, 100);
}

function costFor(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): BettingAnalysisResult["cost"] {
  if (!usage) return null;
  const p = MODEL_PRICING_PER_MTOK[model] ?? { input: 0.5, output: 1.5 };
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const totalCostUsd =
    (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    totalCostUsd,
  };
}

function combineUsage(
  a: { prompt_tokens?: number; completion_tokens?: number } | undefined,
  b: { prompt_tokens?: number; completion_tokens?: number } | undefined,
  c?: { prompt_tokens?: number; completion_tokens?: number },
): { prompt_tokens?: number; completion_tokens?: number } | undefined {
  if (!a && !b && !c) return undefined;
  return {
    prompt_tokens:
      (a?.prompt_tokens ?? 0) + (b?.prompt_tokens ?? 0) + (c?.prompt_tokens ?? 0),
    completion_tokens:
      (a?.completion_tokens ?? 0) +
      (b?.completion_tokens ?? 0) +
      (c?.completion_tokens ?? 0),
  };
}

function encodeSse(obj: BettingStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

/* ── Intent parser (Call 0) ───────────────────────────────────────────── */

interface ParsedIntent {
  sport: string;
  teams: string[];
  dateHint: "today" | "tomorrow" | "this-weekend" | "next-7-days" | "past" | "unknown";
  marketHint: string;
  pickSide: string;
}

async function parseIntent(
  apiKey: string,
  query: string,
  todayIso: string,
  timezone: string | null,
): Promise<{
  intent: ParsedIntent;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}> {
  const tzLine = timezone
    ? `The user's IANA timezone is ${timezone}. Interpret "today" and "tomorrow" in THAT timezone, not UTC.`
    : `Interpret "today" and "tomorrow" in the user's local timezone.`;
  const prompt = `Today's real-world calendar date (in the user's timezone) is ${todayIso}.
${tzLine}
Extract the user's betting intent from their message. Return JSON only.

Schema:
{
  "sport": "NBA|NFL|NHL|MLB|EPL|La Liga|Serie A|Bundesliga|Ligue 1|Champions League|MLS|WNBA|NCAAF|NCAAB|UFC/MMA|Tennis|Soccer|Other",
  "teams": ["Team A", "Team B optional"],
  "dateHint": "today" | "tomorrow" | "this-weekend" | "next-7-days" | "past" | "unknown",
  "marketHint": "short description of the market/line, e.g. 'Over 2.5 goals' or 'Moneyline'",
  "pickSide": "which side the user is asking about"
}

User message: "${query.replace(/"/g, '\\"')}"`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_PARSE,
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 250,
        messages: [
          {
            role: "system",
            content:
              "You extract sports-betting intent. Return compact JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { intent: fallbackIntent(query) };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    if (data.usage && data.model) {
      logOpenAIUsage(data.model, "ai_betting_bot_parse", {
        prompt_tokens: data.usage.prompt_tokens ?? 0,
        completion_tokens: data.usage.completion_tokens ?? 0,
        total_tokens:
          (data.usage.prompt_tokens ?? 0) +
          (data.usage.completion_tokens ?? 0),
      });
    }
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<ParsedIntent>;
    return {
      intent: {
        sport: String(parsed.sport ?? "Other").trim(),
        teams: Array.isArray(parsed.teams)
          ? parsed.teams.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 2)
          : [],
        dateHint: (["today", "tomorrow", "this-weekend", "next-7-days", "past", "unknown"].includes(
          String(parsed.dateHint),
        )
          ? parsed.dateHint
          : "unknown") as ParsedIntent["dateHint"],
        marketHint: String(parsed.marketHint ?? "").trim() || "Unspecified",
        pickSide: String(parsed.pickSide ?? "").trim() || "Unspecified",
      },
      usage: data.usage,
    };
  } catch {
    return { intent: fallbackIntent(query) };
  }
}

function fallbackIntent(query: string): ParsedIntent {
  return {
    sport: "Other",
    teams: [],
    dateHint: /tomorrow/i.test(query)
      ? "tomorrow"
      : /tonight|today/i.test(query)
        ? "today"
        : "unknown",
    marketHint: "Unspecified",
    pickSide: query,
  };
}

/** Get the user's current calendar date in their own IANA timezone. */
function userTodayIso(tz: string | null | undefined): string {
  try {
    if (tz) {
      // "en-CA" formats YYYY-MM-DD, which is ISO-compatible.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    }
  } catch {
    /* fall through — bad tz */
  }
  return new Date().toISOString().slice(0, 10);
}

/** Parse an ISO "YYYY-MM-DD" into a UTC-noon Date so day arithmetic is
 *  DST-safe and the yyyymmdd() helper returns the same calendar day. */
function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
}

/**
 * Turn a user's date hint into an ESPN scoreboard window. We always widen
 * by 1 day on each side because:
 *   • ESPN's scoreboard uses US Eastern day boundaries, so a late-night
 *     NBA game on date D in ET often lands on D+1 in NZ/EU calendars
 *     (and vice-versa).
 *   • The intent parser can mis-pick between "today" and "tomorrow" when
 *     the user's phrasing is ambiguous.
 */
function dateRangeForHint(
  hint: ParsedIntent["dateHint"],
  todayIsoLocal: string,
): { start: Date; end: Date } {
  const today = ymdToDate(todayIsoLocal);
  const start = new Date(today);
  const end = new Date(today);
  switch (hint) {
    case "today":
      start.setUTCDate(start.getUTCDate() - 1);
      end.setUTCDate(end.getUTCDate() + 1);
      break;
    case "tomorrow":
      // Today … day-after-tomorrow (covers ET-boundary drift).
      end.setUTCDate(end.getUTCDate() + 2);
      break;
    case "this-weekend":
      end.setUTCDate(end.getUTCDate() + 7);
      break;
    case "next-7-days":
      end.setUTCDate(end.getUTCDate() + 7);
      break;
    case "past":
      start.setUTCDate(start.getUTCDate() - 7);
      end.setUTCDate(end.getUTCDate() + 1);
      break;
    case "unknown":
    default:
      start.setUTCDate(start.getUTCDate() - 1);
      end.setUTCDate(end.getUTCDate() + 7);
      break;
  }
  return { start, end };
}

/** Fallback window when the narrow search misses — spans most of the week. */
function wideRange(todayIsoLocal: string): { start: Date; end: Date } {
  const today = ymdToDate(todayIsoLocal);
  const start = new Date(today);
  const end = new Date(today);
  start.setUTCDate(start.getUTCDate() - 4);
  end.setUTCDate(end.getUTCDate() + 9);
  return { start, end };
}

/* ── Real-data collection (Steps 3–4) ─────────────────────────────────── */

async function collectRealData(
  sportPath: string,
  sportLabel: string,
  fixture: EspnFixture,
): Promise<BettingRealData> {
  // Parallelise everything — these are independent ESPN/odds-API calls.
  const [
    homeInjuries,
    awayInjuries,
    homeGames,
    awayGames,
    headToHead,
    homeStyle,
    awayStyle,
    pickcenter,
    entainBooks,
  ] = await Promise.all([
    getTeamInjuries(sportPath, fixture.homeTeam.id),
    getTeamInjuries(sportPath, fixture.awayTeam.id),
    getRecentGames(sportPath, fixture.homeTeam.id, 10),
    getRecentGames(sportPath, fixture.awayTeam.id, 10),
    getHeadToHead(sportPath, fixture.homeTeam.id, fixture.awayTeam.id, 5),
    getTeamStyle(sportPath, fixture.homeTeam.id),
    getTeamStyle(sportPath, fixture.awayTeam.id),
    getEventPickcenter(sportPath, fixture.id),
    getEntainOdds(
      sportPath,
      fixture.homeTeam.displayName,
      fixture.awayTeam.displayName,
      fixture.date || null,
    ),
  ]);

  // Books: Entain family first (Ladbrokes / Neds — Betcha's sister books),
  // then ESPN pickcenter as sanity check. De-dup by key.
  const seenKeys = new Set<string>();
  const books = [...entainBooks, ...pickcenter].filter((b) => {
    if (seenKeys.has(b.key)) return false;
    seenKeys.add(b.key);
    return true;
  });

  return {
    source: "espn",
    sportLabel,
    homeTeam: toRealDataTeam(
      fixture.homeTeam,
      homeInjuries,
      homeGames,
      homeStyle,
      fixture.date || null,
    ),
    awayTeam: toRealDataTeam(
      fixture.awayTeam,
      awayInjuries,
      awayGames,
      awayStyle,
      fixture.date || null,
    ),
    marketOdds: fixture.odds,
    books,
    headToHead,
  };
}

function toRealDataTeam(
  team: EspnFixture["homeTeam"],
  injuries: EspnInjury[],
  games: EspnPastGame[],
  style: Array<{ key: string; label: string; value: string }>,
  kickoffIso: string | null,
): BettingRealDataTeam {
  const avg = averageScore(games);
  return {
    id: team.id,
    displayName: team.displayName,
    abbreviation: team.abbreviation,
    logo: team.logo,
    record: team.record,
    last10Streak: streakString(games, 10),
    pointsForAvg: avg.ppg,
    pointsAgainstAvg: avg.opp,
    wins10: avg.wins,
    losses10: avg.losses,
    homeWins10: avg.homeWins,
    homeLosses10: avg.homeLosses,
    awayWins10: avg.awayWins,
    awayLosses10: avg.awayLosses,
    restDays: restDaysBefore(games, kickoffIso),
    marginAvg: avg.marginAvg,
    injuries: injuries.map((i) => ({
      name: i.playerName,
      position: i.position,
      status: i.status,
      detail: i.detail,
      headshot: i.headshot,
    })),
    recentGames: games.map((g) => ({
      date: g.date,
      opponentName: g.opponent.displayName,
      opponentAbbr: g.opponent.abbreviation,
      opponentLogo: g.opponent.logo,
      homeAway: g.homeAway,
      teamScore: g.teamScore,
      oppScore: g.oppScore,
      result: g.result,
    })),
    style,
  };
}

/* ── Prompt builders (use REAL data) ──────────────────────────────────── */

function summariseRealData(data: BettingRealData | null): string {
  if (!data || (!data.homeTeam && !data.awayTeam)) {
    return "No live sports data could be fetched for this sport / fixture. Your analysis must rely on general knowledge and clearly flag where specific numbers are unknown.";
  }
  const part = (label: string, t: BettingRealDataTeam | null) => {
    if (!t) return `${label}: (no data)`;
    const inj = t.injuries.length
      ? t.injuries
          .map(
            (i) =>
              `${i.name} (${i.position ?? "?"}) — ${i.status}${
                i.detail ? `: ${i.detail.slice(0, 160)}` : ""
              }`,
          )
          .join("; ")
      : "no listed injuries";
    const recent = t.recentGames.length
      ? t.recentGames
          .slice(0, 10)
          .map(
            (g) =>
              `${g.date.slice(0, 10)} ${g.homeAway === "home" ? "vs" : "@"} ${g.opponentAbbr}: ${g.teamScore}-${g.oppScore} (${g.result ?? "?"})`,
          )
          .join(" | ")
      : "no recent games";
    const style = t.style.length
      ? t.style.map((s) => `${s.label} ${s.value}`).join(", ")
      : "no season stats available";
    const splits = `home ${t.homeWins10}-${t.homeLosses10} / away ${t.awayWins10}-${t.awayLosses10}`;
    const restLine =
      t.restDays != null
        ? `rest ${t.restDays}d${t.restDays === 0 ? " (BACK-TO-BACK)" : t.restDays >= 3 ? " (well-rested)" : ""}`
        : "rest unknown";
    const marginLine = t.marginAvg != null ? `margin ${t.marginAvg > 0 ? "+" : ""}${t.marginAvg}/g` : "margin n/a";
    return `${label}: ${t.displayName} (${t.record ?? "record n/a"}) — last-10 ${t.last10Streak || "n/a"} (${splits}), ${marginLine}, avg ${t.pointsForAvg ?? "?"} for / ${t.pointsAgainstAvg ?? "?"} against, ${restLine}. Season stats: ${style}. Injuries: ${inj}. Recent games: ${recent}.`;
  };

  const h2hLine = data.headToHead.length
    ? `HEAD-TO-HEAD (last ${data.headToHead.length}, newest first): ${data.headToHead
        .map(
          (h) =>
            `${h.date.slice(0, 10)} ${h.awayTeam} ${h.awayScore ?? "?"}-${h.homeScore ?? "?"} ${h.homeTeam} (${h.winner ?? "?"} won)${h.venue ? ` at ${h.venue}` : ""}`,
        )
        .join(" | ")}.`
    : "HEAD-TO-HEAD: no recent meetings found in the available schedule data. Do not invent prior results.";

  const bookLines = data.books.length
    ? [
        `MARKET BOARD (${data.books.length} book${data.books.length === 1 ? "" : "s"}, Entain-family first):`,
        ...data.books.slice(0, 8).map((b) => {
          const parts: string[] = [];
          if (b.moneylineHome != null || b.moneylineAway != null) {
            parts.push(
              `ML ${b.moneylineHome?.toFixed(2) ?? "n/a"}/${b.moneylineAway?.toFixed(2) ?? "n/a"}${b.draw != null ? `/${b.draw.toFixed(2)}` : ""}`,
            );
          }
          if (b.spreadPoint != null) {
            parts.push(
              `spread ${b.spreadPoint > 0 ? "+" : ""}${b.spreadPoint} (${b.spreadHomeOdds?.toFixed(2) ?? "-"}/${b.spreadAwayOdds?.toFixed(2) ?? "-"})`,
            );
          }
          if (b.total != null) {
            parts.push(
              `total ${b.total} (O${b.overOdds?.toFixed(2) ?? "-"} / U${b.underOdds?.toFixed(2) ?? "-"})`,
            );
          }
          return `  • ${b.provider}${b.entainFamily ? " [ENTAIN = Betcha-equivalent]" : ""} — ${parts.join(", ")}`;
        }),
      ].join("\n")
    : "MARKET BOARD: no live odds available — explicitly state this instead of inventing prices, and advise the user to check Betcha.co.nz.";

  const legacyLine =
    data.marketOdds && !data.books.length
      ? `Scoreboard odds fallback (${data.marketOdds.provider ?? "ESPN"}): spread ${data.marketOdds.spread ?? "n/a"}, total ${data.marketOdds.overUnder ?? "n/a"}, ML home ${data.marketOdds.homeMoneyline ?? "n/a"} / away ${data.marketOdds.awayMoneyline ?? "n/a"}.`
      : "";

  return [
    part("HOME", data.homeTeam),
    part("AWAY", data.awayTeam),
    h2hLine,
    bookLines,
    legacyLine,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Try to pick the right price out of the book board for the user's pickSide.
 * Returns null when we can't confidently match (bet-specific e.g. "first
 * goalscorer" — Kelly/edge stays null in that case).
 */
function pickOddsFromBooks(
  data: BettingRealData | null,
  intent: ParsedIntent,
  fixture: EspnFixture | null,
): { odds: ParsedOdds; source: string } | null {
  if (!data?.books?.length || !fixture) return null;
  const preferred =
    data.books.find((b) => b.entainFamily) ??
    data.books.find((b) => b.region === "au" || b.region === "nz") ??
    data.books[0];
  if (!preferred) return null;

  const side = (intent.pickSide || "").toLowerCase();
  const market = (intent.marketHint || "").toLowerCase();
  const homeMatch = nameish(side, fixture.homeTeam.displayName);
  const awayMatch = nameish(side, fixture.awayTeam.displayName);

  // Totals (over/under).
  if (/\bover\b/.test(side) || /\bover\b/.test(market)) {
    if (preferred.overOdds) {
      return {
        odds: parseOdds(preferred.overOdds) as ParsedOdds,
        source: `${preferred.provider} over ${preferred.total ?? "?"}`,
      };
    }
  }
  if (/\bunder\b/.test(side) || /\bunder\b/.test(market)) {
    if (preferred.underOdds) {
      return {
        odds: parseOdds(preferred.underOdds) as ParsedOdds,
        source: `${preferred.provider} under ${preferred.total ?? "?"}`,
      };
    }
  }

  // Spread handicap (look for +x.5 / -x.5 style).
  if (/\b(spread|handicap|line)\b/.test(market)) {
    if (homeMatch && preferred.spreadHomeOdds) {
      return {
        odds: parseOdds(preferred.spreadHomeOdds) as ParsedOdds,
        source: `${preferred.provider} ${fixture.homeTeam.displayName} ${preferred.spreadPoint ?? ""}`,
      };
    }
    if (awayMatch && preferred.spreadAwayOdds) {
      return {
        odds: parseOdds(preferred.spreadAwayOdds) as ParsedOdds,
        source: `${preferred.provider} ${fixture.awayTeam.displayName} ${preferred.spreadPoint != null ? -preferred.spreadPoint : ""}`,
      };
    }
  }

  // Moneyline default when the pickSide is a team.
  if (homeMatch && preferred.moneylineHome) {
    return {
      odds: parseOdds(preferred.moneylineHome) as ParsedOdds,
      source: `${preferred.provider} ${fixture.homeTeam.displayName} ML`,
    };
  }
  if (awayMatch && preferred.moneylineAway) {
    return {
      odds: parseOdds(preferred.moneylineAway) as ParsedOdds,
      source: `${preferred.provider} ${fixture.awayTeam.displayName} ML`,
    };
  }
  return null;
}

function nameish(a: string, b: string): boolean {
  if (!a || !b) return false;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const an = norm(a);
  const bn = norm(b);
  return an.includes(bn) || bn.includes(an);
}

function buildResearchPrompt(
  query: string,
  userOdds: ParsedOdds | null,
  notes: string,
  fixture: EspnFixture | null,
  realData: BettingRealData | null,
  todayIso: string,
  calibration: string,
  timezone: string | null,
): string {
  const stageList = BETTING_STAGES.map((s) => `  - ${s.id}: ${s.label}`).join(
    "\n",
  );

  const fixtureLine = fixture
    ? `CONFIRMED FIXTURE (from ESPN): ${fixture.awayTeam.displayName} @ ${fixture.homeTeam.displayName} — ${fixture.date} — ${fixture.venue?.fullName ?? "venue tbd"}${fixture.venue?.city ? `, ${fixture.venue.city}` : ""}.`
    : "NO CONFIRMED FIXTURE — ESPN did not return a match. Do not invent teams, venue or kickoff time.";

  const oddsLine = userOdds
    ? `User-supplied / auto-resolved odds: ${userOdds.decimal.toFixed(2)} decimal (${
        userOdds.american > 0 ? "+" : ""
      }${userOdds.american} American) → book implied ${userOdds.impliedPct.toFixed(
        2,
      )}%. Use this as the working price.`
    : "No odds supplied by the user AND none resolved from the market board. Do NOT invent a price. State that edge/Kelly cannot be computed without odds and recommend the user check Betcha.co.nz for the real price.";

  return `You are an elite AI sports-betting analyst. You are grounded in VERIFIED
real-world data below — never contradict it, never invent stats, teams,
players or dates that contradict the verified block.

TODAY'S REAL-WORLD DATE (in the user's local timezone${timezone ? ` — ${timezone}` : ""}): ${todayIso}.
If the user says "tomorrow", that is literally the day after ${todayIso} in
${timezone ?? "their local"} time. Do NOT reason as if it were 2023 or any
other year.

${calibration ? `${calibration}\n\n` : ""}${fixtureLine}

REAL DATA (injuries, last-10 games, records, head-to-head, market board) —
this is your authoritative source. Use specific names and numbers from here
when you cite facts.
${summariseRealData(realData)}

USER NOTES:
${notes.trim() || "(none)"}

USER QUERY:
"${query.replace(/"/g, '\\"')}"

${oddsLine}

HOW TO WRITE EACH STAGE (this is critical — do not say "no verified data" if
data IS in the REAL DATA block above):
  • form:        cite ACTUAL last-10 records, margin per game, home/away
                 splits, rest days, any back-to-back flag, and any injury
                 names from the block.
  • h2h:         use the HEAD-TO-HEAD block above. Quote specific prior
                 meeting dates + scores. Only say "no meetings" if the
                 block literally says none.
  • tactical:    reason from pace (ppg + opp ppg → projected total) and the
                 style stats (FG%, 3P%, rebounds, turnovers, etc) that are
                 present. If one team averages 115 for vs a team allowing
                 110, name those numbers.
  • market:     quote the MARKET BOARD lines above — compare Entain/Betcha-
                 equivalent prices to other books, and compare the projected
                 pace/total vs the posted total for O/U trend reads.
  • value:       compute fair win probability from form + H2H + injuries,
                 convert to fair decimal (1/prob), then compare to the
                 user/auto-resolved price. Name the edge in %. If no odds
                 exist say so explicitly.

Emit your research as a STREAM using EXACTLY this protocol, one item per line:
  STAGE:: <stage-id>        (starts a stage)
  THINK:: <one sentence>    (a concrete research note — cite specific names /
                             scores / stats from the real data above)
  FIXTURE:: {"homeTeam":"...","awayTeam":"...","competition":"...","kickoffIso":"ISO or null","venue":"... or null"}

Rules:
  - No markdown, no bullets, no greetings.
  - Emit FIXTURE:: once, immediately during the "fixture" stage, using the
    CONFIRMED FIXTURE above verbatim if available.
  - Every THINK:: that claims a stat must come from the real-data block.
    When the real-data block doesn't have a number, say "no verified data"
    rather than inventing one — but FIRST check the block; most of the
    time the number IS there.
  - Emit 2–4 THINK:: per stage, ordered exactly as:
${stageList}

Stop after STAGE:: synthesis. The next call produces the structured verdict.`;
}

function buildStructuredPrompt(
  query: string,
  transcript: string,
  fixture: BettingFixture | null,
  parsedOdds: ParsedOdds | null,
  notes: string,
  realData: BettingRealData | null,
  todayIso: string,
): string {
  const rows = METRIC_FRAMEWORK.map(
    (m) => `- "${m.key}" (weight ${m.weight}/100): ${m.description}`,
  ).join("\n");

  const oddsContext = parsedOdds
    ? `User provided odds: ${parsedOdds.decimal.toFixed(2)} decimal (${
        parsedOdds.american > 0 ? "+" : ""
      }${parsedOdds.american} American). Use this as the book price. Do NOT invent a different one.`
    : `User did NOT provide odds. Set oddsDecimal = null and oddsSource = "unknown". Do NOT invent a market price. Verdict must reflect that edge cannot be priced — set verdict to "pass" UNLESS your fairWinProbability >= 60 AND confidence >= 55 (in which case it can be "lean"). Never "bet"/"strong_bet" without odds.`;

  return `Today is ${todayIso}. Produce the final verdict JSON for this bet.

USER QUERY:
"${query.replace(/"/g, '\\"')}"

USER NOTES:
${notes.trim() || "(none)"}

FIXTURE (already resolved):
${fixture ? JSON.stringify(fixture) : "(not resolved — analysis must be qualitative)"}

REAL DATA CONTEXT:
${summariseRealData(realData)}

PRICING CONTEXT:
${oddsContext}

RESEARCH TRANSCRIPT (your own notes):
${transcript.slice(0, 6000)}

METRIC FRAMEWORK — score each 0–10 (10 = maximum edge FOR the pick,
5 = neutral, 0 = strongly against). Also score data confidence 0–10 per
metric (how much real evidence you actually cited).

${rows}

RULES:
1. Never invent specific stats. If the transcript / real-data block didn't
   surface a number, mark the metric reasoning as "no verified data" and
   set its confidence <= 3.
2. fairWinProbabilityPct must be 1–99 and must be consistent with the
   9 scores and the real-data picture (e.g. a favourite with injury-healthy
   starters at home should typically price higher than 45%).
3. confidencePct: 0–80 (cap 80). If > 4 metrics have confidence ≤ 3,
   cap at 55.
4. Verdict rules (ONLY when odds were provided):
   - edge ≥ +4% AND confidence ≥ 65 AND ≤ 2 against-metrics  → "strong_bet"
   - edge ≥ +2% AND confidence ≥ 55                           → "bet"
   - edge ≥ +1% AND confidence ≥ 45                           → "lean"
   - edge between −1% and +1% OR confidence < 45              → "pass"
   - edge ≤ −2% with high-confidence against metrics          → "fade"
   When odds are NOT provided, follow the oddsContext rule above.
5. summary: 2–4 paragraphs separated by \\n\\n. Reference specific players
   / teams from the real data block. The first paragraph is the thesis.
6. risks: 3–5 concrete losing scenarios, named where possible (e.g.
   "if [Player X] is upgraded to active, the line shifts...").
7. informationGaps: 3–5 concrete checks the user should still run.

Return ONLY valid JSON in EXACTLY this shape:
{
  "pickSummary": "one-sentence resolved pick",
  "marketNormalized": "e.g. 'Moneyline - Away' / 'Over 9.5 corners'",
  "fairWinProbabilityPct": <1-99>,
  "confidencePct": <0-80>,
  "verdict": "strong_bet" | "bet" | "lean" | "pass" | "fade",
  "verdictRationale": "one sentence",
  "summary": "2-4 paragraphs separated by \\n\\n",
  "risks": ["...", "..."],
  "informationGaps": ["...", "..."],
  "metrics": [
    { "key": "Recent form & momentum", "score": 0-10, "confidence": 0-10, "direction": "for|against|neutral", "reasoning": "..." }
    /* exactly 9 entries in framework order */
  ]
}`;
}

/* ── Streaming helpers for the research call ──────────────────────────── */

async function* openAiTokenStream(
  res: Response,
): AsyncGenerator<
  string,
  { usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string }
> {
  if (!res.body) return {};
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let lastModel: string | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return { usage: lastUsage, model: lastModel };
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            model?: string;
          };
          if (parsed.model) lastModel = parsed.model;
          if (parsed.usage) lastUsage = parsed.usage;
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) yield chunk;
        } catch {
          /* ignore malformed chunks */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { usage: lastUsage, model: lastModel };
}

/* ── Route handler ────────────────────────────────────────────────────── */

export async function POST(request: NextRequest) {
  const limited = enforceApiRateLimit(request, "ai_betting_bot");
  if (limited) return limited;

  const apiKey =
    process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: BettingChatPayload;
  try {
    body = (await request.json()) as BettingChatPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = String(body.query ?? "").trim();
  if (query.length < 3) {
    return NextResponse.json(
      {
        error: "Please describe the bet in plain English.",
        hint: "e.g. 'Arsenal over 2.5 goals vs Chelsea tomorrow'.",
      },
      { status: 400 },
    );
  }
  const notes = String(body.notes ?? "").trim();
  // User-supplied odds take precedence; if blank, we try to fill from
  // Entain/market books after the fixture + real-data lookup below.
  let parsedOdds =
    body.odds != null && String(body.odds).trim() !== ""
      ? parseOdds(body.odds)
      : null;
  let oddsSourceLabel: string | null = parsedOdds ? "user" : null;
  const bankroll =
    body.bankroll === null ||
    body.bankroll === undefined ||
    body.bankroll === ""
      ? null
      : Number(body.bankroll);

  const clientTimezone =
    typeof body.timezone === "string" && body.timezone.trim()
      ? body.timezone.trim()
      : null;
  // "Today" and "tomorrow" are resolved in the user's IANA timezone so an
  // Auckland bettor saying "tomorrow" doesn't collide with Vercel's UTC
  // idea of tomorrow.
  const todayIso = userTodayIso(clientTimezone);

  // Pull this user's historical calibration so we can feed it back to the
  // model (self-improvement loop). Best-effort — if auth or DB lookup fails
  // we still run the analysis, just without the calibration adjustment.
  let calibrationPrompt = "";
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (supabaseUrl && supabaseAnonKey) {
        const token = authHeader.replace("Bearer ", "");
        const authed = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const {
          data: { user },
        } = await authed.auth.getUser(token);
        if (user?.id) {
          const bets = await listTrackedBets(user.id);
          const summary = buildCalibrationSummary(bets);
          calibrationPrompt = formatCalibrationForPrompt(summary);
        }
      }
    }
  } catch {
    /* non-fatal */
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: BettingStreamEvent) => controller.enqueue(encodeSse(ev));

      // Stage 1 — parse.
      send({
        type: "stage",
        stage: "parse",
        label: BETTING_STAGES[0]!.label,
        status: "running",
      });

      const { intent, usage: parseUsage } = await parseIntent(
        apiKey,
        query,
        todayIso,
        clientTimezone,
      );

      const sport = sportFromHint(`${intent.sport} ${query}`);
      const teamHint = intent.teams.join(" ") || intent.pickSide;

      send({
        type: "thought",
        stage: "parse",
        text: `Detected ${sport?.label ?? (intent.sport || "sport unknown")} · teams: ${intent.teams.join(" & ") || "(unresolved)"} · when: ${intent.dateHint}.`,
      });

      // Stage 2 — fixture lookup via ESPN.
      send({
        type: "stage",
        stage: "parse",
        label: BETTING_STAGES[0]!.label,
        status: "done",
      });
      send({
        type: "stage",
        stage: "fixture",
        label: "Finding the fixture (ESPN)",
        status: "running",
      });

      let espnFixture: EspnFixture | null = null;
      let realData: BettingRealData | null = null;

      if (sport && teamHint) {
        const { start, end } = dateRangeForHint(intent.dateHint, todayIso);
        const windowLabel = `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;
        send({
          type: "thought",
          stage: "fixture",
          text: `Searching ESPN ${sport.label} scoreboard ${windowLabel}${clientTimezone ? ` (your zone: ${clientTimezone})` : ""} for "${teamHint}".`,
        });
        espnFixture = await findFixture(sport.path, start, end, teamHint);

        // Wide fallback — ESPN uses US Eastern day boundaries and the
        // dateline can push NZ/EU calendars ±1 day off, so try a broader
        // window before giving up.
        if (!espnFixture) {
          const wide = wideRange(todayIso);
          send({
            type: "thought",
            stage: "fixture",
            text: `No hit in the narrow window — widening to ${wide.start.toISOString().slice(0, 10)} → ${wide.end.toISOString().slice(0, 10)} to absorb timezone drift…`,
          });
          espnFixture = await findFixture(
            sport.path,
            wide.start,
            wide.end,
            teamHint,
          );
        }

        if (espnFixture) {
          const kickoffLabel = clientTimezone
            ? new Date(espnFixture.date).toLocaleString("en-US", {
                timeZone: clientTimezone,
                dateStyle: "medium",
                timeStyle: "short",
              })
            : new Date(espnFixture.date).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              });
          send({
            type: "thought",
            stage: "fixture",
            text: `ESPN match: ${espnFixture.awayTeam.displayName} @ ${espnFixture.homeTeam.displayName} — ${kickoffLabel}${clientTimezone ? ` ${clientTimezone}` : ""}${espnFixture.venue ? ` — ${espnFixture.venue.fullName}` : ""}.`,
          });
          // Emit early fixture card.
          send({
            type: "fixture",
            fixture: {
              homeTeam: espnFixture.homeTeam.displayName,
              awayTeam: espnFixture.awayTeam.displayName,
              competition: sport.label,
              kickoffIso: espnFixture.date || null,
              venue: espnFixture.venue?.fullName ?? null,
            },
          });

          // Stage 3 — real data collection.
          send({
            type: "stage",
            stage: "fixture",
            label: "Finding the fixture (ESPN)",
            status: "done",
          });
          send({
            type: "stage",
            stage: "form",
            label: "Pulling real injuries & last-10 games (ESPN)",
            status: "running",
          });

          realData = await collectRealData(sport.path, sport.label, espnFixture);

          if (realData.homeTeam) {
            const h = realData.homeTeam;
            send({
              type: "thought",
              stage: "form",
              text: `${h.displayName} (${h.record ?? "record n/a"}) — last-10 ${h.last10Streak || "n/a"} avg ${h.pointsForAvg ?? "?"} for / ${h.pointsAgainstAvg ?? "?"} against.`,
            });
            if (h.injuries.length) {
              send({
                type: "thought",
                stage: "injuries",
                text: `${h.displayName} injuries: ${h.injuries
                  .slice(0, 5)
                  .map((i) => `${i.name} (${i.status})`)
                  .join(", ")}.`,
              });
            }
          }
          if (realData.awayTeam) {
            const a = realData.awayTeam;
            send({
              type: "thought",
              stage: "form",
              text: `${a.displayName} (${a.record ?? "record n/a"}) — last-10 ${a.last10Streak || "n/a"} avg ${a.pointsForAvg ?? "?"} for / ${a.pointsAgainstAvg ?? "?"} against.`,
            });
            if (a.injuries.length) {
              send({
                type: "thought",
                stage: "injuries",
                text: `${a.displayName} injuries: ${a.injuries
                  .slice(0, 5)
                  .map((i) => `${i.name} (${i.status})`)
                  .join(", ")}.`,
              });
            }
          }

          // Head-to-head summary thought.
          if (realData.headToHead.length) {
            const h2h = realData.headToHead;
            const homeName = realData.homeTeam?.displayName ?? "";
            const homeWins = h2h.filter(
              (g) =>
                (g.winner === "home" && g.homeTeam === homeName) ||
                (g.winner === "away" && g.awayTeam === homeName),
            ).length;
            send({
              type: "thought",
              stage: "form",
              text: `H2H last ${h2h.length}: ${realData.homeTeam?.abbreviation ?? "H"} ${homeWins}-${h2h.length - homeWins} ${realData.awayTeam?.abbreviation ?? "A"}. Most recent: ${h2h[0]!.date.slice(0, 10)} ${h2h[0]!.awayTeam} ${h2h[0]!.awayScore ?? "?"}-${h2h[0]!.homeScore ?? "?"} ${h2h[0]!.homeTeam}.`,
            });
          } else {
            send({
              type: "thought",
              stage: "form",
              text: `No recent head-to-head found in the available ESPN schedule data — treating as neutral prior.`,
            });
          }

          // Market board thought.
          if (realData.books.length) {
            const best =
              realData.books.find((b) => b.entainFamily) ??
              realData.books[0]!;
            const mlHome = best.moneylineHome?.toFixed(2) ?? "?";
            const mlAway = best.moneylineAway?.toFixed(2) ?? "?";
            const totalLine =
              best.total != null
                ? ` · total ${best.total} (O${best.overOdds?.toFixed(2) ?? "-"}/U${best.underOdds?.toFixed(2) ?? "-"})`
                : "";
            send({
              type: "thought",
              stage: "fixture",
              text: `Market board (${realData.books.length} book${realData.books.length === 1 ? "" : "s"}, top: ${best.provider}${best.entainFamily ? " – Entain/Betcha-equivalent" : ""}): ML ${mlHome}/${mlAway}${totalLine}.`,
            });
          } else {
            send({
              type: "thought",
              stage: "fixture",
              text: process.env.ODDS_API_KEY
                ? `No live odds returned — the-odds-api has no matching event right now. Check Betcha.co.nz directly for the price.`
                : `No live odds (ODDS_API_KEY env not set). Add a free key from the-odds-api.com to pull Ladbrokes/Neds/TAB prices automatically.`,
            });
          }

          // Auto-fill odds from the book board when the user didn't supply one.
          if (!parsedOdds) {
            const picked = pickOddsFromBooks(realData, intent, espnFixture);
            if (picked) {
              parsedOdds = picked.odds;
              oddsSourceLabel = picked.source;
              send({
                type: "thought",
                stage: "fixture",
                text: `Auto-used ${picked.source} = ${picked.odds.decimal.toFixed(2)} decimal for edge/Kelly math — user did not supply odds.`,
              });
            }
          }
        } else {
          send({
            type: "thought",
            stage: "fixture",
            text: `No matching ${sport.label} fixture on ESPN for that window — falling back to qualitative analysis.`,
          });
          send({
            type: "stage",
            stage: "fixture",
            label: "Finding the fixture (ESPN)",
            status: "done",
          });
        }
      } else {
        send({
          type: "thought",
          stage: "fixture",
          text: `No live data source for ${intent.sport} — analysis will be qualitative.`,
        });
        send({
          type: "stage",
          stage: "fixture",
          label: "Finding the fixture (ESPN)",
          status: "done",
        });
      }

      // Stage 4 — research stream (grounded).
      const researchPrompt = buildResearchPrompt(
        query,
        parsedOdds,
        notes,
        espnFixture,
        realData,
        todayIso,
        calibrationPrompt,
        clientTimezone,
      );

      let transcript = "";
      let currentStage = realData ? "form" : "parse";
      let fixtureEvt: BettingFixture | null = null;
      let streamUsage:
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined;
      let streamModel: string | undefined;

      try {
        const res = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: MODEL_STREAM,
              stream: true,
              stream_options: { include_usage: true },
              temperature: 0.3,
              max_tokens: 1400,
              messages: [
                {
                  role: "system",
                  content:
                    "You are a professional sports-betting analyst. You emit research transcripts in the STAGE::/THINK::/FIXTURE:: protocol only. You never invent stats that aren't in the verified real-data block — when data is missing, you say 'no verified data'.",
                },
                { role: "user", content: researchPrompt },
              ],
            }),
            signal: AbortSignal.timeout(60_000),
          },
        );

        if (!res.ok) {
          const text = await res.text();
          send({
            type: "error",
            message: `OpenAI stream failed (${res.status}): ${text.slice(0, 300)}`,
          });
          controller.close();
          return;
        }

        let pending = "";
        const gen = openAiTokenStream(res);
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            const meta = value as
              | { usage?: typeof streamUsage; model?: string }
              | undefined;
            if (meta?.usage) streamUsage = meta.usage;
            if (meta?.model) streamModel = meta.model;
            break;
          }
          transcript += value;
          pending += value;
          let nl: number;
          while ((nl = pending.indexOf("\n")) !== -1) {
            const rawLine = pending.slice(0, nl);
            pending = pending.slice(nl + 1);
            handleProtocolLine(rawLine);
          }
        }
        if (pending.trim()) handleProtocolLine(pending);

        send({
          type: "stage",
          stage: currentStage,
          label:
            BETTING_STAGES.find((s) => s.id === currentStage)?.label ??
            currentStage,
          status: "done",
        });

        function handleProtocolLine(raw: string) {
          const line = raw.trim();
          if (!line) return;

          if (line.startsWith("STAGE::")) {
            const next = line.slice("STAGE::".length).trim().toLowerCase();
            if (!next || next === currentStage) return;
            send({
              type: "stage",
              stage: currentStage,
              label:
                BETTING_STAGES.find((s) => s.id === currentStage)?.label ??
                currentStage,
              status: "done",
            });
            currentStage = next;
            send({
              type: "stage",
              stage: next,
              label:
                BETTING_STAGES.find((s) => s.id === next)?.label ??
                next.charAt(0).toUpperCase() + next.slice(1),
              status: "running",
            });
            return;
          }

          if (line.startsWith("THINK::")) {
            const text = line.slice("THINK::".length).trim();
            if (text) send({ type: "thought", stage: currentStage, text });
            return;
          }

          if (line.startsWith("FIXTURE::")) {
            const jsonPart = line.slice("FIXTURE::".length).trim();
            try {
              const raw = JSON.parse(jsonPart) as Partial<BettingFixture>;
              const fx: BettingFixture = {
                homeTeam: String(raw.homeTeam ?? "").trim(),
                awayTeam: String(raw.awayTeam ?? "").trim(),
                competition: String(raw.competition ?? "").trim(),
                kickoffIso:
                  typeof raw.kickoffIso === "string" && raw.kickoffIso.trim()
                    ? raw.kickoffIso.trim()
                    : null,
                venue:
                  typeof raw.venue === "string" && raw.venue.trim()
                    ? raw.venue.trim()
                    : null,
              };
              if (fx.homeTeam && fx.awayTeam) {
                fixtureEvt = fx;
                // Only re-emit if we didn't already send a fixture from ESPN.
                if (!espnFixture) {
                  send({ type: "fixture", fixture: fx });
                }
              }
            } catch {
              /* ignore */
            }
            return;
          }
        }
      } catch (e) {
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
        controller.close();
        return;
      }

      if (streamUsage && streamModel) {
        logOpenAIUsage(streamModel, "ai_betting_bot_research", {
          prompt_tokens: streamUsage.prompt_tokens ?? 0,
          completion_tokens: streamUsage.completion_tokens ?? 0,
          total_tokens:
            (streamUsage.prompt_tokens ?? 0) +
            (streamUsage.completion_tokens ?? 0),
        });
      }

      // Stage 5 — structured final.
      send({
        type: "stage",
        stage: "synthesis",
        label: "Scoring and finalising",
        status: "running",
      });

      // Prefer ESPN's resolved fixture (more reliable); fall back to whatever
      // the model emitted via FIXTURE::.
      const authoritativeFixture: BettingFixture | null = espnFixture
        ? {
            homeTeam: espnFixture.homeTeam.displayName,
            awayTeam: espnFixture.awayTeam.displayName,
            competition: sport?.label ?? "",
            kickoffIso: espnFixture.date || null,
            venue: espnFixture.venue?.fullName ?? null,
          }
        : fixtureEvt;

      const structuredPrompt = buildStructuredPrompt(
        query,
        transcript,
        authoritativeFixture,
        parsedOdds,
        notes,
        realData,
        todayIso,
      );

      let finalContent: Record<string, unknown>;
      let structUsage:
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined;

      try {
        const res = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: MODEL_STRUCT,
              temperature: 0.15,
              response_format: { type: "json_object" },
              max_tokens: 1600,
              messages: [
                {
                  role: "system",
                  content:
                    "You are a professional sports-betting analyst. Return valid JSON only. You never fabricate specific stats not supported by the provided real-data block. If odds are missing you must reflect that the edge is unknown.",
                },
                { role: "user", content: structuredPrompt },
              ],
            }),
            signal: AbortSignal.timeout(40_000),
          },
        );
        if (!res.ok) {
          const text = await res.text();
          send({
            type: "error",
            message: `Structured call failed (${res.status}): ${text.slice(0, 300)}`,
          });
          controller.close();
          return;
        }
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          model?: string;
        };
        structUsage = data.usage;
        if (data.usage && data.model) {
          logOpenAIUsage(data.model, "ai_betting_bot_structured", {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens:
              (data.usage.prompt_tokens ?? 0) +
              (data.usage.completion_tokens ?? 0),
          });
        }
        const raw = data.choices?.[0]?.message?.content ?? "{}";
        finalContent = JSON.parse(raw) as Record<string, unknown>;
      } catch (e) {
        send({
          type: "error",
          message:
            "Could not structure the final report: " +
            (e instanceof Error ? e.message : String(e)),
        });
        controller.close();
        return;
      }

      // ── Server-side math ──────────────────────────────────────────
      const metrics = normaliseMetrics(finalContent.metrics);
      const compositeScore = computeComposite(metrics);
      const modelFairPct = clamp(
        Number(
          (finalContent as { fairWinProbabilityPct?: number })
            .fairWinProbabilityPct ?? 50,
        ),
        1,
        99,
      );

      const oddsMissing = !parsedOdds;
      const oddsUsed: ParsedOdds | null = parsedOdds;
      // "user" when the user typed odds, "estimated-market" when we filled
      // them from the live book board (Entain / ESPN pickcenter), "unknown"
      // when we had to give up and not price the edge.
      const oddsSource: BettingAnalysisResult["oddsSource"] = parsedOdds
        ? oddsSourceLabel === "user"
          ? "user"
          : "estimated-market"
        : "unknown";

      const bookImpliedProbabilityPct = oddsUsed ? oddsUsed.impliedPct : null;
      const edgePct =
        oddsUsed && bookImpliedProbabilityPct !== null
          ? modelFairPct - bookImpliedProbabilityPct
          : null;

      const kelly =
        oddsUsed !== null
          ? (() => {
              const full = kellyFraction(modelFairPct / 100, oddsUsed.decimal);
              const half = full * 0.5;
              const quarter = full * 0.25;
              const recommended =
                bankroll !== null && Number.isFinite(bankroll) && bankroll > 0
                  ? Math.max(0, half * bankroll)
                  : null;
              return {
                fullPct: Number((full * 100).toFixed(2)),
                halfPct: Number((half * 100).toFixed(2)),
                quarterPct: Number((quarter * 100).toFixed(2)),
                recommendedStakeUsd:
                  recommended === null ? null : Number(recommended.toFixed(2)),
              };
            })()
          : null;

      const rawConfidence = clamp(
        Number(
          (finalContent as { confidencePct?: number }).confidencePct ?? 0,
        ),
        0,
        80,
      );
      const hasUserNotes = notes.length >= 40;
      const hasRealData = !!(
        realData &&
        (realData.homeTeam || realData.awayTeam)
      );
      // When we have real ESPN data, we allow the raw ceiling; otherwise
      // clamp because the model was operating on memory alone.
      const baseCeiling = hasRealData ? 80 : hasUserNotes ? 65 : 55;
      const confidencePct = Math.min(rawConfidence, baseCeiling);

      // Force verdict to "pass" when no odds — we cannot price an edge.
      let verdict = normaliseVerdict(finalContent.verdict);
      if (oddsMissing && (verdict === "bet" || verdict === "strong_bet")) {
        verdict = modelFairPct >= 60 && confidencePct >= 55 ? "lean" : "pass";
      }

      const result: BettingAnalysisResult = {
        fixture: authoritativeFixture,
        pickSummary:
          typeof finalContent.pickSummary === "string"
            ? finalContent.pickSummary.trim()
            : query,
        marketNormalized:
          typeof finalContent.marketNormalized === "string"
            ? finalContent.marketNormalized.trim()
            : "Unspecified market",
        oddsUsed,
        oddsSource,
        oddsMissing,
        verdict,
        verdictLabel: verdictLabelFor(verdict),
        verdictRationale:
          typeof finalContent.verdictRationale === "string"
            ? finalContent.verdictRationale
            : "",
        fairWinProbabilityPct: Number(modelFairPct.toFixed(2)),
        bookImpliedProbabilityPct:
          bookImpliedProbabilityPct !== null
            ? Number(bookImpliedProbabilityPct.toFixed(2))
            : null,
        edgePct: edgePct !== null ? Number(edgePct.toFixed(2)) : null,
        kelly,
        confidencePct: Number(confidencePct.toFixed(1)),
        confidenceBin: confidenceBinFor(confidencePct),
        compositeScore: Number(compositeScore.toFixed(1)),
        metrics,
        summary:
          typeof finalContent.summary === "string" &&
          finalContent.summary.trim()
            ? finalContent.summary.trim()
            : "No narrative summary returned.",
        risks: Array.isArray(finalContent.risks)
          ? finalContent.risks
              .map((r: unknown) => (typeof r === "string" ? r.trim() : ""))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        informationGaps: Array.isArray(finalContent.informationGaps)
          ? finalContent.informationGaps
              .map((r: unknown) => (typeof r === "string" ? r.trim() : ""))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        realData,
        generatedAt: new Date().toISOString(),
        cost: costFor(
          MODEL_STRUCT,
          combineUsage(parseUsage, streamUsage, structUsage),
        ),
      };

      send({
        type: "stage",
        stage: "synthesis",
        label: "Scoring and finalising",
        status: "done",
      });
      send({
        type: "final",
        result,
        track: {
          sportPath: sport?.path ?? null,
          espnEventId: espnFixture?.id ?? null,
          espnHomeTeamId: espnFixture?.homeTeam.id ?? null,
          espnAwayTeamId: espnFixture?.awayTeam.id ?? null,
        },
      });
      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
