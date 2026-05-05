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
  sportCandidatesFromHint,
  sportFromHint,
  streakString,
  type EspnFixture,
  type EspnPastGame,
  type EspnInjury,
  type SportKey,
} from "@/lib/sports-data";
import {
  buildCalibrationSummary,
  formatCalibrationForPrompt,
  listTrackedBets,
} from "@/lib/betting-bot-bets";
import { eloWinProbability, getEloRatings } from "@/lib/elo";
import {
  eventKeyFor,
  getLineMovement,
  readH2HHistory,
  snapshotOdds,
  writeH2HHistory,
} from "@/lib/odds-history";
import { familyFromSportPath, isOutdoorSport } from "@/lib/data-providers";
import {
  apiFootballHeadToHead,
  apiFootballInjuries,
  apiFootballLineupForFixture,
  apiFootballPrediction,
  apiFootballRecentCornerAverages,
  apiFootballRecentGames,
  apiFootballTeamStanding,
} from "@/lib/data-providers/api-football";
import { balldontlieH2H } from "@/lib/data-providers/balldontlie";
import { nhlHeadToHead } from "@/lib/data-providers/nhl";
import { euroleagueH2H } from "@/lib/data-providers/euroleague";
import { sportsdbHeadToHead } from "@/lib/data-providers/sportsdb";
import { openWeatherForVenue } from "@/lib/data-providers/openweather";
import { understatTeamXg } from "@/lib/data-providers/understat";
import { footballDataRecentGames, footballDataTeamStanding } from "@/lib/data-providers/football-data";
import { buildMarketConsensus } from "@/lib/odds-math";
import { priorForSport, shrunkAvg } from "@/lib/league-priors";
import { teamImpactSummary } from "@/lib/player-impact";
import { getStatsbombCornersForTeam } from "@/lib/statsbomb-corners";
import type {
  BettingHeadToHeadGame,
  BettingLineupPlayer,
  BettingMarketConsensus,
  BettingProviderPrediction,
  BettingRealDataPlayer,
  BettingTeamXg,
  BettingWeather,
} from "@/lib/betting-bot";

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

/**
 * Heuristic: pull the user's intended price out of the prompt or notes.
 * Looks for explicit American odds (+150 / -110), or a decimal odds value
 * preceded/followed by a marker word ("at"/"odds"/"price"/book name).
 * Returns null when nothing reads as a price — better than guessing.
 */
function extractOddsFromText(text: string): { odds: ParsedOdds } | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. Explicit American (+150 / -110) — anywhere in the text.
  const american = trimmed.match(/(?:^|[^\w])([+\-]\d{3,4})(?:[^\d]|$)/);
  if (american) {
    const o = parseOdds(american[1]!);
    if (o) return { odds: o };
  }

  // 2. Decimal next to a marker word, e.g. "at 1.85", "odds 1.85",
  //    "@ 1.85", "1.85 betcha", "1.85 decimal", "price 1.85".
  const markerNumber = trimmed.match(
    /(?:\b(?:at|odds|price|decimal|@)\s*|\s)([0-9]\.[0-9]{1,3})\b(?:\s*(?:decimal|betcha|ladbrokes|neds|tab|coral|pinnacle|book|book\s*price)?)/i,
  );
  if (markerNumber) {
    const o = parseOdds(markerNumber[1]!);
    if (o) return { odds: o };
  }
  const numberThenBook = trimmed.match(
    /\b([0-9]\.[0-9]{1,3})\s+(?:on\s+)?(betcha|ladbrokes|neds|tab|coral|pinnacle|sportsbet|bet365|draftkings|fanduel)\b/i,
  );
  if (numberThenBook) {
    const o = parseOdds(numberThenBook[1]!);
    if (o) return { odds: o };
  }

  return null;
}

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

function extractCornersLine(text: string): { side: "over" | "under"; line: number } | null {
  const s = String(text ?? "").toLowerCase();
  const m = s.match(/\b(over|under)\s*(\d{1,2}(?:\.\d)?)\s*corners?\b/);
  if (!m) return null;
  const side = m[1] === "over" ? "over" : "under";
  const line = Number(m[2]);
  if (!Number.isFinite(line) || line < 1 || line > 25) return null;
  return { side, line };
}

function poissonCdf(k: number, lambda: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  if (!Number.isFinite(k)) return 0;
  const kk = Math.max(0, Math.floor(k));
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= kk; i += 1) {
    term = (term * lambda) / i;
    sum += term;
  }
  return clamp(sum, 0, 1);
}

function cornersUnderOverProbability(
  totalCornersMean: number,
  line: number,
  side: "over" | "under",
): number {
  // Example: under 10.5 means P(X <= 10), over 10.5 means P(X >= 11).
  const threshold = Math.floor(line);
  const under = poissonCdf(threshold, totalCornersMean);
  return side === "under" ? under : 1 - under;
}

function extractGoalsLine(text: string): { side: "over" | "under"; line: number } | null {
  const s = String(text ?? "").toLowerCase();
  const m = s.match(/\b(over|under)\s*(\d{1,2}(?:\.\d)?)\s*(?:total\s*)?goals?\b/);
  if (!m) return null;
  const side = m[1] === "over" ? "over" : "under";
  const line = Number(m[2]);
  if (!Number.isFinite(line) || line < 0.5 || line > 8) return null;
  return { side, line };
}

function extractBttsSelection(text: string): "yes" | "no" | null {
  const s = String(text ?? "").toLowerCase();
  if (!/\bbtts\b|both teams to score/.test(s)) return null;
  if (/\b(no|not)\b.*\b(btts|both teams to score)\b/.test(s)) return "no";
  if (/\b(btts|both teams to score)\b.*\b(no)\b/.test(s)) return "no";
  if (/\b(btts|both teams to score)\b.*\b(yes)\b/.test(s)) return "yes";
  if (/\byes\b.*\b(btts|both teams to score)\b/.test(s)) return "yes";
  return "yes";
}

function goalsUnderOverProbability(
  totalGoalsMean: number,
  line: number,
  side: "over" | "under",
): number {
  const threshold = Math.floor(line);
  const under = poissonCdf(threshold, totalGoalsMean);
  return side === "under" ? under : 1 - under;
}

function bttsProbability(muHome: number, muAway: number, side: "yes" | "no"): number {
  const pHomeScore = 1 - Math.exp(-Math.max(0.01, muHome));
  const pAwayScore = 1 - Math.exp(-Math.max(0.01, muAway));
  const pYes = pHomeScore * pAwayScore;
  return side === "yes" ? pYes : 1 - pYes;
}

function expectedGoalMeans(data: BettingRealData | null): { muHome: number; muAway: number } | null {
  if (!data) return null;
  const h = data.homeTeam;
  const a = data.awayTeam;
  if (!h || !a) return null;
  const hAtt = h.xg?.xgPerMatch ?? h.pointsForShrunk ?? h.pointsForAvg ?? null;
  const hDef = h.xg?.xgaPerMatch ?? h.pointsAgainstShrunk ?? h.pointsAgainstAvg ?? null;
  const aAtt = a.xg?.xgPerMatch ?? a.pointsForShrunk ?? a.pointsForAvg ?? null;
  const aDef = a.xg?.xgaPerMatch ?? a.pointsAgainstShrunk ?? a.pointsAgainstAvg ?? null;
  if (![hAtt, hDef, aAtt, aDef].every((n) => Number.isFinite(n))) return null;
  const base = 1.35;
  const muHome = clamp(Number((((hAtt! + aDef!) / 2) + 0.12).toFixed(2)), 0.2, 3.8);
  const muAway = clamp(Number((((aAtt! + hDef!) / 2) - 0.08).toFixed(2)), 0.2, 3.8);
  return {
    muHome: Number.isFinite(muHome) ? muHome : base,
    muAway: Number.isFinite(muAway) ? muAway : base,
  };
}

