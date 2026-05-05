import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { getEventSummary } from "@/lib/sports-data";
import { recordEloFromResult } from "@/lib/elo";
import { computeAndPersistClv } from "@/lib/clv";
import type {
  BettingAnalysisResult,
  CalibrationBucket,
  CalibrationSummary,
  ModelReportCard,
  ReportCardEdgeBucket,
  ReportCardMarketRow,
  ReportCardWeeklyRow,
  TrackedBetRow,
  TrackedBetStatus,
} from "@/lib/betting-bot";

export type { CalibrationSummary, CalibrationBucket, TrackedBetRow, TrackedBetStatus };

function isSettledStatus(s: TrackedBetStatus): boolean {
  return s === "won" || s === "lost" || s === "push" || s === "void";
}

function marketFamily(market: string): "corners" | "goals" | "btts" | "other" {
  const m = String(market ?? "").toLowerCase();
  if (/btts|both teams to score/.test(m)) return "btts";
  if (/corner/.test(m)) return "corners";
  if (/goal|over\/under|total/.test(m)) return "goals";
  return "other";
}

function edgeBucket(edge: number | null): ReportCardEdgeBucket["bucket"] {
  if (edge == null) return "<0%";
  if (edge < 0) return "<0%";
  if (edge < 1) return "0-1%";
  if (edge < 2) return "1-2%";
  if (edge < 4) return "2-4%";
  return "4%+";
}

