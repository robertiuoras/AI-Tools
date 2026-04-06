/** Calendar day match in local timezone (for “new today” badges). */
export function isToolCreatedToday(
  createdAt: string | null | undefined,
): boolean {
  if (createdAt == null || typeof createdAt !== 'string') return false
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}