function hasGoalsLeakage(text: string): boolean {
  const s = String(text ?? "").toLowerCase();
  return (
    /\b\d+(\.\d+)?\s*goals?\b/.test(s) ||
    /\btotal goals?\b/.test(s) ||
    /\bover\/under\s*\d+(\.\d+)?\b/.test(s)
  );
}

function sanitizeCornersNarrative(
  _text: string,
  fairPct: number,
  lineLabel: string | null,
  data: BettingRealData | null,
): string {
  const p = Number.isFinite(fairPct) ? fairPct.toFixed(2) : "n/a";
  const line = lineLabel ?? "corners line";
  const h = data?.homeTeam;
  const a = data?.awayTeam;
  const latestCompleted = (data?.headToHead ?? []).find(
    (g) => g.homeScore != null && g.awayScore != null,
  );
  const h2hLine = latestCompleted
    ? `Latest completed H2H: ${latestCompleted.awayTeam} ${latestCompleted.awayScore}-${latestCompleted.homeScore} ${latestCompleted.homeTeam} on ${latestCompleted.date.slice(0, 10)}.`
    : "No completed recent H2H score is available.";
  const homeCorners =
    h && h.cornersSample > 0
      ? `${h.displayName} corners profile ${h.cornersForAvg ?? "?"} for / ${h.cornersAgainstAvg ?? "?"} against (${h.cornersSample} matches).`
      : `${h?.displayName ?? "Home team"} corners profile unavailable.`;
  const awayCorners =
    a && a.cornersSample > 0
      ? `${a.displayName} corners profile ${a.cornersForAvg ?? "?"} for / ${a.cornersAgainstAvg ?? "?"} against (${a.cornersSample} matches).`
      : `${a?.displayName ?? "Away team"} corners profile unavailable.`;
  const gate = data?.providerDiagnostics?.cornersGate;
  const gateLine = gate
    ? `Quality gate: lineAvailable=${gate.cornersLineAvailable}, samples=${gate.cornerSamplesHome}/${gate.cornerSamplesAway}, lineupAvailable=${gate.lineupAvailable}.`
    : "";
  const consensusUnder = data?.marketConsensus?.underProbPct;
  const consensusLine =
    consensusUnder != null
      ? `Market consensus under probability is ${consensusUnder.toFixed(2)}%.`
      : "Market consensus under probability unavailable.";
  return `${homeCorners} ${awayCorners} ${h2hLine} Model fair probability for ${line}: ${p}%. ${consensusLine} ${gateLine}`.trim();
}

function normalizeInformationGapsForAutomation(
  gaps: string[],
  marketFocus: "corners" | "cards" | "goals" | "other",
): string[] {
  const out: string[] = [];
  for (const raw of gaps) {
    const g = raw.trim();
    if (!g) continue;
    const lower = g.toLowerCase();
    if (/^(check|monitor|review|look for|assess)\b/.test(lower)) {
      out.push(`AI follow-up queued: ${g.replace(/^(check|monitor|review|look for|assess)\s*/i, "")}`);
      continue;
    }
    out.push(g);
  }
  if (marketFocus === "corners") {
    const hasLineup = out.some((g) => /lineup/i.test(g));
    const hasCorners = out.some((g) => /corner/i.test(g));
    if (!hasLineup) {
      out.push("AI follow-up queued: refresh predicted/confirmed lineups up to kickoff and re-run corners confidence.");
    }
    if (!hasCorners) {
      out.push("AI follow-up queued: pull latest team corner profiles and recompute corners fair probability.");
    }
  }
  return out.slice(0, 8);
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
      // When the user doesn't specify a date, look at yesterday + the next
      // ~6 weeks. For season sports (EPL, NBA, NFL) the same two teams only
      // meet a handful of times a year, so we need a wide horizon to catch
      // the *next* occurrence of the requested matchup. findFixture()
      // tie-breaks by date proximity to today, so the closest upcoming
      // match still wins inside this wide window.
      start.setUTCDate(start.getUTCDate() - 2);
      end.setUTCDate(end.getUTCDate() + 45);
      break;
  }
  return { start, end };
}

/** Fallback window when the narrow search misses — spans ~10 weeks so a
 *  specific fixture named without a date can still be resolved to its next
 *  scheduled occurrence even if it's over a month out. */
function wideRange(todayIsoLocal: string): { start: Date; end: Date } {
  const today = ymdToDate(todayIsoLocal);
  const start = new Date(today);
  const end = new Date(today);
  start.setUTCDate(start.getUTCDate() - 14);
  end.setUTCDate(end.getUTCDate() + 60);
  return { start, end };
}

/* ── Real-data collection (Steps 3–4) ─────────────────────────────────── */