function mean(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function clipProb(pct: number): number {
  return Math.max(0.01, Math.min(0.99, pct / 100));
}

/**
 * AI Betting Bot — tracked bets data layer
 * -----------------------------------------
 *
 *  - `saveTrackedBet` persists a freshly generated analysis with status
 *    "pending" (or "needs_review" when the verdict was "pass").
 *  - `listTrackedBets` hydrates a user's bets for the dashboard and, as a
 *    side-effect, auto-settles any pending bets whose kickoff is at least
 *    ~3 hours in the past (i.e. the game is almost certainly over).
 *  - `settleTrackedBet` re-checks a single bet against ESPN and updates
 *    the score / status / profit in place.
 *  - `buildCalibrationSummary` turns settled bets into a compact string the
 *    research prompt can reference so the bot learns from its own track
 *    record.
 *
 * The grading logic is deliberately conservative:
 *   • Moneyline bets (home/away winner) are auto-graded from the final
 *     score.
 *   • Point/goal totals (over/under) are auto-graded when we can extract a
 *     line and the pickSummary/marketNormalized clearly say "over" or
 *     "under".
 *   • Anything else (spreads, player props, corners/cards) gets its score
 *     filled in but status is set to `needs_review` for a 1-click manual
 *     settle in the UI.
 */

type BetStatus = TrackedBetStatus;

/* ── Helpers ──────────────────────────────────────────────────────────── */

type AdminClient = { from: (table: string) => any };
function admin(): AdminClient {
   
  return supabaseAdmin as unknown as AdminClient;
}

/** Loose pick-side detection → "home" | "away" | null. */
function detectMoneylineSide(
  pick: string,
  market: string,
  home: string,
  away: string,
): "home" | "away" | null {
  const text = `${pick} ${market}`.toLowerCase();
  const homeL = home.toLowerCase();
  const awayL = away.toLowerCase();

  // Explicit moneyline wording is required; we don't want to mis-grade
  // spreads just because the user wrote "Lakers".
  const isMoneyline =
    /\bmoneyline|ml\b|\bto win\b|\bwin outright\b|\bstraight up\b/.test(text) ||
    market.toLowerCase().includes("moneyline");
  if (!isMoneyline) return null;

  if (homeL && text.includes(homeL)) return "home";
  if (awayL && text.includes(awayL)) return "away";

  // Try short/abbr fallbacks: first word of each team name.
  const homeToken = homeL.split(/\s+/).pop() ?? "";
  const awayToken = awayL.split(/\s+/).pop() ?? "";
  if (homeToken && text.includes(homeToken)) return "home";
  if (awayToken && text.includes(awayToken)) return "away";
  return null;
}

/** Parse an "over/under N.N" total from the pick. */
function detectTotal(
  pick: string,
  market: string,
): { side: "over" | "under"; line: number } | null {
  const text = `${pick} ${market}`.toLowerCase();
  const over = text.match(/\bover\s+(\d+(?:\.\d+)?)\b/);
  const under = text.match(/\bunder\s+(\d+(?:\.\d+)?)\b/);
  if (over) return { side: "over", line: Number(over[1]) };
  if (under) return { side: "under", line: Number(under[1]) };
  return null;
}

function finalise(
  outcome: BetStatus,
  oddsDecimal: number | null,
  notes: string,
): {
  status: BetStatus;
  profit_units: number | null;
  settlement_notes: string;
  settled_at: string;
} {
  let profit: number | null = null;
  if (outcome === "won" && oddsDecimal) profit = oddsDecimal - 1;
  else if (outcome === "lost") profit = -1;
  else if (outcome === "push" || outcome === "void") profit = 0;
  return {
    status: outcome,
    profit_units: profit,
    settlement_notes: notes,
    settled_at: new Date().toISOString(),
  };
}

/* ── Save ─────────────────────────────────────────────────────────────── */

export async function saveTrackedBet(params: {
  userId: string;
  query: string;
  result: BettingAnalysisResult;
  sportPath: string | null;
  espnEventId: string | null;
  espnHomeTeamId: string | null;
  espnAwayTeamId: string | null;
  stakeUsd: number | null;
}): Promise<TrackedBetRow> {
  const { userId, query, result } = params;

  const row: Partial<TrackedBetRow> = {
    user_id: userId,
    query,
    pick_summary: result.pickSummary,
    market_normalized: result.marketNormalized,
    sport_label: result.realData?.sportLabel ?? null,
    sport_path: params.sportPath,
    espn_event_id: params.espnEventId,
    espn_home_team_id: params.espnHomeTeamId,
    espn_away_team_id: params.espnAwayTeamId,
    home_team_name: result.fixture?.homeTeam ?? null,
    away_team_name: result.fixture?.awayTeam ?? null,
    kickoff: result.fixture?.kickoffIso ?? null,
    venue: result.fixture?.venue ?? null,
    odds_decimal: result.oddsUsed?.decimal ?? null,
    odds_american: result.oddsUsed?.american ?? null,
    stake_usd: params.stakeUsd,
    fair_win_probability_pct: result.fairWinProbabilityPct,
    confidence_pct: result.confidencePct,
    confidence_bin: result.confidenceBin,
    edge_pct: result.edgePct,
    verdict: result.verdict,
    composite_score: result.compositeScore,
    status: result.verdict === "pass" ? "needs_review" : "pending",
    snapshot: result,
  };

  const { data, error } = await admin()
    .from("betting_bot_bet")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(`saveTrackedBet failed: ${error.message}`);
  return data as TrackedBetRow;
}

/* ── Settlement ───────────────────────────────────────────────────────── */

async function applySettlement(
  bet: TrackedBetRow,
): Promise<TrackedBetRow> {
  // Not trackable → mark needs_review without touching status.
  if (!bet.sport_path || !bet.espn_event_id) {
    return bet;
  }

  const summary = await getEventSummary(
    bet.sport_path,
    bet.espn_event_id,
    bet.kickoff,
  );
  if (!summary) {
    // Game may not be on ESPN yet. Leave as-is but stamp updated_at.
    return bet;
  }

  // Persist latest scores regardless of grading decision.
  const scorePatch = {
    home_score: summary.homeScore,
    away_score: summary.awayScore,
  };

  if (!summary.completed) {
    await admin().from("betting_bot_bet").update(scorePatch).eq("id", bet.id);
    return { ...bet, ...scorePatch };
  }

  const home = summary.homeScore ?? 0;
  const away = summary.awayScore ?? 0;

  // Feed the result into the internal Elo engine so the next request
  // for either team has fresh power-rating numbers. Best-effort, no-throw.
  if (
    bet.sport_path &&
    bet.espn_home_team_id &&
    bet.espn_away_team_id &&
    Number.isFinite(summary.homeScore) &&
    Number.isFinite(summary.awayScore)
  ) {
    void recordEloFromResult({
      sport: bet.sport_path,
      homeTeamId: bet.espn_home_team_id,
      awayTeamId: bet.espn_away_team_id,
      homeScore: home,
      awayScore: away,
      gameDate: bet.kickoff,
    });
  }

  // Compute closing-line value: look up the latest odds_snapshot before
  // kickoff, compare to the price the user took. Best-effort; null if
  // we never captured a near-kickoff snapshot for this fixture.
  void computeAndPersistClv(bet);

  // Moneyline?
  const side = detectMoneylineSide(
    bet.pick_summary,
    bet.market_normalized,
    bet.home_team_name ?? "",
    bet.away_team_name ?? "",
  );
  if (side) {
    const win =
      (side === "home" && home > away) || (side === "away" && away > home);
    const outcome: BetStatus = home === away ? "push" : win ? "won" : "lost";
    const settled = finalise(
      outcome,
      bet.odds_decimal,
      `Auto-graded moneyline (${bet.away_team_name ?? "away"} ${away} @ ${bet.home_team_name ?? "home"} ${home}).`,
    );
    const patch = { ...scorePatch, ...settled };
    await admin().from("betting_bot_bet").update(patch).eq("id", bet.id);
    return { ...bet, ...patch };
  }

  // Over/Under total?
  const total = detectTotal(bet.pick_summary, bet.market_normalized);
  if (total) {
    const sum = home + away;
    let outcome: BetStatus = "needs_review";
    if (sum === total.line) outcome = "push";
    else if ((total.side === "over" && sum > total.line) || (total.side === "under" && sum < total.line))
      outcome = "won";
    else outcome = "lost";
    const settled = finalise(
      outcome,
      bet.odds_decimal,
      `Auto-graded total (${total.side} ${total.line}) → final ${home}-${away} = ${sum}.`,
    );
    const patch = { ...scorePatch, ...settled };
    await admin().from("betting_bot_bet").update(patch).eq("id", bet.id);
    return { ...bet, ...patch };
  }

  // Unknown market — stamp the score and flag for manual review.
  const patch = {
    ...scorePatch,
    status: "needs_review" as BetStatus,
    settlement_notes:
      "Final score fetched; click W/L/Push to grade this market manually.",
    settled_at: new Date().toISOString(),
  };
  await admin().from("betting_bot_bet").update(patch).eq("id", bet.id);
  return { ...bet, ...patch };
}

export async function settleTrackedBet(
  userId: string,
  betId: string,
): Promise<TrackedBetRow | null> {
  const { data, error } = await admin()
    .from("betting_bot_bet")
    .select("*")
    .eq("user_id", userId)
    .eq("id", betId)
    .single();
  if (error || !data) return null;
  return applySettlement(data as TrackedBetRow);
}

/** Settle any still-pending bets whose kickoff is ≥ 3h in the past. */
export async function autoSettlePending(userId: string): Promise<number> {
  const threshold = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin()
    .from("betting_bot_bet")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .not("espn_event_id", "is", null)
    .lt("kickoff", threshold);
  if (error || !data) return 0;
  let touched = 0;
  for (const bet of data as TrackedBetRow[]) {
    try {
      const updated = await applySettlement(bet);
      if (updated.status !== "pending") touched += 1;
    } catch {
      /* keep going */
    }
  }
  return touched;
}

/* ── List + calibration ───────────────────────────────────────────────── */

export async function listTrackedBets(
  userId: string,
): Promise<TrackedBetRow[]> {
  const { data, error } = await admin()
    .from("betting_bot_bet")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`listTrackedBets failed: ${error.message}`);
  return (data ?? []) as TrackedBetRow[];
}

