import "server-only";
import type { BettingBookOdds, TrackedBetRow } from "@/lib/betting-bot";
import { supabaseAdmin } from "@/lib/supabase";
import { eventKeyFor } from "@/lib/odds-history";

/**
 * Closing-line value (CLV) computation for a tracked bet.
 *
 * Why pros track this: over a small sample (10-50 settled bets), CLV is
 * a far better signal of "are you actually beating the market" than ROI.
 * If you consistently took prices that were better than the closing
 * line, you'll be profitable in the long run regardless of recent W/L.
 *
 * What we do here:
 *   1. Find the latest odds_snapshot for this fixture captured BEFORE
 *      kickoff (the closing line, approximately).
 *   2. Match the snapshot to the bet's market (moneyline / totals) and
 *      side (home / away / over / under) to get the closing decimal odds.
 *   3. Compute CLV % = (bet_odds / closing_odds - 1) * 100. Positive
 *      means you got a better price than where the line closed.
 *   4. Persist closing_odds_decimal, closing_implied_pct, clv_pct on
 *      the tracked bet row.
 *
 * Best-effort: if we have no snapshot near kickoff, columns stay null.
 */

function admin() {
  return supabaseAdmin as unknown as { from: (t: string) => any };
}

interface SnapshotRow {
  captured_at: string;
  books: BettingBookOdds[];
}

/** Pull the snapshot closest to (but not after) kickoff. */
async function latestPreKickoffSnapshot(
  eventKey: string,
  kickoffIso: string,
): Promise<SnapshotRow | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { data, error } = await admin()
      .from("odds_snapshots")
      .select("captured_at, books")
      .eq("event_key", eventKey)
      .lte("captured_at", kickoffIso)
      .order("captured_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return data[0] as SnapshotRow;
  } catch {
    return null;
  }
}

/**
 * Pick the decimal odds from a snapshot that match the bet's market
 * + side. We're conservative — only return a number we're confident is
 * the right comparison line.
 */
function priceForBet(
  bet: TrackedBetRow,
  books: BettingBookOdds[],
): number | null {
  if (!books.length) return null;
  const market = (bet.market_normalized || "").toLowerCase();
  const pick = (bet.pick_summary || "").toLowerCase();

  // Median across books is the consensus closing price.
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
  };

  // Totals first — distinguishable by "over"/"under" in pick or market.
  if (/\bover\b/.test(pick) || /\bover\b/.test(market)) {
    const xs = books.map((b) => b.overOdds).filter((v): v is number => v != null);
    return median(xs);
  }
  if (/\bunder\b/.test(pick) || /\bunder\b/.test(market)) {
    const xs = books.map((b) => b.underOdds).filter((v): v is number => v != null);
    return median(xs);
  }

  const home = (bet.home_team_name ?? "").toLowerCase();
  const away = (bet.away_team_name ?? "").toLowerCase();

  // Moneyline.
  if (home && pick.includes(home)) {
    const xs = books.map((b) => b.moneylineHome).filter((v): v is number => v != null);
    return median(xs);
  }
  if (away && pick.includes(away)) {
    const xs = books.map((b) => b.moneylineAway).filter((v): v is number => v != null);
    return median(xs);
  }

  return null;
}

export async function computeAndPersistClv(bet: TrackedBetRow): Promise<void> {
  if (bet.clv_pct != null) return; // already computed
  if (!bet.odds_decimal || !bet.kickoff) return;
  if (!bet.home_team_name || !bet.away_team_name) return;

  const eventKey = eventKeyFor({
    homeTeamName: bet.home_team_name,
    awayTeamName: bet.away_team_name,
    kickoffIso: bet.kickoff,
  });

  const snap = await latestPreKickoffSnapshot(eventKey, bet.kickoff);
  if (!snap) return;

  const closing = priceForBet(bet, snap.books);
  if (!closing || closing <= 1) return;

  const clvPct = ((bet.odds_decimal / closing) - 1) * 100;
  const closingImpliedPct = (1 / closing) * 100;

  try {
    await admin()
      .from("betting_bot_bet")
      .update({
        closing_odds_decimal: Number(closing.toFixed(4)),
        closing_implied_pct: Number(closingImpliedPct.toFixed(2)),
        clv_pct: Number(clvPct.toFixed(2)),
      })
      .eq("id", bet.id);
  } catch {
    // best-effort
  }
}