async function collectRealData(
  sportPath: string,
  sportLabel: string,
  fixture: EspnFixture,
): Promise<BettingRealData> {
  const family = familyFromSportPath(sportPath);
  const homeName = fixture.homeTeam.displayName;
  const awayName = fixture.awayTeam.displayName;

  // Per-sport provider chains, each independent — fan out in parallel.
  const providerH2HPromise = (async (): Promise<{
    games: BettingHeadToHeadGame[];
    source: string | null;
  }> => {
    if (family === "soccer") {
      const r = await apiFootballHeadToHead(homeName, awayName);
      if (r.length) return { games: r, source: "api-football" };
    }
    if (family === "nba") {
      const r = await balldontlieH2H(homeName, awayName);
      if (r.length) return { games: r, source: "balldontlie" };
    }
    if (family === "nhl") {
      const r = await nhlHeadToHead(homeName, awayName);
      if (r.length) return { games: r, source: "nhl-stats" };
    }
    if (family === "euroleague") {
      const r = await euroleagueH2H(homeName, awayName);
      if (r.length) return { games: r, source: "euroleague" };
    }
    return { games: [], source: null };
  })();

  const providerInjuriesPromise = (async (): Promise<{
    home: BettingRealDataPlayer[];
    away: BettingRealDataPlayer[];
    source: string | null;
  }> => {
    if (family === "soccer") {
      const [h, a] = await Promise.all([
        apiFootballInjuries(homeName),
        apiFootballInjuries(awayName),
      ]);
      if (h.length || a.length) {
        return { home: h, away: a, source: "api-football" };
      }
    }
    return { home: [], away: [], source: null };
  })();

  const providerRecentGamesPromise = (async (): Promise<{
    home: EspnPastGame[];
    away: EspnPastGame[];
    source: string | null;
  }> => {
    if (family !== "soccer") return { home: [], away: [], source: null };
    const [home, away] = await Promise.all([
      apiFootballRecentGames(homeName, 10),
      apiFootballRecentGames(awayName, 10),
    ]);
    if (home.length || away.length) {
      return { home, away, source: "api-football" };
    }
    const [fdHome, fdAway] = await Promise.all([
      footballDataRecentGames(homeName, 10),
      footballDataRecentGames(awayName, 10),
    ]);
    if (fdHome.length || fdAway.length) {
      return { home: fdHome, away: fdAway, source: "football-data" };
    }
    return { home: [], away: [], source: null };
  })();

  const lineupsPromise = (async (): Promise<{
    home: BettingLineupPlayer[];
    away: BettingLineupPlayer[];
  }> => {
    if (family !== "soccer") return { home: [], away: [] };
    const r = await apiFootballLineupForFixture(
      homeName,
      awayName,
      fixture.date || null,
    );
    return r ?? { home: [], away: [] };
  })();

  const predictionPromise: Promise<BettingProviderPrediction | null> = (() => {
    if (family !== "soccer") return Promise.resolve(null);
    return apiFootballPrediction(homeName, awayName);
  })();

  const weatherPromise: Promise<BettingWeather | null> = (() => {
    if (!isOutdoorSport(family)) return Promise.resolve(null);
    return openWeatherForVenue(homeName, fixture.date || null);
  })();

  const homeXgPromise: Promise<BettingTeamXg | null> =
    family === "soccer" ? understatTeamXg(sportPath, homeName) : Promise.resolve(null);
  const awayXgPromise: Promise<BettingTeamXg | null> =
    family === "soccer" ? understatTeamXg(sportPath, awayName) : Promise.resolve(null);
  const statsbombHomeCornersPromise =
    family === "soccer"
      ? getStatsbombCornersForTeam(homeName)
      : Promise.resolve(null);
  const statsbombAwayCornersPromise =
    family === "soccer"
      ? getStatsbombCornersForTeam(awayName)
      : Promise.resolve(null);
  const apiHomeCornersPromise =
    family === "soccer" ? apiFootballRecentCornerAverages(homeName, 10) : Promise.resolve(null);
  const apiAwayCornersPromise =
    family === "soccer" ? apiFootballRecentCornerAverages(awayName, 10) : Promise.resolve(null);
  const homeStandingPromise =
    family === "soccer"
      ? (async () => {
          const api = await apiFootballTeamStanding(homeName);
          if (api) return { data: api, source: "api-football" as const };
          const fd = await footballDataTeamStanding(homeName);
          if (fd) return { data: fd, source: "football-data" as const };
          return { data: null, source: "none" as const };
        })()
      : Promise.resolve({ data: null, source: "none" as const });
  const awayStandingPromise =
    family === "soccer"
      ? (async () => {
          const api = await apiFootballTeamStanding(awayName);
          if (api) return { data: api, source: "api-football" as const };
          const fd = await footballDataTeamStanding(awayName);
          if (fd) return { data: fd, source: "football-data" as const };
          return { data: null, source: "none" as const };
        })()
      : Promise.resolve({ data: null, source: "none" as const });

  // Parallelise everything — providers above + ESPN + odds-API.
  const [
    homeInjuriesEspn,
    awayInjuriesEspn,
    homeGamesEspn,
    awayGamesEspn,
    espnHeadToHead,
    homeStyle,
    awayStyle,
    pickcenter,
    entainBooks,
    eloRatings,
    storedH2H,
    providerH2H,
    providerInjuries,
    providerRecentGames,
    lineups,
    prediction,
    weather,
    homeXg,
    awayXg,
    statsbombHomeCorners,
    statsbombAwayCorners,
    apiHomeCorners,
    apiAwayCorners,
    homeStandingResult,
    awayStandingResult,
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
    getEloRatings(sportPath, [fixture.homeTeam.id, fixture.awayTeam.id]),
    readH2HHistory(sportPath, fixture.homeTeam.id, fixture.awayTeam.id, 10),
    providerH2HPromise,
    providerInjuriesPromise,
    providerRecentGamesPromise,
    lineupsPromise,
    predictionPromise,
    weatherPromise,
    homeXgPromise,
    awayXgPromise,
    statsbombHomeCornersPromise,
    statsbombAwayCornersPromise,
    apiHomeCornersPromise,
    apiAwayCornersPromise,
    homeStandingPromise,
    awayStandingPromise,
  ]);
  const homeStanding = homeStandingResult.data;
  const awayStanding = awayStandingResult.data;
  const standingSource =
    homeStandingResult.source !== "none"
      ? homeStandingResult.source
      : awayStandingResult.source !== "none"
        ? awayStandingResult.source
        : "none";

  // ESPN soccer schedule data is frequently incomplete. Prefer API-Football
  // recent games when present; otherwise use ESPN as fallback.
  const homeGames =
    family === "soccer" && providerRecentGames.home.length > 0
      ? providerRecentGames.home
      : homeGamesEspn;
  const awayGames =
    family === "soccer" && providerRecentGames.away.length > 0
      ? providerRecentGames.away
      : awayGamesEspn;
  const homeInjuries = homeInjuriesEspn;
  const awayInjuries = awayInjuriesEspn;

  // Books: Entain family first (Ladbrokes / Neds — Betcha's sister books),
  // then ESPN pickcenter as sanity check. De-dup by key.
  const seenKeys = new Set<string>();
  const books = [...entainBooks, ...pickcenter].filter((b) => {
    if (seenKeys.has(b.key)) return false;
    seenKeys.add(b.key);
    return true;
  });

  // SportsDB universal H2H fallback when nothing else found anything.
  let sportsDbH2H: BettingHeadToHeadGame[] = [];
  if (espnHeadToHead.length === 0 && providerH2H.games.length === 0 && storedH2H.length === 0) {
    sportsDbH2H = await sportsdbHeadToHead(homeName, awayName);
  }

  // Merge H2H sources: persisted store + ESPN + provider + sportsDB,
  // de-dup by date (day precision) so the same game isn't doubled.
  const h2hMerged = mergeH2H([
    ...storedH2H.map(
      (r): BettingHeadToHeadGame => ({
        date: `${r.game_date}T00:00:00Z`,
        season: null,
        homeTeam: "",
        awayTeam: "",
        homeScore: r.home_score,
        awayScore: r.away_score,
        winner:
          r.home_score == null || r.away_score == null
            ? null
            : r.home_score > r.away_score
              ? "home"
              : r.home_score < r.away_score
                ? "away"
                : "tie",
        venue: r.venue,
      }),
    ),
    ...espnHeadToHead,
    ...providerH2H.games,
    ...sportsDbH2H,
  ]);

  // Persist any newly-discovered H2H rows so future requests benefit
  // (multi-season accumulation; ESPN only exposes the current season).
  const toStore = [...espnHeadToHead, ...providerH2H.games, ...sportsDbH2H]
    .filter((g) => g.date && g.homeScore != null && g.awayScore != null)
    .map((g) => ({
      game_date: g.date.slice(0, 10),
      home_id:
        g.homeTeam.toLowerCase() === homeName.toLowerCase()
          ? fixture.homeTeam.id
          : g.homeTeam.toLowerCase() === awayName.toLowerCase()
            ? fixture.awayTeam.id
            : "",
      away_id:
        g.awayTeam.toLowerCase() === awayName.toLowerCase()
          ? fixture.awayTeam.id
          : g.awayTeam.toLowerCase() === homeName.toLowerCase()
            ? fixture.homeTeam.id
            : "",
      home_score: g.homeScore,
      away_score: g.awayScore,
      venue: g.venue,
      source: providerH2H.source ?? "espn",
    }))
    .filter((r) => r.home_id && r.away_id);
  if (toStore.length) {
    void writeH2HHistory(sportPath, toStore);
  }

  // Snapshot the current odds so future requests can compute line movement.
  const evKey = eventKeyFor({
    homeTeamName: homeName,
    awayTeamName: awayName,
    kickoffIso: fixture.date || null,
  });
  if (books.length) {
    void snapshotOdds({
      sport: sportPath,
      eventKey: evKey,
      espnEventId: fixture.id || null,
      books,
    });
  }
  const lineMovement = await getLineMovement(evKey);

  // Elo-implied home win probability (uses both ratings + sport-specific
  // home-court advantage). Null when neither team has a rating yet.
  const homeElo = eloRatings.get(fixture.homeTeam.id);
  const awayElo = eloRatings.get(fixture.awayTeam.id);
  const eloHomeWinProbPct =
    homeElo && awayElo
      ? Number(
          (eloWinProbability(homeElo.rating, awayElo.rating, sportPath) * 100).toFixed(2),
        )
      : null;

  // Provider count for confidence ceiling: ESPN always counts as 1.
  let providerCount = 1;
  if (providerH2H.source) providerCount += 1;
  if (providerInjuries.source) providerCount += 1;
  if (providerRecentGames.source) providerCount += 1;
  if (prediction) providerCount += 1;
  if (lineMovement && lineMovement.snapshotCount >= 2) providerCount += 1;
  if (homeXg || awayXg) providerCount += 1;
  if (statsbombHomeCorners || statsbombAwayCorners || apiHomeCorners || apiAwayCorners)
    providerCount += 1;

  const homeCornersProfile =
    apiHomeCorners && apiHomeCorners.sample >= 5
      ? {
          matches: apiHomeCorners.sample,
          cornersForAvg: apiHomeCorners.cornersForAvg,
          cornersAgainstAvg: apiHomeCorners.cornersAgainstAvg,
        }
      : statsbombHomeCorners;
  const awayCornersProfile =
    apiAwayCorners && apiAwayCorners.sample >= 5
      ? {
          matches: apiAwayCorners.sample,
          cornersForAvg: apiAwayCorners.cornersForAvg,
          cornersAgainstAvg: apiAwayCorners.cornersAgainstAvg,
        }
      : statsbombAwayCorners;

  const providerDiagnostics = {
    family,
    connectivity: {
      env: {
        openai: !!process.env.OPENAI_API_KEY,
        apiFootball: !!process.env.API_FOOTBALL_KEY || !!process.env.RAPIDAPI_KEY,
        footballData: !!process.env.FOOTBALL_DATA_API_KEY,
        openWeather: !!process.env.OPENWEATHER_API_KEY,
        supabaseServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
      providers: {
        apiFootball: {
          configured: !!process.env.API_FOOTBALL_KEY || !!process.env.RAPIDAPI_KEY,
          used:
            providerRecentGames.source === "api-football" ||
            providerInjuries.source === "api-football" ||
            providerH2H.source === "api-football" ||
            standingSource === "api-football",
        },
        footballData: {
          configured: !!process.env.FOOTBALL_DATA_API_KEY,
          used: providerRecentGames.source === "football-data" || standingSource === "football-data",
        },
        openWeather: {
          configured: !!process.env.OPENWEATHER_API_KEY,
          used: !!weather,
        },
      },
    },
    selectedSources: {
      recentGames: providerRecentGames.source ?? "espn",
      injuries: providerInjuries.source ?? "espn",
      headToHead: providerH2H.source ?? (espnHeadToHead.length ? "espn" : "none"),
      lineups:
        (lineups.home.length || lineups.away.length) && family === "soccer"
          ? "api-football"
          : "none",
      prediction: prediction?.source ?? "none",
      standings: standingSource,
    },
    counts: {
      espnRecentHome: homeGamesEspn.length,
      espnRecentAway: awayGamesEspn.length,
      apiRecentHome: providerRecentGames.home.length,
      apiRecentAway: providerRecentGames.away.length,
      espnInjuriesHome: homeInjuriesEspn.length,
      espnInjuriesAway: awayInjuriesEspn.length,
      apiInjuriesHome: providerInjuries.home.length,
      apiInjuriesAway: providerInjuries.away.length,
      h2hEspn: espnHeadToHead.length,
      h2hProvider: providerH2H.games.length,
      h2hStored: storedH2H.length,
      lineupsHome: lineups.home.length,
      lineupsAway: lineups.away.length,
    },
    warnings: [
      ...(family === "soccer" &&
      homeGames.length === 0 &&
      awayGames.length === 0
        ? ["No recent games from ESPN or API-Football for this fixture."]
        : []),
      ...(family === "soccer" &&
      providerInjuries.home.length === 0 &&
      providerInjuries.away.length === 0 &&
      homeInjuriesEspn.length === 0 &&
      awayInjuriesEspn.length === 0
        ? ["No injury rows available from providers for either team."]
        : []),
      ...(lineups.home.length === 0 && lineups.away.length === 0 && family === "soccer"
        ? ["No lineup data available yet (provider may publish closer to kickoff)."]
        : []),
      ...(family === "soccer" && !statsbombHomeCorners && !statsbombAwayCorners
        ? ["No StatsBomb corner priors loaded (optional local dataset missing)."]
        : []),
      ...(family === "soccer" && !!statsbombHomeCorners && !statsbombAwayCorners
        ? ["StatsBomb corner priors found for home team only; away team prior missing."]
        : []),
      ...(family === "soccer" && !statsbombHomeCorners && !!statsbombAwayCorners
        ? ["StatsBomb corner priors found for away team only; home team prior missing."]
        : []),
      ...(family === "soccer" &&
      !apiHomeCorners &&
      !apiAwayCorners &&
      !statsbombHomeCorners &&
      !statsbombAwayCorners
        ? ["No free corners profile source returned data for this fixture yet."]
        : []),
    ],
  };

  // Vig-removed multi-book consensus — the actual fair-price baseline.
  const marketConsensus: BettingMarketConsensus | null = buildMarketConsensus(books);

  return {
    source:
      family === "soccer" && (providerInjuries.source || providerRecentGames.source)
        ? "api-football"
        : "espn",
    sportLabel,
    homeTeam: toRealDataTeam(
      fixture.homeTeam,
      mergeInjuries(homeInjuries, providerInjuries.home),
      homeGames,
      homeStyle,
      fixture.date || null,
      homeElo?.rating ?? null,
      homeElo?.games_count ?? 0,
      lineups.home,
      sportPath,
      homeXg,
      homeCornersProfile,
      homeStanding,
    ),
    awayTeam: toRealDataTeam(
      fixture.awayTeam,
      mergeInjuries(awayInjuries, providerInjuries.away),
      awayGames,
      awayStyle,
      fixture.date || null,
      awayElo?.rating ?? null,
      awayElo?.games_count ?? 0,
      lineups.away,
      sportPath,
      awayXg,
      awayCornersProfile,
      awayStanding,
    ),
    marketOdds: fixture.odds,
    books,
    headToHead: h2hMerged.slice(0, 8),
    eloHomeWinProbPct,
    lineMovement,
    weather,
    providerPrediction: prediction,
    providerCount,
    providerDiagnostics,
    marketConsensus,
  };
}