export function buildCalibrationSummary(
  bets: TrackedBetRow[],
): CalibrationSummary {
  const settled = bets.filter(
    (b) => b.status === "won" || b.status === "lost" || b.status === "push",
  );
  const pending = bets.filter((b) => b.status === "pending").length;
  const needsReview = bets.filter((b) => b.status === "needs_review").length;

  const wins = settled.filter((b) => b.status === "won").length;
  const losses = settled.filter((b) => b.status === "lost").length;
  const pushes = settled.filter((b) => b.status === "push").length;

  const profitUnits = settled.reduce(
    (acc, b) => acc + (b.profit_units ?? 0),
    0,
  );
  const stakedUnits = settled.length; // 1 unit flat, pushes included
  const roiPct = stakedUnits > 0 ? (profitUnits / stakedUnits) * 100 : null;
  const winRatePct =
    settled.length > 0 ? (wins / Math.max(1, wins + losses)) * 100 : null;

  // Brier score = mean((prob - outcome)^2), lower is better. Push skipped.
  const brierBets = settled.filter((b) => b.status !== "push");
  const brier =
    brierBets.length === 0
      ? null
      : brierBets.reduce((acc, b) => {
          const p = (b.fair_win_probability_pct ?? 50) / 100;
          const o = b.status === "won" ? 1 : 0;
          return acc + (p - o) ** 2;
        }, 0) / brierBets.length;

  const bins: CalibrationBucket["bin"][] = ["low", "moderate", "high", "elite"];
  const buckets = bins.map<CalibrationBucket>((bin) => {
    const group = settled.filter((b) => b.confidence_bin === bin);
    const w = group.filter((b) => b.status === "won").length;
    const l = group.filter((b) => b.status === "lost").length;
    const p = group.filter((b) => b.status === "push").length;
    const profit = group.reduce((acc, b) => acc + (b.profit_units ?? 0), 0);
    const confidenceSum = group.reduce(
      (acc, b) => acc + (b.confidence_pct ?? 0),
      0,
    );
    return {
      bin,
      settled: group.length,
      wins: w,
      losses: l,
      pushes: p,
      winRatePct:
        w + l > 0 ? (w / (w + l)) * 100 : null,
      roiPct: group.length > 0 ? (profit / group.length) * 100 : null,
      avgConfidence:
        group.length > 0 ? confidenceSum / group.length : null,
    };
  });

  // CLV — only count bets where we captured a closing-line snapshot.
  const clvBets = settled.filter((b) => typeof b.clv_pct === "number");
  const meanClvPct =
    clvBets.length > 0
      ? clvBets.reduce((acc, b) => acc + (b.clv_pct ?? 0), 0) / clvBets.length
      : null;

  return {
    settled: settled.length,
    wins,
    losses,
    pushes,
    winRatePct,
    roiPct,
    profitUnits,
    meanClvPct: meanClvPct != null ? Number(meanClvPct.toFixed(2)) : null,
    clvSampleSize: clvBets.length,
    brier,
    buckets,
    pending,
    needsReview,
  };
}

