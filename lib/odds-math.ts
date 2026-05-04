import "server-only";
import type {
  BettingBookOdds,
  BettingMarketConsensus,
} from "@/lib/betting-bot";

/**
 * Vigorish removal + multi-book consensus pricing.
 *
 * Why this matters: every offered price contains the bookmaker's edge
 * (the "vig"). Decimal odds 1.91 / 1.91 imply 52.4% / 52.4% = 104.7%, so
 * the *true* fair-prob is 50/50. Comparing your model's fair prob to a
 * vig-fattened book number biases edge calculations high.
 *
 * Pros do this in two steps:
 *   1. For each book, normalise the prices so the implied probabilities
 *      sum to 1.0 (proportional vig allocation — the standard method).
 *   2. Take the median across books. Median (not mean) trims outlier
 *      books that are stale or simply mispriced.
 *
 * The Pinnacle book, when present, is treated as the sharp consensus
 * and surfaced separately so the prompt can reason about it.
 */

interface NormalisedThreeWay {
  homePct: number;
  drawPct: number | null;
  awayPct: number;
}

interface NormalisedTotal {
  line: number;
  overPct: number;
  underPct: number;
}

/** Two-way (no draw) — basketball, hockey, NFL, tennis, etc. */
export function removeVig2Way(
  homeDec: number | null,
  awayDec: number | null,
): { homePct: number; awayPct: number } | null {
  if (!homeDec || !awayDec || homeDec <= 1 || awayDec <= 1) return null;
  const ph = 1 / homeDec;
  const pa = 1 / awayDec;
  const sum = ph + pa;
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return { homePct: (ph / sum) * 100, awayPct: (pa / sum) * 100 };
}

/** Three-way (home / draw / away) — soccer-style markets. */
export function removeVig3Way(
  homeDec: number | null,
  drawDec: number | null,
  awayDec: number | null,
): NormalisedThreeWay | null {
  if (!homeDec || !awayDec || homeDec <= 1 || awayDec <= 1) return null;
  const ph = 1 / homeDec;
  const pa = 1 / awayDec;
  const pd = drawDec && drawDec > 1 ? 1 / drawDec : null;
  const sum = ph + pa + (pd ?? 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return {
    homePct: (ph / sum) * 100,
    drawPct: pd != null ? (pd / sum) * 100 : null,
    awayPct: (pa / sum) * 100,
  };
}

/** Total over/under. Vig comes off proportionally so over+under = 100%. */
export function removeVigTotal(
  line: number | null,
  overDec: number | null,
  underDec: number | null,
): NormalisedTotal | null {
  if (line == null || !overDec || !underDec || overDec <= 1 || underDec <= 1) {
    return null;
  }
  const po = 1 / overDec;
  const pu = 1 / underDec;
  const sum = po + pu;
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return {
    line,
    overPct: (po / sum) * 100,
    underPct: (pu / sum) * 100,
  };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Compute the multi-book vig-free consensus across a board. Uses median
 * (not mean) so a single stale book can't drag the consensus.
 */
export function buildMarketConsensus(
  books: BettingBookOdds[],
): BettingMarketConsensus | null {
  if (books.length === 0) return null;

  const homePcts: number[] = [];
  const drawPcts: number[] = [];
  const awayPcts: number[] = [];
  const overByLine = new Map<number, { overs: number[]; unders: number[] }>();
  let pinnacle: BettingMarketConsensus["pinnacle"] | null = null;

  for (const b of books) {
    // Three-way first (soccer); fall back to two-way for other sports.
    const moneyline =
      b.draw != null
        ? removeVig3Way(b.moneylineHome, b.draw, b.moneylineAway)
        : (() => {
            const r = removeVig2Way(b.moneylineHome, b.moneylineAway);
            return r ? { homePct: r.homePct, drawPct: null, awayPct: r.awayPct } : null;
          })();
    if (moneyline) {
      homePcts.push(moneyline.homePct);
      awayPcts.push(moneyline.awayPct);
      if (moneyline.drawPct != null) drawPcts.push(moneyline.drawPct);
    }

    if (b.total != null && b.overOdds != null && b.underOdds != null) {
      const t = removeVigTotal(b.total, b.overOdds, b.underOdds);
      if (t) {
        const bucket = overByLine.get(t.line) ?? { overs: [], unders: [] };
        bucket.overs.push(t.overPct);
        bucket.unders.push(t.underPct);
        overByLine.set(t.line, bucket);
      }
    }

    if (b.key === "pinnacle" || /pinnacle/i.test(b.provider ?? "")) {
      const p =
        b.draw != null
          ? removeVig3Way(b.moneylineHome, b.draw, b.moneylineAway)
          : (() => {
              const r = removeVig2Way(b.moneylineHome, b.moneylineAway);
              return r ? { homePct: r.homePct, drawPct: null, awayPct: r.awayPct } : null;
            })();
      if (p) {
        pinnacle = {
          homeWinProbPct: Number(p.homePct.toFixed(2)),
          drawProbPct:
            p.drawPct != null ? Number(p.drawPct.toFixed(2)) : null,
          awayWinProbPct: Number(p.awayPct.toFixed(2)),
        };
      }
    }
  }

  // Pick the most-quoted total line (the line books agree on).
  let popularTotalLine: number | null = null;
  let popularEntry: { overs: number[]; unders: number[] } | null = null;
  let bestCount = 0;
  for (const [line, entry] of overByLine.entries()) {
    if (entry.overs.length > bestCount) {
      bestCount = entry.overs.length;
      popularTotalLine = line;
      popularEntry = entry;
    }
  }

  const homeMedian = median(homePcts);
  if (homeMedian == null && popularEntry == null) return null;

  return {
    homeWinProbPct:
      homeMedian != null ? Number(homeMedian.toFixed(2)) : null,
    drawProbPct: drawPcts.length
      ? Number(median(drawPcts)!.toFixed(2))
      : null,
    awayWinProbPct: median(awayPcts) != null
      ? Number(median(awayPcts)!.toFixed(2))
      : null,
    totalLine: popularTotalLine,
    overProbPct: popularEntry
      ? Number(median(popularEntry.overs)!.toFixed(2))
      : null,
    underProbPct: popularEntry
      ? Number(median(popularEntry.unders)!.toFixed(2))
      : null,
    bookCount: books.length,
    pinnacle,
  };
}