/** Merge ESPN-style injuries with provider injuries by player name. */
function mergeInjuries(
  espn: EspnInjury[],
  provider: BettingRealDataPlayer[],
): EspnInjury[] {
  if (provider.length === 0) return espn;
  const seen = new Set(espn.map((i) => i.playerName.toLowerCase()));
  const extras: EspnInjury[] = [];
  for (const p of provider) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push({
      playerId: "",
      playerName: p.name,
      position: p.position,
      status: p.status,
      detail: p.detail,
      headshot: p.headshot,
    });
  }
  return [...espn, ...extras].slice(0, 16);
}

/** De-dup H2H rows by date (day precision). Keeps the first occurrence. */
function mergeH2H(rows: BettingHeadToHeadGame[]): BettingHeadToHeadGame[] {
  const seen = new Set<string>();
  const out: BettingHeadToHeadGame[] = [];
  for (const r of rows) {
    const key = (r.date || "").slice(0, 10);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return out;
}

function toRealDataTeam(
  team: EspnFixture["homeTeam"],
  injuries: EspnInjury[],
  games: EspnPastGame[],
  style: Array<{ key: string; label: string; value: string }>,
  kickoffIso: string | null,
  elo: number | null,
  eloGames: number,
  lineup: BettingLineupPlayer[],
  sportPath: string,
  xg: BettingTeamXg | null,
  cornersProfile: { matches: number; cornersForAvg: number; cornersAgainstAvg: number } | null,
  standing: { league: string | null; rank: number | null; points: number | null; form: string | null } | null,
): BettingRealDataTeam {
  const avg = averageScore(games);
  const prior = priorForSport(sportPath);
  const sampleSize = avg.wins + avg.losses;
  const pointsForShrunk = shrunkAvg(avg.ppg, sampleSize, {
    mean: prior.perMatchFor,
    strength: prior.priorStrength,
  });
  const pointsAgainstShrunk = shrunkAvg(avg.opp, sampleSize, {
    mean: prior.perMatchAgainst,
    strength: prior.priorStrength,
  });
  // Player-impact aggregate — weights each missing player by position
  // so a starting GK out hits harder than a third-string winger.
  const playerImpact = teamImpactSummary(
    injuries.map((i) => ({
      name: i.playerName,
      position: i.position,
      status: i.status,
      detail: i.detail,
      headshot: i.headshot,
    })),
    lineup,
  );
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
    elo: elo != null ? Number(elo.toFixed(1)) : null,
    eloGames,
    lineup,
    pointsForShrunk,
    pointsAgainstShrunk,
    xg,
    outImpactScore: playerImpact.totalImpact,
    outImpactBreakdown: playerImpact.breakdown.slice(0, 5),
    cornersForAvg: cornersProfile?.cornersForAvg ?? null,
    cornersAgainstAvg: cornersProfile?.cornersAgainstAvg ?? null,
    cornersSample: cornersProfile?.matches ?? 0,
    standing,
  };
}

