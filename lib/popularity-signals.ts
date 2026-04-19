/**
 * Honest popularity signals for AI tools.
 *
 * Replaces the GPT-hallucinated "~7.5M/mo" number that the analyze route used
 * to write into `estimatedVisits`. The model was reading scraped marketing
 * copy and inventing a precise traffic figure — which is exactly the failure
 * mode third-party reviewers call out about Toolify.ai's mystery numbers.
 *
 * What we do instead (all from FREE, no-API-key sources unless noted):
 *
 *  - **Tranco rank** — research-grade composite of Cisco Umbrella, Cloudflare
 *    Radar, Majestic, etc. Domain → rank in top 1M, no auth required.
 *    Endpoint: `https://tranco-list.eu/api/ranks/domain/{domain}`
 *  - **GitHub stars** — when the tool's HTML mentions a `github.com/owner/repo`
 *    URL we fetch `GET /repos/{owner}/{repo}` (5,000 req/h with PAT, 60/h
 *    unauth — we cache aggressively and ship a PAT in production).
 *  - **Wayback first snapshot** — `web.archive.org/cdx/search/cdx` gives us
 *    the first time a domain was archived; a strong domain-age proxy that
 *    works even when RDAP returns blank for newer TLDs (.ai, .io).
 *  - **RDAP** — `rdap.org/domain/{domain}` returns the registrar's
 *    `events[].eventDate` for `registration`. Faster than Wayback when it has
 *    data; we use it as the primary domain-age source and Wayback as the
 *    fallback.
 *  - **Wikipedia** — REST `summary` to detect the tool has its own article,
 *    plus 90-day pageviews via `metrics/pageviews/per-article`. A strong
 *    "household name" signal but only ~5-10% of AI tools clear that bar.
 *  - **On-page hard claims** — regex over the existing scraped HTML/text for
 *    phrases like "trusted by 50,000 teams" or "2M+ users". Tagged as
 *    `claimed_*` (not verified) in the stored signals so the UI can label
 *    them as self-reported.
 *
 * Every fetch has a tight per-call timeout and is wrapped in `Promise.allSettled`
 * so one slow source never holds up the analyze pipeline. All raw signals are
 * persisted on the tool row as JSONB so we can re-tune the score weights
 * without re-fetching every domain.
 *
 * The composite 0-100 score and tier mapping live in `computePopularity()`.
 * The display layer (`ToolCard.tsx`) never reads the score directly; it
 * renders the tier badge plus 2-3 evidence chips drawn from the signals.
 */

const RDAP_TIMEOUT_MS = 4_000
const WAYBACK_TIMEOUT_MS = 5_000
const WIKI_TIMEOUT_MS = 4_000
const TRANCO_TIMEOUT_MS = 4_000
const GITHUB_TIMEOUT_MS = 5_000

const COMMON_USER_AGENT =
  // Wikipedia REST asks for a descriptive UA so they can contact us if a
  // pattern is hammering them; everyone else is happy with a normal browser
  // UA. We use one string for all calls for simplicity.
  'AI-Tools-Directory/1.0 (popularity-signals; +https://ai-tools-zeta-rouge.vercel.app)'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PopularityTier = 'major' | 'established' | 'emerging' | 'niche'

export interface HardClaim {
  /** Number that appeared on the page (`50000` for "50,000 teams"). */
  count: number
  /** Lowercased subject ("teams", "users", "customers"…). */
  subject: string
  /** Snippet of source text for transparency. */
  context: string
}