/**
 * Compact one-line-per-bucket summary the research prompt can use to
 * recalibrate. Returns empty string when we have no data yet so the prompt
 * stays clean.
 */
export function formatCalibrationForPrompt(
  summary: CalibrationSummary,
): string {
  if (summary.settled === 0) return "";
  const pct = (n: number | null) =>
    n == null ? "n/a" : `${n.toFixed(1)}%`;
  const lines = summary.buckets
    .filter((b) => b.settled >= 3)
    .map(
      (b) =>
        `  - ${b.bin.padEnd(8)} (${b.settled} settled): win ${pct(b.winRatePct)}, ROI ${pct(b.roiPct)}, avg-stated-conf ${pct(b.avgConfidence)}`,
    )
    .join("\n");
  const clvLine =
    summary.meanClvPct != null && summary.clvSampleSize > 0
      ? `, mean CLV ${summary.meanClvPct > 0 ? "+" : ""}${summary.meanClvPct.toFixed(2)}% over ${summary.clvSampleSize} bets`
      : "";
  const header = `HISTORICAL SELF-CALIBRATION (this user's ${summary.settled} settled bets, ROI ${pct(summary.roiPct)}, Brier ${summary.brier == null ? "n/a" : summary.brier.toFixed(3)}${clvLine}):`;
  return lines ? `${header}\n${lines}\n(If a bucket's actual win rate is materially below its stated confidence, shrink your confidence accordingly on similar bets today.)` : "";
}

