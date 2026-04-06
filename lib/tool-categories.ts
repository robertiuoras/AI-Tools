import { AGENCY_CATEGORY_LABEL, normalizeToolCategory, parseVideoCategoriesFromRow } from '@/lib/schemas'

export type ToolCategoryRow = {
  category?: string | null
  categories?: string[] | null
  isAgency?: boolean | null
}

/**
 * Ordered unique categories for a tool (from `categories[]` or legacy `category`).
 */
/** Video rows: 1–3 labels from `categories` JSON or legacy `category`. */
export function videoCategoryList(row: {
  category?: string | null
  categories?: unknown
}): string[] {
  return parseVideoCategoriesFromRow(row)
}

export function toolCategoryList(row: ToolCategoryRow): string[] {
  const raw = row.categories
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of raw) {
      const n = normalizeToolCategory(typeof c === 'string' ? c : String(c))
      if (!seen.has(n)) {
        seen.add(n)
        out.push(n)
      }
    }
    if (out.length > 0) return out
  }
  return [normalizeToolCategory(row.category)]
}

export function toolIsAgency(row: ToolCategoryRow): boolean {
  if (row.isAgency === true) return true
  return toolCategoryList(row).some((c) => c === AGENCY_CATEGORY_LABEL)
}

/** Category badges on cards: agency is shown as a ribbon, not repeated as a chip. */
export function toolCategoryListForBadges(row: ToolCategoryRow): string[] {
  return toolCategoryList(row).filter((c) => c !== AGENCY_CATEGORY_LABEL)
}
