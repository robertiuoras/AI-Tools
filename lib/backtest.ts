import "server-only";
import { eloWinProbability } from "@/lib/elo";

/**
 * Walk-forward backtest engine for the Elo predictor.
 *
 * Method: take a chronological list of completed fixtures, replay them
 * through Elo, and at each step record (predictedHomeProb, actualOutcome)
 * BEFORE the result is fed back. That's the only way to avoid look-ahead
 * bias — the engine never sees the result it's predicting.
 *
 * Output:
 *   - calibration: 10 buckets of predicted prob (0-10%, 10-20%, …),
 *     for each bucket the actual home-win rate. A perfectly calibrated
 *     model has actual = predicted in every bucket.
 *   - brier: mean((predicted - actual)^2). Lower is better. 0.25 is the
 *     coin-flip baseline; <0.22 is meaningful skill.
 *   - logLoss: -(o*log(p) + (1-o)*log(1-p)). 0.69 is coin-flip; lower better.
 *   - sample: total games used.
 *
 * Doesn't claim to backtest betting ROI — that needs historical odds
 * snapshots we don't have. This measures *probabilistic skill* on the
 * raw outcome, which is the right starting point.
 */

export interface BacktestGame {
  date: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
}

interface RatingsState {
  ratings: Map<string, { rating: number; games: number }>;
}

const STARTING_RATING = 1500;
const DEFAULT_K = 22;
const MARGIN_BASE = 2.2;

function getRating(state: RatingsState, id: string): number {
  return state.ratings.get(id)?.rating ?? STARTING_RATING;
}

function gamesPlayed(state: RatingsState, id: string): number {
  return state.ratings.get(id)?.games ?? 0;
}

function updateRating(
  state: RatingsState,
  id: string,
  newRating: number,
): void {
  const cur = state.ratings.get(id);
  state.ratings.set(id, {
    rating: newRating,
    games: (cur?.games ?? 0) + 1,
  });
}

export interface BacktestResult {
  sample: number;
  brier: number;
  logLoss: number;
  homeWinRate: number;
  /** [bucketLow, bucketHigh, count, predictedAvg, actualHitRate] */
  calibration: Array<{
    rangeLow: number;
    rangeHigh: number;
    count: number;
    avgPredicted: number;
    actualHitRate: number;
  }>;
  /** Subset of games where Elo gave a confident pick (>60% on either side). */
  confidentSubset: {
    sample: number;
    accuracy: number;
  };
  warmupCutoff: number;
  notes: string;
}

/**
 * Replay games chronologically. The first `warmup` games per team are
 * used to seed Elo and excluded from the metrics — otherwise our
 * "predictions" come from the default 1500 rating which is meaningless.
 */
export function runBacktest(
  games: BacktestGame[],
  options: {
    sport: string;
    warmupGamesPerTeam?: number;
    k?: number;
  },
): BacktestResult {
  const k = options.k ?? DEFAULT_K;
  const warmup = options.warmupGamesPerTeam ?? 5;
  const state: RatingsState = { ratings: new Map() };

  const sorted = [...games].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date),
  );

  type Sample = { predHome: number; actualHome: number };
  const samples: Sample[] = [];

  for (const g of sorted) {
    const hRating = getRating(state, g.homeId);
    const aRating = getRating(state, g.awayId);
    const hGames = gamesPlayed(state, g.homeId);
    const aGames = gamesPlayed(state, g.awayId);

    const predHome = eloWinProbability(hRating, aRating, options.sport);
    const actualHome =
      g.homeScore > g.awayScore ? 1 : g.homeScore < g.awayScore ? 0 : 0.5;

    if (hGames >= warmup && aGames >= warmup) {
      samples.push({ predHome, actualHome });
    }

    // Elo update with margin-of-victory multiplier.
    const expected = predHome;
    const margin = Math.abs(g.homeScore - g.awayScore);
    const ratingDiff = Math.abs(hRating - aRating);
    const movMult = Math.log(margin + 1) * (MARGIN_BASE / (ratingDiff * 0.001 + MARGIN_BASE));
    const adjK = k * Math.max(0.6, Math.min(2.5, movMult || 1));

    updateRating(state, g.homeId, hRating + adjK * (actualHome - expected));
    updateRating(state, g.awayId, aRating + adjK * ((1 - actualHome) - (1 - expected)));
  }

  // Brier + log-loss across out-of-warmup samples.
  let brierSum = 0;
  let logLossSum = 0;
  let homeWins = 0;
  for (const s of samples) {
    brierSum += (s.predHome - s.actualHome) ** 2;
    const p = Math.min(0.999, Math.max(0.001, s.predHome));
    const o = s.actualHome;
    logLossSum += -(o * Math.log(p) + (1 - o) * Math.log(1 - p));
    if (s.actualHome >= 0.5) homeWins += 1;
  }
  const n = samples.length;
  const brier = n > 0 ? brierSum / n : 0;
  const logLoss = n > 0 ? logLossSum / n : 0;
  const homeWinRate = n > 0 ? homeWins / n : 0;

  // Calibration plot — 10 buckets.
  const calibration: BacktestResult["calibration"] = [];
  const buckets = 10;
  for (let i = 0; i < buckets; i += 1) {
    const lo = i / buckets;
    const hi = (i + 1) / buckets;
    const inBucket = samples.filter(
      (s) => s.predHome >= lo && (i === buckets - 1 ? s.predHome <= hi : s.predHome < hi),
    );
    if (inBucket.length === 0) {
      calibration.push({
        rangeLow: lo,
        rangeHigh: hi,
        count: 0,
        avgPredicted: 0,
        actualHitRate: 0,
      });
      continue;
    }
    const avgPred = inBucket.reduce((a, s) => a + s.predHome, 0) / inBucket.length;
    const wins = inBucket.filter((s) => s.actualHome >= 0.5).length;
    calibration.push({
      rangeLow: Number(lo.toFixed(2)),
      rangeHigh: Number(hi.toFixed(2)),
      count: inBucket.length,
      avgPredicted: Number(avgPred.toFixed(3)),
      actualHitRate: Number((wins / inBucket.length).toFixed(3)),
    });
  }

  // Confident subset — Elo gave a >60% pick on either side; how often right?
  const confident = samples.filter((s) => s.predHome > 0.6 || s.predHome < 0.4);
  const confidentRight = confident.filter(
    (s) =>
      (s.predHome > 0.6 && s.actualHome >= 0.5) ||
      (s.predHome < 0.4 && s.actualHome < 0.5),
  );
  const confidentSubset = {
    sample: confident.length,
    accuracy:
      confident.length > 0
        ? Number((confidentRight.length / confident.length).toFixed(3))
        : 0,
  };

  return {
    sample: n,
    brier: Number(brier.toFixed(4)),
    logLoss: Number(logLoss.toFixed(4)),
    homeWinRate: Number(homeWinRate.toFixed(3)),
    calibration,
    confidentSubset,
    warmupCutoff: warmup,
    notes:
      "Walk-forward Elo replay. Brier <0.22 = meaningful skill (coin-flip = 0.25). LogLoss <0.65 likewise (coin-flip = 0.69). Calibration: avg-predicted should track actual hit rate per bucket within ±5 points.",
  };
}