export function buildModelReportCard(
  bets: TrackedBetRow[],
  lookbackDays = 90,
): ModelReportCard {
  const now = Date.now();
  const cutoff = now - lookbackDays * 24 * 60 * 60 * 1000;
  const filtered = bets.filter((b) => Date.parse(b.created_at) >= cutoff);
  const settled = filtered.filter((b) => isSettledStatus(b.status));
  const actionable = filtered.filter((b) => b.verdict !== "pass");
  const settledWl = settled.filter((b) => b.status === "won" || b.status === "lost");
  const passRatePct = filtered.length ? (filtered.filter((b) => b.verdict === "pass").length / filtered.length) * 100 : null;
  const actionRatePct = filtered.length ? (actionable.length / filtered.length) * 100 : null;
  const roiPct = settled.length ? (settled.reduce((a, b) => a + (b.profit_units ?? 0), 0) / settled.length) * 100 : null;
  const clvVals = settled.map((b) => b.clv_pct).filter((n): n is number => typeof n === "number");
  const meanClvPct = mean(clvVals);
  const brierVals = settledWl.map((b) => {
    const p = clipProb(b.fair_win_probability_pct ?? 50);
    const o = b.status === "won" ? 1 : 0;
    return (p - o) ** 2;
  });
  const logVals = settledWl.map((b) => {
    const p = clipProb(b.fair_win_probability_pct ?? 50);
    const o = b.status === "won" ? 1 : 0;
    return -(o * Math.log(p) + (1 - o) * Math.log(1 - p));
  });

  const markets: Array<ReportCardMarketRow["market"]> = ["corners", "goals", "btts", "other"];
  const byMarket: ReportCardMarketRow[] = markets.map((mk) => {
    const group = filtered.filter((b) => marketFamily(b.market_normalized) === mk);
    const gSettled = group.filter((b) => isSettledStatus(b.status));
    const gWl = gSettled.filter((b) => b.status === "won" || b.status === "lost");
    const gRoi = gSettled.length
      ? (gSettled.reduce((a, b) => a + (b.profit_units ?? 0), 0) / gSettled.length) * 100
      : null;
    const gWin = gWl.length
      ? (gWl.filter((b) => b.status === "won").length / gWl.length) * 100
      : null;
    const gClv = mean(gSettled.map((b) => b.clv_pct).filter((n): n is number => typeof n === "number"));
    const gBrier = mean(
      gWl.map((b) => {
        const p = clipProb(b.fair_win_probability_pct ?? 50);
        const o = b.status === "won" ? 1 : 0;
        return (p - o) ** 2;
      }),
    );
    const gLog = mean(
      gWl.map((b) => {
        const p = clipProb(b.fair_win_probability_pct ?? 50);
        const o = b.status === "won" ? 1 : 0;
        return -(o * Math.log(p) + (1 - o) * Math.log(1 - p));
      }),
    );
    return {
      market: mk,
      bets: group.length,
      settled: gSettled.length,
      passRatePct: group.length ? (group.filter((b) => b.verdict === "pass").length / group.length) * 100 : null,
      actionRatePct: group.length ? (group.filter((b) => b.verdict !== "pass").length / group.length) * 100 : null,
      roiPct: gRoi,
      winRatePct: gWin,
      meanClvPct: gClv,
      brier: gBrier,
      logLoss: gLog,
    };
  });

  const edgeBucketsOrder: ReportCardEdgeBucket["bucket"][] = ["<0%", "0-1%", "1-2%", "2-4%", "4%+"];
  const edgeBuckets: ReportCardEdgeBucket[] = edgeBucketsOrder.map((bucket) => {
    const group = filtered.filter((b) => edgeBucket(b.edge_pct) === bucket);
    const gSettled = group.filter((b) => isSettledStatus(b.status));
    const gWl = gSettled.filter((b) => b.status === "won" || b.status === "lost");
    const roi = gSettled.length
      ? (gSettled.reduce((a, b) => a + (b.profit_units ?? 0), 0) / gSettled.length) * 100
      : null;
    const win = gWl.length
      ? (gWl.filter((b) => b.status === "won").length / gWl.length) * 100
      : null;
    return { bucket, bets: group.length, settled: gSettled.length, roiPct: roi, winRatePct: win };
  });

  const weeklyMap = new Map<string, TrackedBetRow[]>();
  for (const b of settled) {
    const d = new Date(b.created_at);
    const day = d.getUTCDay();
    const diff = (day + 6) % 7; // monday start
    d.setUTCDate(d.getUTCDate() - diff);
    const key = d.toISOString().slice(0, 10);
    if (!weeklyMap.has(key)) weeklyMap.set(key, []);
    weeklyMap.get(key)!.push(b);
  }
  const weekly: ReportCardWeeklyRow[] = Array.from(weeklyMap.entries())
    .map(([weekStartIso, group]) => ({
      weekStartIso,
      settled: group.length,
      roiPct: group.length ? (group.reduce((a, b) => a + (b.profit_units ?? 0), 0) / group.length) * 100 : null,
      meanClvPct: mean(group.map((b) => b.clv_pct).filter((n): n is number => typeof n === "number")),
    }))
    .sort((a, b) => (a.weekStartIso < b.weekStartIso ? 1 : -1))
    .slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays,
    totalBets: filtered.length,
    settledBets: settled.length,
    passRatePct,
    actionRatePct,
    roiPct,
    meanClvPct,
    brier: mean(brierVals),
    logLoss: mean(logVals),
    byMarket,
    edgeBuckets,
    weekly,
  };
}