/* ── Prompt builders (use REAL data) ──────────────────────────────────── */

function summariseRealData(data: BettingRealData | null): string {
  if (!data || (!data.homeTeam && !data.awayTeam)) {
    return "No live sports data could be fetched for this sport / fixture. Your analysis must rely on general knowledge and clearly flag where specific numbers are unknown.";
  }
  const part = (label: string, t: BettingRealDataTeam | null) => {
    if (!t) return `${label}: (no data)`;
    const isHome = label.toLowerCase().includes("home");
    const hasInjuryFeed = data.providerDiagnostics
      ? isHome
        ? data.providerDiagnostics.counts.espnInjuriesHome > 0 ||
          data.providerDiagnostics.counts.apiInjuriesHome > 0
        : data.providerDiagnostics.counts.espnInjuriesAway > 0 ||
          data.providerDiagnostics.counts.apiInjuriesAway > 0
      : false;
    const inj = t.injuries.length
      ? t.injuries
          .map(
            (i) =>
              `${i.name} (${i.position ?? "?"}) — ${i.status}${
                i.detail ? `: ${i.detail.slice(0, 160)}` : ""
              }`,
          )
          .join("; ")
      : hasInjuryFeed
        ? "no listed injuries"
        : "injury feed unavailable (unknown)";
    const impactLine =
      t.outImpactScore > 0
        ? ` Aggregate missing-player impact: −${(t.outImpactScore * 100).toFixed(1)}% of team strength${
            t.outImpactBreakdown.length
              ? ` (top: ${t.outImpactBreakdown
                  .slice(0, 3)
                  .map(
                    (p) =>
                      `${p.name} ${p.position ? `[${p.position}]` : ""} ${p.status} −${(p.impact * 100).toFixed(1)}%`,
                  )
                  .join(", ")})`
              : ""
          }.`
        : "";
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
    // Show shrunk averages alongside raw so the model sees both. Shrunk
    // is what it should reason against; raw shows the noisy small-sample
    // tendency.
    const showShrunk =
      t.pointsForShrunk != null && t.pointsForShrunk !== t.pointsForAvg;
    const ppgLine = showShrunk
      ? `avg ${t.pointsForShrunk} for / ${t.pointsAgainstShrunk} against (shrunk; raw ${t.pointsForAvg ?? "?"}/${t.pointsAgainstAvg ?? "?"} over ${t.wins10 + t.losses10} games)`
      : `avg ${t.pointsForAvg ?? "?"} for / ${t.pointsAgainstAvg ?? "?"} against`;
    const xgLine = t.xg
      ? ` xG: ${t.xg.xgPerMatch}/g for, ${t.xg.xgaPerMatch}/g against (${t.xg.matches} matches; goals ${t.xg.goalsPerMatch}/g, conceded ${t.xg.concededPerMatch}/g — gap signals over/under-perform).`
      : "";
    const cornersLine =
      t.cornersSample > 0
        ? ` Corners profile: ${t.cornersForAvg ?? "?"} for / ${t.cornersAgainstAvg ?? "?"} against over ${t.cornersSample} matches.`
        : "";
    const standingLine = t.standing
      ? ` Standing: ${t.standing.league ?? "league"} #${t.standing.rank ?? "?"} (${t.standing.points ?? "?"} pts${t.standing.form ? `, form ${t.standing.form}` : ""}).`
      : " Standing: unavailable.";
    return `${label}: ${t.displayName} (${t.record ?? "record n/a"}) — last-10 ${t.last10Streak || "n/a"} (${splits}), ${marginLine}, ${ppgLine}, ${restLine}. Season stats: ${style}.${standingLine} Injuries: ${inj}.${impactLine} Recent games: ${recent}.${xgLine}${cornersLine}`;
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

  // Power-ratings block (internal Elo). Populates the 16%-weight rubric
  // factor that the free ESPN feed doesn't cover (no EPA/xG/KenPom).
  const eloLine =
    data.homeTeam?.elo != null && data.awayTeam?.elo != null && data.eloHomeWinProbPct != null
      ? `POWER RATINGS (internal Elo): HOME ${data.homeTeam.elo} (${data.homeTeam.eloGames} games) vs AWAY ${data.awayTeam.elo} (${data.awayTeam.eloGames} games) → Elo-implied home win prob ${data.eloHomeWinProbPct}%.`
      : "POWER RATINGS: not yet computed for this sport (Elo bootstraps after a few settled games).";

  // Line-movement block. Drives the 14%-weight rubric factor.
  const lmLine = data.lineMovement
    ? `LINE MOVEMENT (${data.lineMovement.snapshotCount} snapshots): spread Δ ${data.lineMovement.spreadMove ?? "n/a"}, total Δ ${data.lineMovement.totalMove ?? "n/a"}, home ML Δ ${data.lineMovement.homeMlMove ?? "n/a"}.${data.lineMovement.reverseLineMove ? " RLM signal detected (line moved against the public favorite — sharp money)." : ""}${data.lineMovement.pinnacle ? ` Pinnacle current: ML ${data.lineMovement.pinnacle.moneylineHome ?? "?"}/${data.lineMovement.pinnacle.moneylineAway ?? "?"}, spread ${data.lineMovement.pinnacle.spreadPoint ?? "?"}, total ${data.lineMovement.pinnacle.total ?? "?"}.` : ""}`
    : "LINE MOVEMENT: no historical snapshots yet for this fixture (this is the first request — future requests will see deltas).";

  // Lineups (soccer only; from API-Football).
  const lineupLine =
    (data.homeTeam?.lineup?.length ?? 0) + (data.awayTeam?.lineup?.length ?? 0) > 0
      ? `LINEUPS (confirmed/predicted): HOME starters: ${(data.homeTeam?.lineup ?? []).filter((p) => p.status === "starter").map((p) => p.name).slice(0, 11).join(", ") || "n/a"}. AWAY starters: ${(data.awayTeam?.lineup ?? []).filter((p) => p.status === "starter").map((p) => p.name).slice(0, 11).join(", ") || "n/a"}.`
      : "";

  // Provider prediction (currently only API-Football for soccer).
  const predictionLine = data.providerPrediction
    ? `PROVIDER PREDICTION (${data.providerPrediction.source}): home ${data.providerPrediction.homeWinPct ?? "?"}% / draw ${data.providerPrediction.drawPct ?? "?"}% / away ${data.providerPrediction.awayWinPct ?? "?"}%${data.providerPrediction.advice ? ` — advice: "${data.providerPrediction.advice}"` : ""}.`
    : "";

  // Weather (outdoor sports only).
  const weatherLine = data.weather
    ? `WEATHER (kickoff venue): ${data.weather.summary}.${data.weather.windKph != null && data.weather.windKph >= 25 ? " High-wind alert: meaningful for goals/totals." : ""}`
    : "";

  // Vig-removed multi-book consensus — the *fair price baseline*. This is
  // what the model should compare its own probability to (NOT a single
  // book's vig-fattened offered price, which would bias edge calc high).
  const consensusLine = data.marketConsensus
    ? (() => {
        const c = data.marketConsensus;
        const parts: string[] = [
          `MARKET CONSENSUS (vig-removed across ${c.bookCount} book${c.bookCount === 1 ? "" : "s"}):`,
        ];
        if (c.homeWinProbPct != null) {
          parts.push(
            ` fair home-win ${c.homeWinProbPct}%${c.drawProbPct != null ? ` / draw ${c.drawProbPct}%` : ""} / away-win ${c.awayWinProbPct ?? "?"}%`,
          );
        }
        if (c.totalLine != null && c.overProbPct != null) {
          parts.push(
            `; fair O/U ${c.totalLine} → over ${c.overProbPct}% / under ${c.underProbPct}%`,
          );
        }
        if (c.pinnacle?.homeWinProbPct != null) {
          parts.push(
            `. Pinnacle (sharpest book) vig-free: home ${c.pinnacle.homeWinProbPct}%${c.pinnacle.drawProbPct != null ? ` / draw ${c.pinnacle.drawProbPct}%` : ""} / away ${c.pinnacle.awayWinProbPct ?? "?"}%.`,
          );
        }
        parts.push(
          " Use these as the *fair-price reference* for edge calculations — NOT the offered price on any one book.",
        );
        return parts.join("");
      })()
    : "";

  return [
    part("HOME", data.homeTeam),
    part("AWAY", data.awayTeam),
    h2hLine,
    eloLine,
    lmLine,
    lineupLine,
    predictionLine,
    weatherLine,
    consensusLine,
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

function marketFocusFromText(text: string): "corners" | "cards" | "goals" | "other" {
  const t = text.toLowerCase();
  if (/\bcorners?\b|\bcorner line\b/.test(t)) return "corners";
  if (/\bcards?\b|\byellow\b|\bred card\b/.test(t)) return "cards";
  if (/\bgoals?\b|\bover\/under\b|\btotal goals?\b|\bbtts\b/.test(t)) return "goals";
  return "other";
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

  const marketFocus = marketFocusFromText(`${query}\n${notes}`);
  const marketGuardrail =
    marketFocus === "corners"
      ? "MARKET FOCUS: CORNERS. Do NOT analyze total goals lines. All totals/risk commentary must be about corner counts/tempo/territory, not goals scored."
      : marketFocus === "cards"
        ? "MARKET FOCUS: CARDS. Do NOT analyze goals or corner totals unless directly tied to disciplinary pace."
        : "";

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
${marketGuardrail}

HOW TO WRITE EACH STAGE (this is critical — do not say "no verified data" if
data IS in the REAL DATA block above):
  • form:        cite ACTUAL last-10 records, margin per game, home/away
                 splits, rest days, any back-to-back flag, and any injury
                 names from the block.
  • h2h:         use the HEAD-TO-HEAD block above. Quote specific prior
                 meeting dates + scores across MULTIPLE seasons when the
                 block has them. Only say "no meetings" if the block
                 literally says none.
  • tactical:    reason from pace (ppg + opp ppg → projected total) and the
                 style stats (FG%, 3P%, rebounds, turnovers, etc) that are
                 present. Quote LINEUPS block when available (soccer).
  • market:     quote the MARKET BOARD + LINE MOVEMENT blocks. If RLM is
                 flagged, name it as a sharp signal. Compare Pinnacle's
                 current price (when present) to your fair price.
  • value:       compute fair win probability from form + H2H + injuries +
                 POWER RATINGS (Elo) + provider prediction (when present).
                 If Elo and the model's own fair prob disagree by >5%,
                 say so explicitly. Convert to fair decimal (1/prob), then
                 compare to the user/auto-resolved price. Name the edge in %.
                 If no odds exist say so explicitly.
  • weather:    when the WEATHER block is present (outdoor sports), tie wind
                 / rain to market-specific impact. For corners: wind/crossing/
                 clearances can lift corners. For goals totals: strong wind can
                 reduce shot quality/finishing.

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

  const marketFocus = marketFocusFromText(`${query}\n${notes}`);
  const marketRules =
    marketFocus === "corners"
      ? `CORNERS-SPECIFIC RULES:
- This bet is on corners, not goals. Do NOT use goals O/U lines (e.g. 2.5 goals) as corner evidence.
- If no corners-specific market line is present in REAL DATA, cap confidence <= 55 and do not output "strong_bet".
- Corner reasoning must reference only corner-relevant proxies (tempo, wing play, territorial pressure, crossing/clearance patterns, game state).`
      : "";

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
${marketRules}

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
3. confidencePct: 0–90 (server-side cap depends on data depth — be honest
   about uncertainty). If > 4 metrics have confidence ≤ 3, cap at 55.
4. SPECIFIC RUBRIC NOTES (use the REAL DATA block, not external knowledge):
   - "Injuries & lineup health": use the "Aggregate missing-player
     impact" line in the HOME/AWAY blocks — this is a position-weighted
     fraction-of-strength removed (a starting GK at 0.12 hits much
     harder than a third-string winger at 0.04). When one team's
     missing-player impact is materially larger than the other's
     (>=5 percentage points), this metric should swing FOR the side
     with healthier starters.
   - "Power ratings & advanced metrics": cite the Elo block AND the
     understat xG block when present. If both are missing, score
     confidence ≤ 3 — do NOT invent a power-rating number.
   - "Line movement & sharp action": cite the LINE MOVEMENT block. If
     "no historical snapshots yet" appears, score confidence ≤ 3.
   - "Weather & venue": cite the WEATHER block when present, otherwise
     score confidence ≤ 3. Indoor sports default to neutral (5/3).
   - "Head-to-head history": prefer multi-season meetings when the H2H
     block lists them.
   - "Market efficiency & price value": ALWAYS compare your fair-prob to
     the MARKET CONSENSUS block (vig-removed multi-book median) — NOT
     to any single book's offered price. The offered price has a 3-7%
     vig baked in; comparing to it makes every "edge" look bigger than
     it really is. The Pinnacle line in the consensus block is the
     sharpest single book — if your model materially disagrees with
     Pinnacle (>3% gap), that should LOWER confidence, not raise it.
   - When you compute fairWinProbabilityPct, anchor it to the consensus
     and only deviate when the real-data block gives you a concrete
     reason (injury, lineup change, xG mismatch, RLM signal).
5. Verdict rules (ONLY when odds were provided):
   - edge ≥ +4% AND confidence ≥ 65 AND ≤ 2 against-metrics  → "strong_bet"
   - edge ≥ +2% AND confidence ≥ 55                           → "bet"
   - edge ≥ +1% AND confidence ≥ 45                           → "lean"
   - edge between −1% and +1% OR confidence < 45              → "pass"
   - edge ≤ −2% with high-confidence against metrics          → "fade"
   When odds are NOT provided, follow the oddsContext rule above.
6. summary: 2–4 paragraphs separated by \\n\\n. Reference specific players
   / teams from the real data block. The first paragraph is the thesis.
7. risks: 3–5 concrete losing scenarios, named where possible (e.g.
   "if [Player X] is upgraded to active, the line shifts...").
8. informationGaps: 3–5 concrete checks the user should still run.

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
  // User-supplied odds take precedence; if blank, we scan the free-text
  // query + notes for an explicit price (e.g. "over 2.5 at 1.85", "1.85
  // betcha", "+150"). Only as a last resort do we auto-fill from the
  // book board after the fixture + real-data lookup below.
  let parsedOdds =
    body.odds != null && String(body.odds).trim() !== ""
      ? parseOdds(body.odds)
      : null;
  let oddsSourceLabel: string | null = parsedOdds ? "user" : null;
  if (!parsedOdds) {
    const fromText = extractOddsFromText(`${query}\n${notes}`);
    if (fromText) {
      parsedOdds = fromText.odds;
      oddsSourceLabel = "user";
    }
  }
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

      // Candidate leagues to probe. If the LLM only knew "Soccer"/"football"
      // we fan out to every soccer league rather than giving up.
      const sportCandidates = sportCandidatesFromHint(
        `${intent.sport} ${query}`,
      );
      // Headline sport: take the first specific league if any, else try to
      // map from the intent alone, else null. Used only for labels/logs.
      let sport: ReturnType<typeof sportFromHint> =
        sportCandidates[0] ?? sportFromHint(`${intent.sport} ${query}`);
      const teamHint = intent.teams.join(" ") || intent.pickSide;

      send({
        type: "thought",
        stage: "parse",
        text: `Detected ${sport?.label ?? (intent.sport || "sport unknown")}${
          sportCandidates.length > 1
            ? ` (probing ${sportCandidates.length} leagues: ${sportCandidates
                .map((c) => c.label)
                .slice(0, 4)
                .join(", ")}${sportCandidates.length > 4 ? ", …" : ""})`
            : ""
        } · teams: ${intent.teams.join(" & ") || "(unresolved)"} · when: ${intent.dateHint}.`,
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

      if (sportCandidates.length > 0 && teamHint) {
        const { start, end } = dateRangeForHint(intent.dateHint, todayIso);
        const windowLabel = `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;
        const preferredIso = ymdToDate(todayIso).toISOString();

        send({
          type: "thought",
          stage: "fixture",
          text: `Searching ESPN ${sportCandidates.length === 1 ? sportCandidates[0]!.label : `${sportCandidates.length} leagues`} ${windowLabel}${clientTimezone ? ` (your zone: ${clientTimezone})` : ""} for "${teamHint}".`,
        });

        // Probe every candidate league in parallel. The first match where
        // BOTH teams line up wins (findFixture already enforces that when
        // intent.teams has 2 entries).
        const probeOnce = async (
          window: { start: Date; end: Date },
        ): Promise<{ sport: SportKey; fixture: EspnFixture } | null> => {
          const results = await Promise.all(
            sportCandidates.map(async (cand) => {
              const fx = await findFixture(
                cand.path,
                window.start,
                window.end,
                teamHint,
                intent.teams,
                preferredIso,
              );
              return fx ? { sport: cand, fixture: fx } : null;
            }),
          );
          const hits = results.filter(
            (r): r is { sport: SportKey; fixture: EspnFixture } => r !== null,
          );
          if (hits.length === 0) return null;
          // Closest to today wins when multiple leagues match (rare — same
          // two team names across competitions).
          hits.sort((a, b) => {
            const ta = new Date(a.fixture.date).getTime();
            const tb = new Date(b.fixture.date).getTime();
            const ref = new Date(preferredIso).getTime();
            return Math.abs(ta - ref) - Math.abs(tb - ref);
          });
          return hits[0]!;
        };

        let hit = await probeOnce({ start, end });

        // Wide fallback — ESPN uses US Eastern day boundaries and the
        // dateline can push NZ/EU calendars ±1 day off, so try a broader
        // window before giving up. Also picks up the next occurrence when
        // the user named a matchup without a date (e.g. "Crystal Palace vs
        // West Ham, both teams to score").
        if (!hit) {
          const wide = wideRange(todayIso);
          send({
            type: "thought",
            stage: "fixture",
            text: `No hit in the narrow window — widening to ${wide.start.toISOString().slice(0, 10)} → ${wide.end.toISOString().slice(0, 10)} to find the next scheduled meeting…`,
          });
          hit = await probeOnce(wide);
        }

        if (hit) {
          espnFixture = hit.fixture;
          // Lock in the resolved league as the canonical "sport" going
          // forward (labels, calibration, collectRealData path, etc.).
          sport = hit.sport;
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
              const cleanStr = (v: unknown): string => {
                if (typeof v !== "string") return "";
                const t = v.trim();
                // LLMs sometimes emit the literal string "null" / "n/a" /
                // "tbd" for unknown fields — treat those as empty.
                if (!t) return "";
                if (/^(null|n\/a|na|none|tbd|tba|unknown|undefined)$/i.test(t))
                  return "";
                return t;
              };
              const iso = cleanStr(raw.kickoffIso);
              const kickoffIso =
                iso && !Number.isNaN(new Date(iso).getTime()) ? iso : null;
              const fx: BettingFixture = {
                homeTeam: cleanStr(raw.homeTeam),
                awayTeam: cleanStr(raw.awayTeam),
                competition: cleanStr(raw.competition),
                kickoffIso,
                venue: cleanStr(raw.venue) || null,
              };
              if (fx.homeTeam && fx.awayTeam) {
                fixtureEvt = fx;
                // Only re-emit if we didn't already send a fixture from
                // ESPN AND the LLM's fixture actually carries usable data.
                // Otherwise we'd show a card that reads "null / Invalid
                // Date / null" — which is what the user reported.
                if (!espnFixture && (fx.kickoffIso || fx.venue)) {
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
      let modelFairPct = clamp(
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
      const computeK = (
        fairPct: number,
      ): NonNullable<BettingAnalysisResult["kelly"]> | null =>
        oddsUsed !== null
          ? (() => {
              const full = kellyFraction(fairPct / 100, oddsUsed.decimal);
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
      let edgePct =
        oddsUsed && bookImpliedProbabilityPct !== null
          ? modelFairPct - bookImpliedProbabilityPct
          : null;
      let kelly = computeK(modelFairPct);
      const applyFairOverride = (fairPct: number) => {
        modelFairPct = clamp(Number(fairPct.toFixed(2)), 1, 99);
        edgePct =
          oddsUsed && bookImpliedProbabilityPct !== null
            ? modelFairPct - bookImpliedProbabilityPct
            : null;
        kelly = computeK(modelFairPct);
        applyNumericGuardrail();
      };

      const rawConfidence = clamp(
        Number(
          (finalContent as { confidencePct?: number }).confidencePct ?? 0,
        ),
        0,
        90,
      );
      const hasUserNotes = notes.length >= 40;
      const hasRealData = !!(
        realData &&
        (realData.homeTeam || realData.awayTeam)
      );
      // Reward richer data: each independent provider lifts the ceiling.
      // 1 source (ESPN only) → 80, 2-3 sources → 85, 4+ sources or
      // Elo+linemove+injuries combined → 90. No data → 55-65 floor as
      // before so the model can't claim certainty from memory alone.
      const providerCount = realData?.providerCount ?? (hasRealData ? 1 : 0);
      const hasEloAndMovement =
        !!realData?.eloHomeWinProbPct &&
        !!realData?.lineMovement &&
        realData.lineMovement.snapshotCount >= 2;
      const baseCeiling = !hasRealData
        ? hasUserNotes
          ? 65
          : 55
        : hasEloAndMovement && providerCount >= 3
          ? 90
          : providerCount >= 3
            ? 85
            : 80;
      const confidencePct = Math.min(rawConfidence, baseCeiling);

      // Force verdict to "pass" when no odds — we cannot price an edge.
      let verdict = normaliseVerdict(finalContent.verdict);
      if (oddsMissing && (verdict === "bet" || verdict === "strong_bet")) {
        verdict = modelFairPct >= 60 && confidencePct >= 55 ? "lean" : "pass";
      }
      const applyNumericGuardrail = () => {
        if (oddsMissing || edgePct === null) return;
        // Guardrail: final verdict must respect numeric edge/confidence rules.
        if (edgePct >= 4 && confidencePct >= 65) verdict = "strong_bet";
        else if (edgePct >= 2 && confidencePct >= 55) verdict = "bet";
        else if (edgePct >= 1 && confidencePct >= 45) verdict = "lean";
        else if (edgePct <= -2 && confidencePct >= 55) verdict = "fade";
        else verdict = "pass";
      };
      applyNumericGuardrail();

      const marketText = `${query}\n${notes}\n${String(finalContent.marketNormalized ?? "")}`;
      const marketFocus = marketFocusFromText(`${query}\n${notes}`);
      const goalMeans = expectedGoalMeans(realData);
      if (marketFocus === "goals" && goalMeans && realData?.providerDiagnostics) {
        const goalsLine = extractGoalsLine(marketText);
        const bttsSide = extractBttsSelection(marketText);
        if (goalsLine) {
          const totalMean = Number((goalMeans.muHome + goalMeans.muAway).toFixed(2));
          const p = goalsUnderOverProbability(totalMean, goalsLine.line, goalsLine.side);
          applyFairOverride(p * 100);
          realData.providerDiagnostics.pricingModel = {
            market: "goals_total",
            applied: true,
            fairPct: Number(modelFairPct.toFixed(2)),
            impliedPct:
              bookImpliedProbabilityPct !== null
                ? Number(bookImpliedProbabilityPct.toFixed(2))
                : null,
            edgePct: edgePct !== null ? Number(edgePct.toFixed(2)) : null,
            muHome: goalMeans.muHome,
            muAway: goalMeans.muAway,
            totalMean,
            line: String(goalsLine.line),
            side: goalsLine.side,
          };
        } else if (bttsSide) {
          const p = bttsProbability(goalMeans.muHome, goalMeans.muAway, bttsSide);
          applyFairOverride(p * 100);
          realData.providerDiagnostics.pricingModel = {
            market: "btts",
            applied: true,
            fairPct: Number(modelFairPct.toFixed(2)),
            impliedPct:
              bookImpliedProbabilityPct !== null
                ? Number(bookImpliedProbabilityPct.toFixed(2))
                : null,
            edgePct: edgePct !== null ? Number(edgePct.toFixed(2)) : null,
            muHome: goalMeans.muHome,
            muAway: goalMeans.muAway,
            totalMean: Number((goalMeans.muHome + goalMeans.muAway).toFixed(2)),
            side: bttsSide,
          };
        } else {
          realData.providerDiagnostics.warnings.push(
            "Goals model not applied: no explicit goals total line or BTTS side found.",
          );
        }
      }

      if (marketFocus === "corners") {
        const cornersMarket = extractCornersLine(marketText);
        const books = realData?.books ?? [];
        const pinnacleBook =
          books.find((b) => b.key.toLowerCase() === "pinnacle") ??
          books.find((b) => b.provider.toLowerCase().includes("pinnacle")) ??
          null;
        const trustedBook =
          pinnacleBook?.provider ??
          (oddsSource === "user"
            ? "user-supplied"
            : books[0]?.provider ?? null);

        // Free books often omit dedicated corners totals. Accept explicit
        // user/market-normalized corners line as "available", but keep
        // diagnostics transparent about source quality.
        const cornersLineAvailable = !!cornersMarket;

        const homeRecent = realData?.homeTeam?.recentGames ?? [];
        const awayRecent = realData?.awayTeam?.recentGames ?? [];
        const now = new Date();
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const recent30dHome = homeRecent.filter((g) => {
          const t = Date.parse(g.date);
          return Number.isFinite(t) && now.getTime() - t <= thirtyDaysMs;
        }).length;
        const recent30dAway = awayRecent.filter((g) => {
          const t = Date.parse(g.date);
          return Number.isFinite(t) && now.getTime() - t <= thirtyDaysMs;
        }).length;

        const cornerSamplesHome = realData?.homeTeam?.cornersSample ?? 0;
        const cornerSamplesAway = realData?.awayTeam?.cornersSample ?? 0;

        const homeCornersFor = realData?.homeTeam?.cornersForAvg;
        const homeCornersAgainst = realData?.homeTeam?.cornersAgainstAvg;
        const awayCornersFor = realData?.awayTeam?.cornersForAvg;
        const awayCornersAgainst = realData?.awayTeam?.cornersAgainstAvg;
        const cornersBaseline = 9.6;
        const halfBaseline = cornersBaseline / 2;
        const avg2 = (a: number | null | undefined, b: number | null | undefined) =>
          ((a ?? halfBaseline) + (b ?? halfBaseline)) / 2;
        const totalCornersMean = Number(
          (avg2(homeCornersFor, awayCornersAgainst) + avg2(awayCornersFor, homeCornersAgainst))
            .toFixed(2),
        );

        // Phase 2: deterministic corners fair-probability model.
        // Only apply when market text has explicit over/under corners line
        // and both teams have at least baseline sample quality.
        const canApplyCornersModel =
          !!cornersMarket && cornerSamplesHome >= 5 && cornerSamplesAway >= 5;
        if (canApplyCornersModel && cornersMarket) {
          const p = cornersUnderOverProbability(
            totalCornersMean,
            cornersMarket.line,
            cornersMarket.side,
          );
          applyFairOverride(p * 100);
        }

        const lineupAvailable =
          (realData?.homeTeam?.lineup.length ?? 0) > 0 &&
          (realData?.awayTeam?.lineup.length ?? 0) > 0;
        const lineMovementShift = realData?.lineMovement?.totalMove ?? null;
        const lineMovementExtreme =
          lineMovementShift != null && Math.abs(lineMovementShift) > 1.5;

        // User-requested strict hard fails:
        // - no corners line OR <5 corner-stat matches on either team.
        const hardFail =
          !cornersLineAvailable ||
          cornerSamplesHome < 5 ||
          cornerSamplesAway < 5;

        const allSatisfied =
          cornerSamplesHome >= 7 &&
          cornerSamplesAway >= 7 &&
          recent30dHome >= 3 &&
          recent30dAway >= 3 &&
          lineupAvailable &&
          cornersLineAvailable &&
          !lineMovementExtreme;

        if (realData?.providerDiagnostics) {
          realData.providerDiagnostics.cornersGate = {
            trustedBook,
            cornersLineAvailable,
            cornerSamplesHome,
            cornerSamplesAway,
            recent30dHome,
            recent30dAway,
            lineupAvailable,
            lineMovementShift,
            lineMovementExtreme,
            hardFail,
            allSatisfied,
            modelFairPct: Number(modelFairPct.toFixed(2)),
            modelLine:
              cornersMarket
                ? `${cornersMarket.side} ${cornersMarket.line}`
                : null,
            modelTotalCornersMean: totalCornersMean,
            modelApplied: canApplyCornersModel,
          };
          realData.providerDiagnostics.pricingModel = {
            market: "corners",
            applied: canApplyCornersModel,
            fairPct: Number(modelFairPct.toFixed(2)),
            impliedPct:
              bookImpliedProbabilityPct !== null
                ? Number(bookImpliedProbabilityPct.toFixed(2))
                : null,
            edgePct: edgePct !== null ? Number(edgePct.toFixed(2)) : null,
            totalMean: totalCornersMean,
            line: cornersMarket ? String(cornersMarket.line) : null,
            side: cornersMarket?.side ?? null,
          };
          if (!cornersLineAvailable) {
            realData.providerDiagnostics.warnings.push(
              "Corners market line unavailable from trusted books (Pinnacle preferred) — forcing PASS.",
            );
          } else if (!pinnacleBook) {
            realData.providerDiagnostics.warnings.push(
              "Corners line available from non-Pinnacle source (user or fallback book).",
            );
          }
          if (!canApplyCornersModel) {
            realData.providerDiagnostics.warnings.push(
              "Corners probability model not applied: requires explicit corners line and >=5 corner-sample matches for both teams.",
            );
          }
        }

        if (hardFail) {
          verdict = "pass";
        } else if (!allSatisfied && (verdict === "bet" || verdict === "strong_bet")) {
          verdict = "lean";
        }
      }

      const marketLineLabel =
        marketFocus === "corners"
          ? realData?.providerDiagnostics?.cornersGate?.modelLine ?? null
          : null;
      const rawSummary =
        typeof finalContent.summary === "string" && finalContent.summary.trim()
          ? finalContent.summary.trim()
          : "No narrative summary returned.";
      const safeSummary =
        marketFocus === "corners"
          ? sanitizeCornersNarrative(rawSummary, modelFairPct, marketLineLabel, realData)
          : rawSummary;
      const rawInformationGaps = Array.isArray(finalContent.informationGaps)
        ? finalContent.informationGaps
            .map((r: unknown) => (typeof r === "string" ? r.trim() : ""))
            .filter(Boolean)
        : [];
      const safeInformationGaps = normalizeInformationGapsForAutomation(
        rawInformationGaps,
        marketFocus,
      );

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
        summary: safeSummary,
        risks: Array.isArray(finalContent.risks)
          ? finalContent.risks
              .map((r: unknown) => (typeof r === "string" ? r.trim() : ""))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        informationGaps: safeInformationGaps,
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
