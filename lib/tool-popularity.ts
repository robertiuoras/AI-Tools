/**
 * Ranking helpers for /api/tools and related endpoints.
 *
 * ## Monthly upvotes
 * Count of upvote rows for the tool where `upvotedAt` falls in the **current local
 * calendar month**. Same window is used for the public counter on cards.
 *
 * ## Star rating (0–5 on the `tool` row)
 * A **static estimate** from admin curation / analyze pipeline (not aggregated
 * user reviews). Used only as a tie-breaker.
 *
 * ## Honest popularity score (0..100)
 * Computed in `lib/popularity-signals.ts` from real, free signals:
 * Tranco rank, domain age (RDAP / Wayback), GitHub stars, Wikipedia presence
 * + 90-day pageviews, and on-page hard claims. Rows that haven't been
 * refreshed yet have a `null` score and we fall back to the legacy
 * log-scaled `estimatedVisits` value (still null in many cases — that's
 * expected and honest).
 *
 * ## "Most Popular" (composite)
 * Sort key = monthly upvotes (dominates) + popularity score (tie-breaker)
 * + star rating (final tie-breaker).
 */

/** Shown in the UI help dialog — keep in sync with `popularityScore`. */
export const MOST_POPULAR_HELP = {
  title: 'How "Most Popular" is ranked',
  bullets: [
    "Community upvotes this month matter most — each upvote in the current calendar month adds the biggest boost.",
    "An honest popularity score (0–100) breaks ties — it blends the tool's Tranco rank, GitHub stars, domain age, Wikipedia presence and on-page user claims (no fake traffic guesses).",
    "The star rating on each card is a curated 0–5 estimate (from listings / analysis), not user reviews — it’s the final tie-breaker.",
    '"Most Upvoted" sorts by monthly upvotes only; "Most Popular" blends all three signals.',
  ],
} as const;

/** Start of current month in local timezone, as ISO string (for `upvotedAt` filters). */
export function getLocalMonthStartIso(): string {
  const n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth(), 1, 0, 0, 0, 0);
  return start.toISOString();
}

/**
 * Composite popularity score (higher = rank higher).
 * Integer-friendly to avoid float sort quirks.
 *
 * The middle weight prefers the new `popularityScore` (0..100, real signals)
 * when present; for legacy rows with no signals computed yet we degrade to
 * the old log-scaled `estimatedVisits` term so ranking doesn't collapse.
 */
export function popularityScore(tool: {
  upvoteCount?: number;
  estimatedVisits?: number | null;
  rating?: number | null;
  popularityScore?: number | null;
}): number {
  const up = Math.max(0, Number(tool.upvoteCount) || 0);
  const rating = Math.min(5, Math.max(0, Number(tool.rating) || 0));

  // Real signal first; legacy estimate only as a fallback for un-refreshed rows.
  let middleTerm = 0;
  const real = tool.popularityScore;
  if (typeof real === "number" && Number.isFinite(real) && real > 0) {
    // Pop score is 0..100; multiply to land in roughly the same numeric range
    // as the legacy log-scaled visit term (which capped around 10k).
    middleTerm = Math.round(real * 100);
  } else {
    const visits = tool.estimatedVisits ?? 0;
    middleTerm = visits > 0 ? Math.round(Math.log10(visits + 1) * 1_000) : 0;
  }

  const ratingTerm = Math.round(rating * 100);
  return up * 1_000_000 + middleTerm + ratingTerm;
}