export async function manualGradeBet(
  userId: string,
  betId: string,
  outcome: "won" | "lost" | "push" | "void" | "cancelled",
  userNotes?: string,
): Promise<TrackedBetRow | null> {
  const { data, error } = await admin()
    .from("betting_bot_bet")
    .select("*")
    .eq("user_id", userId)
    .eq("id", betId)
    .single();
  if (error || !data) return null;
  const bet = data as TrackedBetRow;
  const patch =
    outcome === "cancelled"
      ? {
          status: "cancelled" as BetStatus,
          profit_units: null,
          settled_at: new Date().toISOString(),
          settlement_notes: "Cancelled by user.",
        }
      : finalise(
          outcome,
          bet.odds_decimal,
          userNotes?.trim() || `Manually graded ${outcome}.`,
        );
  const userNotePatch = userNotes?.trim() ? { user_notes: userNotes.trim() } : {};
  const { data: upd, error: updErr } = await admin()
    .from("betting_bot_bet")
    .update({ ...patch, ...userNotePatch })
    .eq("user_id", userId)
    .eq("id", betId)
    .select("*")
    .single();
  if (updErr) return null;
  return upd as TrackedBetRow;
}

export async function deleteTrackedBet(
  userId: string,
  betId: string,
): Promise<boolean> {
  const { error } = await admin()
    .from("betting_bot_bet")
    .delete()
    .eq("user_id", userId)
    .eq("id", betId);
  return !error;
}