export interface PopularitySignals {
  /** Domain we resolved against. */
  hostname: string
  /** Tranco rank (1 = #1 globally; null if outside top 1M). */
  trancoRank: number | null
  /** Best estimate of domain age in years (null if unknown). */
  domainAgeYears: number | null
  /** ISO date of first Wayback snapshot, when available. */
  domainFirstSeen: string | null
  /** Detected GitHub repo URL like `https://github.com/remotion-dev/remotion`. */
  githubRepo: string | null
  /** Star count of `githubRepo` if successfully fetched. */
  githubStars: number | null
  /** Wikipedia article title that matched the tool name (en wiki). */
  wikipediaPageTitle: string | null
  /** Sum of last-90-day pageviews for that article, when available. */
  wikipediaPageviews90d: number | null
  /** Hard-numeric claims extracted from the page (self-reported). */
  hardClaims: HardClaim[]
  /** Score 0..100. */
  score: number
  /** Mapped tier from score. */
  tier: PopularityTier
  /** Per-source error log so admins can debug. */
  errors: Record<string, string>
  /** Timestamp this snapshot was computed (ISO). */
  computedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetchers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tranco rank for a registered domain. The public API returns the latest
 * 30 days of ranks; we use the most recent positive value.
 *
 * Endpoint: `GET https://tranco-list.eu/api/ranks/domain/{domain}` →
 * `{ ranks: [{ rank: 4231, date: "2026-04-18" }, ...] }`
 *
 * Returns null when the domain is outside the top 1M (Tranco's max rank).
 */
export async function fetchTrancoRank(hostname: string): Promise<number | null> {
  const cleaned = hostname.replace(/^www\./i, '').toLowerCase()
  try {
    const r = await fetch(
      `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(cleaned)}`,
      {
        headers: { 'User-Agent': COMMON_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(TRANCO_TIMEOUT_MS),
      },
    )
    if (!r.ok) return null
    const data = (await r.json()) as { ranks?: Array<{ rank?: unknown }> }
    const ranks = Array.isArray(data?.ranks) ? data.ranks : []
    for (const entry of ranks) {
      const rank = typeof entry?.rank === 'number' ? entry.rank : Number(entry?.rank)
      if (Number.isFinite(rank) && rank > 0) return Math.round(rank)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Domain registration date via RDAP (free, JSON, no auth). Returns the ISO
 * date string of the registration event, or null when the registrar is
 * uncooperative (common for some ccTLDs like `.ai`).
 */
export async function fetchRdapRegistrationDate(hostname: string): Promise<string | null> {
  const cleaned = hostname.replace(/^www\./i, '').toLowerCase()
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(cleaned)}`, {
      headers: { Accept: 'application/rdap+json', 'User-Agent': COMMON_USER_AGENT },
      signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
      redirect: 'follow',
    })
    if (!r.ok) return null
    const data = (await r.json()) as { events?: Array<{ eventAction?: string; eventDate?: string }> }
    const events = Array.isArray(data?.events) ? data.events : []
    for (const e of events) {
      if (typeof e?.eventAction === 'string' && /registration/i.test(e.eventAction) && typeof e.eventDate === 'string') {
        return e.eventDate
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * First Wayback Machine snapshot timestamp for a domain (ISO date string).
 * We use this as a fallback domain-age signal when RDAP returns nothing.
 *
 * CDX endpoint:
 * `https://web.archive.org/cdx/search/cdx?url={domain}&limit=1&output=json&filter=statuscode:200&from=19960101`
 */
export async function fetchWaybackFirstSeen(hostname: string): Promise<string | null> {
  const cleaned = hostname.replace(/^www\./i, '').toLowerCase()
  try {
    const url =
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(cleaned)}` +
      `&limit=1&output=json&filter=statuscode:200&from=19960101`
    const r = await fetch(url, {
      headers: { 'User-Agent': COMMON_USER_AGENT },
      signal: AbortSignal.timeout(WAYBACK_TIMEOUT_MS),
    })
    if (!r.ok) return null
    const rows = (await r.json()) as Array<Array<string>>
    // First row is the header. Second row (when present) holds the data.
    if (!Array.isArray(rows) || rows.length < 2) return null
    const dataRow = rows[1]
    const stamp = dataRow?.[1] // CDX yyyymmddhhmmss
    if (typeof stamp !== 'string' || stamp.length < 8) return null
    const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`
    // Sanity check (Date constructor accepts almost anything).
    return Number.isNaN(new Date(iso).getTime()) ? null : iso
  } catch {
    return null
  }
}

interface WikipediaResult {
  pageTitle: string | null
  pageviews90d: number | null
}

/**
 * Wikipedia summary check + 90-day pageviews. We only count it as a hit when
 * the summary's `type` is `standard` (rules out disambiguation pages and
 * redirect mismatches).
 */
export async function fetchWikipediaSignal(toolName: string): Promise<WikipediaResult> {
  const trimmed = toolName?.trim()
  if (!trimmed) return { pageTitle: null, pageviews90d: null }
  // Wikipedia URL-encodes spaces as underscores in path segments.
  const slug = encodeURIComponent(trimmed.replace(/\s+/g, '_'))
  try {
    const summaryR = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}?redirect=true`,
      {
        headers: { 'User-Agent': COMMON_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
      },
    )
    if (!summaryR.ok) return { pageTitle: null, pageviews90d: null }
    const summary = (await summaryR.json()) as { type?: string; titles?: { canonical?: string } }
    if (summary?.type !== 'standard') return { pageTitle: null, pageviews90d: null }
    const canonical = summary?.titles?.canonical
    if (!canonical || typeof canonical !== 'string') return { pageTitle: null, pageviews90d: null }

    // 90-day pageviews window. Pageviews API needs YYYYMMDD inclusive.
    const today = new Date()
    const start = new Date(today)
    start.setUTCDate(today.getUTCDate() - 90)
    const fmt = (d: Date) =>
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
        d.getUTCDate(),
      ).padStart(2, '0')}`
    const pvR = await fetch(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(
        canonical,
      )}/daily/${fmt(start)}/${fmt(today)}`,
      {
        headers: { 'User-Agent': COMMON_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
      },
    )
    let pv90: number | null = null
    if (pvR.ok) {
      const pvData = (await pvR.json()) as { items?: Array<{ views?: number }> }
      const sum =
        pvData?.items?.reduce<number>((acc, item) => acc + (Number(item?.views) || 0), 0) ?? null
      if (sum != null && Number.isFinite(sum)) pv90 = Math.round(sum)
    }
    return { pageTitle: canonical, pageviews90d: pv90 }
  } catch {
    return { pageTitle: null, pageviews90d: null }
  }
}

/**
 * Find the **first** `github.com/owner/repo` link in the page HTML. Filters
 * out org pages, gist URLs, and obvious noise (.git suffix, query strings).
 */
export function detectGithubRepoFromHtml(html: string): string | null {
  if (!html) return null
  // Match raw HTML hrefs and bare URLs; require owner + repo (two segments).
  const re = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:[\/\s"'#?][^\s"'<>]*)?/gi
  const seen = new Set<string>()
  for (const match of html.matchAll(re)) {
    const owner = match[1]
    const repoRaw = match[2]
    if (!owner || !repoRaw) continue
    const repo = repoRaw.replace(/\.git$/, '')
    if (!repo) continue
    // Drop common non-repo paths.
    if (/^(?:about|features|pricing|enterprise|sponsors|topics|trending|marketplace|orgs|settings|notifications|issues|pulls|search|new|login|join|signup|customer-stories|security|site|robots\.txt|favicon\.ico|apple-touch-icon)$/i.test(repo)) continue
    const candidate = `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`
    if (seen.has(candidate)) continue
    seen.add(candidate)
    return `https://github.com/${owner}/${repo}`
  }
  return null
}

/**
 * Fetch GitHub repo metadata (stars, etc). Uses an unauthenticated request by
 * default — set `GITHUB_TOKEN` in the env to lift the rate limit from 60/h to
 * 5,000/h on production.
 */
export async function fetchGithubStars(repoUrl: string): Promise<number | null> {
  try {
    const u = new URL(repoUrl)
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts.length < 2) return null
    const [owner, repo] = parts
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': COMMON_USER_AGENT,
    }
    const token = process.env.GITHUB_TOKEN
    if (token) headers.Authorization = `Bearer ${token}`
    const r = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo.replace(/\.git$/, ''))}`,
      { headers, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) },
    )
    if (!r.ok) return null
    const data = (await r.json()) as { stargazers_count?: unknown }
    const stars = Number(data?.stargazers_count)
    return Number.isFinite(stars) && stars >= 0 ? Math.round(stars) : null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// On-page hard claims
// ─────────────────────────────────────────────────────────────────────────────

const CLAIM_SUBJECTS = [
  'users',
  'developers',
  'designers',
  'creators',
  'teams',
  'companies',
  'organizations',
  'organisations',
  'businesses',
  'customers',
  'people',
  'professionals',
  'students',
  'subscribers',
  'downloads',
  'installs',
] as const

/**
 * Pulls phrases like "trusted by 50,000 teams", "2M+ users", "over 100k
 * customers" out of the scraped page text. We don't try to verify them — the
 * UI labels them as self-reported claims.
 */
export function extractHardClaims(pageText: string): HardClaim[] {
  if (!pageText) return []
  const text = pageText.toLowerCase()
  const subjectGroup = CLAIM_SUBJECTS.join('|')
  // (number with k/m/b suffix or comma grouping) + optional "+" + subject
  const re = new RegExp(
    `(?:over|more than|trusted by|join|used by|loved by|powering)?\\s*([0-9][0-9,.]*)\\s*([kmb])?\\s*\\+?\\s*(?:million|m\\b|thousand|k\\b)?\\s*(${subjectGroup})\\b`,
    'gi',
  )
  const out: HardClaim[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(re)) {
    const numRaw = m[1]
    const suffix = m[2]
    const subject = m[3]
    if (!numRaw || !subject) continue
    let n = parseFloat(numRaw.replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0) continue
    const unit = (suffix || '').toLowerCase()
    if (unit === 'k') n *= 1_000
    else if (unit === 'm') n *= 1_000_000
    else if (unit === 'b') n *= 1_000_000_000
    // The regex also matches "million"/"thousand" tokens via the optional
    // group; honour them when present in the matched fragment.
    const fragment = m[0].toLowerCase()
    if (/million\b|\bm\b/i.test(fragment) && unit !== 'm' && n < 1_000_000) n *= 1_000_000
    else if (/thousand\b|\bk\b/i.test(fragment) && unit !== 'k' && n < 1_000) n *= 1_000
    if (n < 100) continue // Filter "5 teams" noise.
    const key = `${Math.round(n)}-${subject}`
    if (seen.has(key)) continue
    seen.add(key)
    const start = Math.max(0, (m.index ?? 0) - 24)
    const end = Math.min(text.length, (m.index ?? 0) + (m[0]?.length ?? 0) + 12)
    out.push({
      count: Math.round(n),
      subject,
      context: pageText.slice(start, end).trim(),
    })
    if (out.length >= 5) break
  }
  // Order by impressiveness — biggest claim first.
  out.sort((a, b) => b.count - a.count)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Score composition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Composite 0-100 score from the gathered signals. Weights mirror the research
 * recommendation:
 *
 *  - 40 pts: Tranco rank (log-scaled within top 1M)
 *  - 15 pts: Domain age in years (capped at 10 → linear)
 *  - 15 pts: Wikipedia article + 90-day pageviews (log-scaled)
 *  - 10 pts: GitHub stars (log10, capped)
 *  - 10 pts: On-page hard claims (log10, capped — labelled as self-reported)
 *  - 10 pts: Manual-override room (admin can clamp the tier)
 *
 * If a signal is missing, its weight does **not** redistribute — the score
 * just doesn't earn those points. A Niche tool with only "domain age 1.2yr"
 * scores low and earns the Niche badge, which is the honest answer.
 */
function scoreFromSignals(
  s: Pick<
    PopularitySignals,
    'trancoRank' | 'domainAgeYears' | 'wikipediaPageviews90d' | 'wikipediaPageTitle' | 'githubStars' | 'hardClaims'
  >,
): number {
  let total = 0

  if (s.trancoRank != null && s.trancoRank > 0) {
    // Map rank → 0-40 logarithmically. Top 100 ≈ 40 pts, 100k ≈ 14 pts, 1M ≈ 0.
    const rankNorm = 1 - Math.log10(s.trancoRank) / 6 // log10(1M) = 6
    total += Math.max(0, Math.min(40, rankNorm * 40))
  }

  if (s.domainAgeYears != null && s.domainAgeYears > 0) {
    total += Math.min(15, (s.domainAgeYears / 10) * 15)
  }

  if (s.wikipediaPageTitle) {
    total += 5 // Existence alone is meaningful — Wikipedia notability bar is high.
    if (s.wikipediaPageviews90d != null && s.wikipediaPageviews90d > 0) {
      total += Math.min(10, (Math.log10(s.wikipediaPageviews90d + 1) / 6) * 10)
    }
  }

  if (s.githubStars != null && s.githubStars > 0) {
    // 1k stars ≈ 5pts, 10k ≈ 6.7pts, 100k ≈ 8.3pts.
    total += Math.min(10, (Math.log10(s.githubStars + 1) / 6) * 10)
  }

  if (s.hardClaims && s.hardClaims.length > 0) {
    const biggest = s.hardClaims[0].count
    total += Math.min(10, (Math.log10(biggest + 1) / 8) * 10)
  }

  return Math.max(0, Math.min(100, Math.round(total)))
}

export function tierFromScore(score: number): PopularityTier {
  if (score >= 70) return 'major'
  if (score >= 45) return 'established'
  if (score >= 20) return 'emerging'
  return 'niche'
}

export function tierLabel(tier: PopularityTier): string {
  switch (tier) {
    case 'major':
      return 'Major'
    case 'established':
      return 'Established'
    case 'emerging':
      return 'Emerging'
    case 'niche':
      return 'Niche'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute popularity for one tool. Runs all probes in parallel and never
 * throws — failures land in the `errors` map for the admin UI to surface.
 */
export async function computePopularity(input: {
  url: string
  toolName: string
  pageHtml?: string
  pageText?: string
}): Promise<PopularitySignals> {
  let urlObj: URL
  try {
    urlObj = new URL(input.url)
  } catch {
    return emptySignals('invalid-url')
  }
  const hostname = urlObj.hostname.replace(/^www\./i, '').toLowerCase()
  const errors: Record<string, string> = {}

  const repoFromHtml = input.pageHtml ? detectGithubRepoFromHtml(input.pageHtml) : null

  const wrap = async <T,>(label: string, p: Promise<T>): Promise<T | null> => {
    try {
      return await p
    } catch (e) {
      errors[label] = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  const [tranco, rdapDate, waybackDate, wiki, ghStars] = await Promise.all([
    wrap('tranco', fetchTrancoRank(hostname)),
    wrap('rdap', fetchRdapRegistrationDate(hostname)),
    wrap('wayback', fetchWaybackFirstSeen(hostname)),
    wrap('wikipedia', fetchWikipediaSignal(input.toolName)),
    repoFromHtml ? wrap('github', fetchGithubStars(repoFromHtml)) : Promise.resolve(null),
  ])

  const earliest = (() => {
    const candidates = [rdapDate, waybackDate].filter((x): x is string => !!x)
    if (candidates.length === 0) return null
    const ts = candidates.map((c) => new Date(c).getTime()).filter((n) => Number.isFinite(n))
    if (ts.length === 0) return null
    return new Date(Math.min(...ts)).toISOString().slice(0, 10)
  })()

  const ageYears =
    earliest != null
      ? Math.round(((Date.now() - new Date(earliest).getTime()) / 31_557_600_000) * 100) / 100
      : null

  const hardClaims = extractHardClaims(input.pageText ?? '')

  const wikiResult = wiki ?? { pageTitle: null, pageviews90d: null }

  const partial = {
    trancoRank: tranco ?? null,
    domainAgeYears: ageYears,
    wikipediaPageTitle: wikiResult.pageTitle,
    wikipediaPageviews90d: wikiResult.pageviews90d,
    githubStars: ghStars ?? null,
    hardClaims,
  }

  const score = scoreFromSignals(partial)
  return {
    hostname,
    trancoRank: partial.trancoRank,
    domainAgeYears: partial.domainAgeYears,
    domainFirstSeen: earliest,
    githubRepo: repoFromHtml,
    githubStars: partial.githubStars,
    wikipediaPageTitle: partial.wikipediaPageTitle,
    wikipediaPageviews90d: partial.wikipediaPageviews90d,
    hardClaims: partial.hardClaims,
    score,
    tier: tierFromScore(score),
    errors,
    computedAt: new Date().toISOString(),
  }
}

function emptySignals(reason: string): PopularitySignals {
  return {
    hostname: '',
    trancoRank: null,
    domainAgeYears: null,
    domainFirstSeen: null,
    githubRepo: null,
    githubStars: null,
    wikipediaPageTitle: null,
    wikipediaPageviews90d: null,
    hardClaims: [],
    score: 0,
    tier: 'niche',
    errors: { input: reason },
    computedAt: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers — used by ToolCard.tsx and the admin "evidence" popover
// ─────────────────────────────────────────────────────────────────────────────

/** Tailwind-ready badge classes per tier (kept here so server + client agree). */
export function tierBadgeClassName(tier: PopularityTier): string {
  switch (tier) {
    case 'major':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'established':
      return 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300'
    case 'emerging':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'niche':
      return 'border-zinc-400/40 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300'
  }
}

/** "12.4k", "1.2M", "850" — used for stars, pageviews, and hard-claim chips. */
export function compactNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

/** "#4,231" — for Tranco rank chips. */
export function formatRank(rank: number | null | undefined): string {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) return ''
  return `#${rank.toLocaleString('en-US')}`
}

/**
 * Build the small array of evidence chips the card renders next to the tier
 * badge. We cap at 3 chips to keep the card compact and prefer the strongest
 * signals first (Tranco > GitHub > age > Wikipedia > hard claims).
 */
export interface EvidenceChip {
  label: string
  /** Long-form tooltip text. */
  title: string
}

export function buildEvidenceChips(signals: Partial<PopularitySignals> | null | undefined): EvidenceChip[] {
  if (!signals) return []
  const chips: EvidenceChip[] = []
  if (signals.trancoRank != null && signals.trancoRank > 0) {
    chips.push({
      label: `Tranco ${formatRank(signals.trancoRank)}`,
      title:
        'Global website rank from the Tranco research list (combines Cisco Umbrella, Cloudflare Radar, Majestic, Farsight). Lower is more popular.',
    })
  }
  if (signals.githubStars != null && signals.githubStars >= 100) {
    chips.push({
      label: `${compactNumber(signals.githubStars)}★ GitHub`,
      title: signals.githubRepo
        ? `Live star count of ${signals.githubRepo}.`
        : 'Live GitHub star count.',
    })
  }
  if (signals.domainAgeYears != null && signals.domainAgeYears >= 0.5) {
    const yrs =
      signals.domainAgeYears >= 1
        ? `${Math.round(signals.domainAgeYears)}y old`
        : `${Math.round(signals.domainAgeYears * 12)}mo old`
    chips.push({
      label: yrs,
      title: signals.domainFirstSeen
        ? `Domain first observed ${signals.domainFirstSeen} (RDAP / Wayback Machine).`
        : 'Domain age from RDAP and the Wayback Machine.',
    })
  }
  if (chips.length < 3 && signals.wikipediaPageTitle) {
    chips.push({
      label: signals.wikipediaPageviews90d != null && signals.wikipediaPageviews90d > 0
        ? `${compactNumber(signals.wikipediaPageviews90d)} wiki views/90d`
        : 'On Wikipedia',
      title: `English Wikipedia article: "${signals.wikipediaPageTitle}".`,
    })
  }
  if (chips.length < 3 && signals.hardClaims && signals.hardClaims.length > 0) {
    const top = signals.hardClaims[0]
    chips.push({
      label: `${compactNumber(top.count)}+ ${top.subject} (claimed)`,
      title: `Self-reported on the tool's site: "${top.context}". Not independently verified.`,
    })
  }
  return chips.slice(0, 3)
}
