import {
  finalizeToolCategoriesList,
  normalizeToolCategory,
} from '@/lib/schemas'

/**
 * Map /api/tools/analyze JSON body to /api/tools POST payload (same fields as admin Quick Add).
 */
export function buildToolPayloadFromAnalyzeResponse(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const name = String(data.name || '').trim()
  const description = String(data.description || '').trim()
  const url = String(data.url || '').trim()
  const categories =
    Array.isArray(data.categories) && data.categories.length > 0
      ? finalizeToolCategoriesList(
          data.categories.map((c: unknown) => normalizeToolCategory(String(c))),
        )
      : finalizeToolCategoriesList([
          normalizeToolCategory(String(data.category || 'Other')),
        ])
  if (!name || !description || !url || categories.length === 0) {
    return null
  }
  const payload: Record<string, unknown> = {
    name,
    description,
    url,
    categories,
  }
  if (data.logoUrl && String(data.logoUrl).trim())
    payload.logoUrl = String(data.logoUrl).trim()
  if (data.tags && String(data.tags).trim()) payload.tags = String(data.tags).trim()
  if (data.traffic) payload.traffic = data.traffic
  if (data.revenue) payload.revenue = data.revenue
  if (data.rating !== null && data.rating !== undefined) payload.rating = data.rating
  if (data.estimatedVisits !== null && data.estimatedVisits !== undefined)
    payload.estimatedVisits = data.estimatedVisits
  if (data.isAgency === true) payload.isAgency = true
  if (data.hasDownloadableApp === true) payload.hasDownloadableApp = true
  const pop = data.popularity as Record<string, unknown> | null | undefined
  if (pop && typeof pop === 'object') {
    if (typeof pop.trancoRank === 'number') payload.trancoRank = pop.trancoRank
    if (typeof pop.githubRepo === 'string') payload.githubRepo = pop.githubRepo
    if (typeof pop.githubStars === 'number') payload.githubStars = pop.githubStars
    if (typeof pop.domainAgeYears === 'number') payload.domainAgeYears = pop.domainAgeYears
    if (typeof pop.wikipediaPageTitle === 'string')
      payload.wikipediaPageTitle = pop.wikipediaPageTitle
    if (typeof pop.wikipediaPageviews90d === 'number')
      payload.wikipediaPageviews90d = pop.wikipediaPageviews90d
    if (typeof pop.score === 'number') payload.popularityScore = Math.round(pop.score)
    if (typeof pop.tier === 'string') payload.popularityTier = pop.tier
    payload.popularitySignals = pop
  }
  return payload
}
