/** True if the tool was created within the last 24 hours (rolling window). */
export function isToolCreatedToday(
  createdAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (createdAt == null || typeof createdAt !== 'string') return false
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return false
  const ageMs = now.getTime() - t
  return ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000
}
