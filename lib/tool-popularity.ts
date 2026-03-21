/**
 * Ranking helpers for /api/tools and related endpoints.
 *
 * ## Monthly upvotes
 * Count of upvote rows for the tool where `upvotedAt` falls in the **current local
 * calendar month**. Same window is used for the public counter on cards.
 *
 * ## Star rating (0–5 on the `tool` row)
 * A **static estimate** from admin curation / analyze pipeline (not aggregated
 * user reviews). Used only as a tie-breaker after upvotes and traffic.
 *
 * ## "Most Popular" (composite)
 * Sort key = f(monthly upvotes, log-scaled estimated visits, star rating).
 * Upvotes dominate; visits and rating break ties.
 */

/** Shown in the UI help dialog — keep in sync with `popularityScore`. */
export const MOST_POPULAR_HELP = {
  title: 'How "Most Popular" is ranked',
  bullets: [
    "Community upvotes this month matter most — each upvote in the current calendar month adds the biggest boost.",
    "Estimated monthly visits are next (log-scaled), so one huge site doesn’t drown out everything else.",
    "The star rating on each card is a curated 0–5 estimate (from listings / analysis), not user reviews — it’s only used to break ties.",
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
 */
export function popularityScore(tool: {
  upvoteCount?: number;
  estimatedVisits?: number | null;
  rating?: number | null;
}): number {
  const up = Math.max(0, Number(tool.upvoteCount) || 0);
  const visits = tool.estimatedVisits ?? 0;
  const rating = Math.min(5, Math.max(0, Number(tool.rating) || 0));
  const visitTerm =
    visits > 0 ? Math.round(Math.log10(visits + 1) * 1_000) : 0;
  const ratingTerm = Math.round(rating * 100);
  return up * 1_000_000 + visitTerm + ratingTerm;
}
