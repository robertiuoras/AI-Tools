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

/** True if the tool’s createdAt falls on today’s local calendar date. */
export function isToolCreatedToday(
  createdAtIso: string | undefined | null,
  now: Date = new Date(),
): boolean {
  if (!createdAtIso?.trim()) return false;
  return localDateKeyFromCreatedAt(createdAtIso) === getLocalDateKey(now);
}

export function countToolsAddedToday<T extends { createdAt: string }>(
  tools: T[],
): number {
  return tools.filter((t) => isToolCreatedToday(t.createdAt)).length;
}
