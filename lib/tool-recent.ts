/** Local calendar day as YYYY-MM-DD (for “added today” UX). */
export function getLocalDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localDateKeyFromCreatedAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return getLocalDateKey(new Date(t));
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * True if the tool was created within the last 24 hours (rolling window).
 *
 * Was previously a calendar-day match in local time, which dropped the
 * "Last 24h" tile to 0 the instant midnight rolled over even when
 * tools had been added an hour earlier. Rolling-24h matches the label
 * users see and stays accurate across the date boundary.
 */
export function isToolCreatedToday(
  createdAtIso: string | undefined | null,
  now: Date = new Date(),
): boolean {
  if (!createdAtIso?.trim()) return false;
  const t = Date.parse(createdAtIso);
  if (Number.isNaN(t)) return false;
  const ageMs = now.getTime() - t;
  return ageMs >= 0 && ageMs < TWENTY_FOUR_HOURS_MS;
}

export function countToolsAddedToday<T extends { createdAt: string }>(
  tools: T[],
  now: Date = new Date(),
): number {
  return tools.filter((t) => isToolCreatedToday(t.createdAt, now)).length;
}
