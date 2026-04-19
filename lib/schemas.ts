import { z } from 'zod'

/** AI tool categories (alphabetical). DB stores free text; keep analyze prompt in sync. */
export const categories = [
  'AI Agents',
  'AI Automation',
  'Agencies',
  'Analytics',
  'Code Assistants',
  'Customer Support',
  'Design',
  'Education',
  'Healthcare',
  'Image Generation',
  'Insurance',
  'Job',
  'Language',
  'Legal',
  'Marketing',
  'Music & Audio',
  'News',
  'Other',
  'Productivity',
  'Research',
  'SaaS',
  'Video Editing',
  'Voice & Audio',
  'Writing',
] as const

/** Canonical label for service agencies (DB + AI). On the home page this is a card ribbon, not a category filter. */
export const AGENCY_CATEGORY_LABEL = 'Agencies' as const

export type Category = typeof categories[number]

const categorySet = new Set<string>(categories)

/** Max categories per tool (1–3; primary = first). */
export const MAX_TOOL_CATEGORIES = 3

/** Sort labels for filter UIs: known categories follow `categories` order; unknown/custom tail, A–Z. */
export function sortToolCategoryLabelsForDisplay(labels: string[]): string[] {
  const known = labels.filter((c) => categorySet.has(c))
  const unknown = labels.filter((c) => !categorySet.has(c))
  const sortedKnown = [...known].sort(
    (a, b) =>
      categories.indexOf(a as Category) - categories.indexOf(b as Category),
  )
  const sortedUnknown = [...unknown].sort((a, b) => a.localeCompare(b))
  return [...sortedKnown, ...sortedUnknown]
}

/**
 * Map legacy tool category strings (before list renames) to current `categories` values.
 * Extend as you audit the `tool` table or imports.
 */
export const LEGACY_TOOL_CATEGORY_ALIASES: Record<string, Category> = {
  Video: 'Video Editing',
  Videos: 'Video Editing',
  Editing: 'Video Editing',
  Audio: 'Music & Audio',
  Voice: 'Voice & Audio',
  Images: 'Image Generation',
  Image: 'Image Generation',
  Code: 'Code Assistants',
  // Common DB / import variants → real categories (fewer gray “Other” badges)
  Chat: 'AI Agents',
  Chatbot: 'AI Agents',
  Chatbots: 'AI Agents',
  Agents: 'AI Agents',
  LLM: 'AI Automation',
  LLMs: 'AI Automation',
  Automation: 'AI Automation',
  'Machine Learning': 'Analytics',
  ML: 'Analytics',
  Data: 'Analytics',
  Developer: 'Code Assistants',
  DevTools: 'Code Assistants',
  'Developer Tools': 'Code Assistants',
  Programming: 'Code Assistants',
  CRM: 'Customer Support',
  Support: 'Customer Support',
  Helpdesk: 'Customer Support',
  UX: 'Design',
  UI: 'Design',
  'UI/UX': 'Design',
  Graphics: 'Design',
  Elearning: 'Education',
  'E-learning': 'Education',
  Health: 'Healthcare',
  health: 'Healthcare',
  Healthcare: 'Healthcare',
  healthcare: 'Healthcare',
  Medical: 'Healthcare',
  medical: 'Healthcare',
  Healthtech: 'Healthcare',
  healthtech: 'Healthcare',
  Telehealth: 'Healthcare',
  telehealth: 'Healthcare',
  Clinical: 'Healthcare',
  HIPAA: 'Healthcare',
  Photo: 'Image Generation',
  Art: 'Image Generation',
  Career: 'Job',
  Jobs: 'Job',
  Recruitment: 'Job',
  Translation: 'Language',
  NLP: 'Language',
  Legaltech: 'Legal',
  Insurance: 'Insurance',
  insurance: 'Insurance',
  Insurtech: 'Insurance',
  insurtech: 'Insurance',
  Brokerage: 'Insurance',
  brokerage: 'Insurance',
  Underwriting: 'Insurance',
  Ads: 'Marketing',
  SEO: 'Marketing',
  Social: 'Marketing',
  /** Service businesses / shops — not the same as productized “Marketing” SaaS */
  Agency: 'Agencies',
  agency: 'Agencies',
  Agencies: 'Agencies',
  'Marketing Agency': 'Agencies',
  'Digital Agency': 'Agencies',
  'Creative Agency': 'Agencies',
  'Advertising Agency': 'Agencies',
  'Ad Agency': 'Agencies',
  'digital agency': 'Agencies',
  'marketing agency': 'Agencies',
  'creative agency': 'Agencies',
  'advertising agency': 'Agencies',
  'design agency': 'Agencies',
  'growth agency': 'Agencies',
  'media agency': 'Agencies',
  'brand agency': 'Agencies',
  'PR Agency': 'Agencies',
  'pr agency': 'Agencies',
  'Web Agency': 'Agencies',
  'web agency': 'Agencies',
  'Dev Agency': 'Agencies',
  'dev agency': 'Agencies',
  Music: 'Music & Audio',
  Sound: 'Music & Audio',
  Podcast: 'Music & Audio',
  /** Newsletters, digests, and aggregators — prefer over Research for “daily news” products */
  Newsletter: 'News',
  News: 'News',
  Media: 'News',
  Journalism: 'News',
  Aggregator: 'News',
  RSS: 'News',
  Digest: 'News',
  newsletter: 'News',
  media: 'News',
  journalism: 'News',
  aggregator: 'News',
  /** Generic “search” still maps to Research; use News for news-focused products via prompt + aliases */
  Search: 'Research',
  Cloud: 'SaaS',
  B2B: 'SaaS',
  Business: 'SaaS',
  Transcription: 'Voice & Audio',
  Speech: 'Voice & Audio',
  Blog: 'Writing',
  Copywriting: 'Writing',
  Content: 'Writing',
  General: 'Productivity',
  Tools: 'Productivity',
  Misc: 'Other',
  Miscellaneous: 'Other',
}

/** Levenshtein distance (small inputs only — category labels are short). */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  )
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      )
    }
  }
  return dp[m]![n]!
}

/**
 * If the model/user string is close to a canonical label, return that label
 * (reduces duplicate near-synonyms without exploding category count).
 */
export function closestCanonicalCategory(raw: string): string | null {
  const norm = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (!norm) return null

  for (const c of categories) {
    const cl = c.toLowerCase()
    if (norm === cl) return c
  }

  // All significant words from a canonical label appear as whole words in the raw string
  for (const c of categories) {
    const words = c
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
    if (words.length === 0) continue
    if (
      words.every((w) => {
        const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`\\b${esc}\\b`, 'i').test(norm)
      })
    ) {
      return c
    }
  }

  // Typo / near-match (e.g. "Producivity" → Productivity)
  let best: string | null = null
  let bestRatio = 1
  for (const c of categories) {
    const cl = c.toLowerCase()
    const maxLen = Math.max(norm.length, cl.length)
    if (maxLen < 3) continue
    const d = levenshtein(norm, cl)
    const ratio = d / maxLen
    if (ratio < bestRatio && ratio <= 0.34) {
      bestRatio = ratio
      best = c
    }
  }
  return best
}

/** Normalize free-text label to Title Case; reject junk. Returns null if unusable. */
export function sanitizeCustomCategoryLabel(raw: string): string | null {
  let s = raw.trim().replace(/\s+/g, ' ')
  if (s.length < 2 || s.length > 48) return null
  if (/[|<>{}[\]\\]/.test(s)) return null
  s = s
    .split(/\s+/)
    .map((w) => {
      if (!w) return w
      if (/^[&]+$/.test(w)) return w
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
  if (s.length < 2) return null
  return s
}

function canonicalCaseIfMatches(s: string): string {
  for (const c of categories) {
    if (c.toLowerCase() === s.toLowerCase()) return c
  }
  return s
}

/**
 * Vertical B2B / insurtech product language. Alone it blocks adding "Agencies" via corpus
 * augmentation — unless implementation- or marketing-agency signals also match.
 */
export const CORPUS_VERTICAL_B2B_BLOCKS_AGENCIES =
  /\b(insurtech|insurance tech|for insurers?|for brokers?|for brokerages?|insurance brokers?|insurance brokerages?|brokerage software|claims software|underwriting software|policy admin|sold to (insurers?|brokers?))\b/i

/**
 * First-party copy that the **vendor is** a marketing/creative services agency,
 * a consultancy, or a contract-delivery firm. Intentionally narrow — phrases
 * like “marketing agency” in testimonials or “for agencies” ICP copy must not
 * match. Patterns are anchored to first-person voice (we are / our / hire us)
 * so blog mentions of an agency don't flip the flag.
 */
export const CORPUS_VENDOR_IS_SERVICES_AGENCY = new RegExp(
  [
    String.raw`\bwe\s+'?re\s+(a\s+)?(digital|creative|marketing|advertising|design|brand|full[- ]service|growth|content|seo|web|product|consulting|consultancy|software\s+development|ai\s+development|engineering|implementation)\s+(agenc(y|ies)|firm|studio|consultancy|consulting\s+firm|partner)\b`,
    String.raw`\bwe\s+are\s+(a\s+)?(digital|creative|marketing|advertising|design|brand|full[- ]service|growth|content|seo|web|product|consulting|consultancy|software\s+development|ai\s+development|engineering|implementation)\s+(agenc(y|ies)|firm|studio|consultancy|consulting\s+firm|partner)\b`,
    String.raw`\bour\s+(digital|creative|marketing|advertising|design|growth|content|consulting)\s+(agenc(y|ies)|firm|studio|practice)\b`,
    String.raw`\b(full[- ]service|boutique|specialist)\s+(agenc(y|ies)|firm|studio|consultancy)\b`,
    String.raw`\bagency\s+(specializing|focused|based)\s+in\b`,
    String.raw`\b(hire|work\s+with|engage)\s+(our\s+team|us)\b`,
    String.raw`\b(scope\s+of\s+work|statement\s+of\s+work|sow)\b.{0,40}\b(deliverables?|engagement|client)\b`,
    String.raw`\bproject[- ]based\s+(engagement|pricing|delivery)\b`,
    String.raw`\bretainer\s+(engagement|client|model|pricing)\b`,
    String.raw`\bclient\s+engagements?\b`,
    String.raw`\bdone[- ]for[- ]you\b`,
    String.raw`\bcase\s+studies\b.{0,200}\b(roi|results?\s+for\s+clients?|client\s+results?)\b`,
    String.raw`\bwe\s+(help|helped)\s+(brands?|companies|teams?|clients?|businesses)\s+(build|launch|grow|scale|design|automate|implement)\b`,
    String.raw`\bworking\s+with\s+us\b.{0,40}\b(process|engagement|onboarding)\b`,
    String.raw`\bget\s+a\s+(custom\s+)?(quote|proposal|estimate)\b`,
  ].join('|'),
  'i',
)

/**
 * Self-serve software / SaaS product signals. Sites like page builders match here; do not infer Agencies from weak CTAs alone.
 */
export const CORPUS_SELF_SERVE_SOFTWARE_PRODUCT = new RegExp(
  [
    String.raw`\b(create\s+your\s+)?free\s+account\b`,
    String.raw`\bno\s+credit\s+card\b`,
    String.raw`\bfree\s+to\s+use\b`,
    String.raw`\bit'?s\s+not\s+a\s+trial\b`,
    String.raw`\bwebsite[- ]building\s+(tool|software)\b`,
    String.raw`\bpage\s+building\s+software\b`,
    String.raw`\bpage[- ]building\s+software\b`,
    String.raw`\blanding\s+page\s+(builder|software|tool)\b`,
    String.raw`\bdrag[- ]and[- ]drop\b`,
    String.raw`\bwordpress\s+alternative\b`,
    String.raw`\ball[- ]in[- ]one\s+(builder|platform|software|tool)\b`,
    String.raw`\b(builder|editor)\s+instantly\s+responds\b`,
    String.raw`\bsoftware\s+that\s+helps\s+you\s+build\b`,
    String.raw`\bsaas\b`,
    String.raw`\bcloud[- ]based\s+software\b`,
  ].join('|'),
  'i',
)

/**
 * Typical app chrome: log in + sign up. Alone it matches many brochure sites, so pair with {@link CORPUS_SAAS_PRODUCT_CORROBORATION}.
 */
export const CORPUS_SAAS_AUTH_NAV = new RegExp(
  [
    String.raw`\blog\s+in\b`,
    String.raw`\blogin\b`,
    String.raw`\bsign\s+in\b`,
    String.raw`\bsign\s+up\b`,
    String.raw`\bregister\b`,
    String.raw`\bcreate\s+an?\s+account\b`,
  ].join('|'),
  'i',
)

/**
 * Second signal that the product is software (not just a marketing page with a lone “Sign up” for email).
 */
export const CORPUS_SAAS_PRODUCT_CORROBORATION = new RegExp(
  [
    String.raw`\b(api\s+keys?|rest\s+api|graphql|webhooks?|openapi|sdk)\b`,
    String.raw`\bfree\s+tier\b`,
    String.raw`\b(pro|business|enterprise|starter)\s+plan\b`,
    String.raw`\bper\s+(seat|user|member|month)\b`,
    String.raw`\bmonthly\s+billing\b`,
    String.raw`\bsubscription\b`,
    String.raw`\bzapier\b`,
    String.raw`\bintegrations?\s+(page|gallery|directory)\b`,
    String.raw`\bchangelog\b`,
    String.raw`\broadmap\b`,
    String.raw`\bworkspace\b`,
    String.raw`\bteam\s+members?\b`,
    String.raw`\bmulti[- ]tenant\b`,
    String.raw`\bssl\s+certificate\b`,
    String.raw`\bconnect\s+your\s+domain\b`,
  ].join('|'),
  'i',
)

/** Newsletter / lead magnet — if this dominates, do not treat “sign up” as SaaS auth. */
export const CORPUS_NEWSLETTER_SIGNUP_ONLY = new RegExp(
  String.raw`\bsign\s+up\s+for\s+(our\s+|the\s+)?(newsletter|email\s+updates?|weekly\s+digest)\b`,
  'i',
)

/**
 * Strong self-serve product copy **or** log in / sign up **plus** verification (technical/product surface **or** dual auth + pricing).
 * Auth nav alone is ignored (brochure + newsletter CTAs); “sign up for newsletter” without **Log in** does not count.
 */
export function corpusMatchesSelfServeSoftwareSignals(corpus: string): boolean {
  if (!corpus?.trim()) return false
  if (CORPUS_SELF_SERVE_SOFTWARE_PRODUCT.test(corpus)) return true
  if (!CORPUS_SAAS_AUTH_NAV.test(corpus)) return false

  const hasLoginSurface = /\b(log\s+in|login|sign\s+in)\b/i.test(corpus)
  const hasSignUpSurface = /\bsign\s+up\b/i.test(corpus)
  const dualAuthChrome = hasLoginSurface && hasSignUpSurface
  const pricingSurface = /\b(pricing|\/pricing|choose\s+(a\s+)?plan)\b/i.test(
    corpus,
  )

  const corroborated =
    CORPUS_SAAS_PRODUCT_CORROBORATION.test(corpus) ||
    (dualAuthChrome && pricingSurface)

  if (!corroborated) return false

  if (CORPUS_NEWSLETTER_SIGNUP_ONLY.test(corpus) && !hasLoginSurface) {
    return false
  }
  return true
}

/**
 * Copy positions **agencies** as customers / ICP (“built for agencies”), not “we are an agency”.
 */
export const CORPUS_AGENCIES_AS_TARGET_CUSTOMER = new RegExp(
  [
    String.raw`\b(built|made|designed)\s+for\s+[^.]{0,160}?\bagencies\b`,
    String.raw`\bfor\s+agencies\s+(&|and)\s+businesses\b`,
    String.raw`\bagencies\s+(&|and)\s+businesses\b`,
    String.raw`\b(secret\s+weapon|perfect\s+for)\s+[^.]{0,80}?\bagencies\b`,
  ].join('|'),
  'i',
)

/**
 * Bespoke implementation / integration delivery (shops that ship custom work into client systems).
 * Excludes generic SaaS CTAs (“book a demo”, “schedule a call”) that match almost every product site.
 */
export const CORPUS_IMPLEMENTATION_BESPOKE_HINT = new RegExp(
  [
    String.raw`\bintegrat(e|ion)\s+with\s+your\s+(existing\s+)?`,
    String.raw`\b(live|go\s+live)\s+in\s+\d+\s*(days?|weeks?|months?)\b`,
    String.raw`\b\d+\s+days?\s+or\s+less\b`,
    String.raw`\b(system|solution)\s+is\s+live\s+in\b`,
    String.raw`\bconfigure(d)?\s+to\s+your\s+(standards?|workflows?|needs?)\b`,
    String.raw`\btemplates?\s+to\s+your\s+standards?\b`,
    String.raw`\bphased\s+(rollout|deployment|launch)\b`,
    String.raw`\b(custom|bespoke)\s+(implementation|build|deployment|integration|solution)\b`,
    String.raw`\bimplementation\s+(partner|services?|team)\b`,
    String.raw`\b(done[- ]for[- ]you|white[- ]glove)\s+(setup|onboarding|implementation)\b`,
    String.raw`\b(free\s+)?diagnostic\b`,
  ].join('|'),
  'i',
)

/** @deprecated Use {@link CORPUS_VENDOR_IS_SERVICES_AGENCY} — old regex matched testimonial “marketing agency” noise. */
export const CORPUS_SERVICES_AGENCY_HINT = CORPUS_VENDOR_IS_SERVICES_AGENCY

/** @deprecated Use {@link CORPUS_IMPLEMENTATION_BESPOKE_HINT} — old regex matched “demo” / “we build” product marketing. */
export const CORPUS_IMPLEMENTATION_SERVICES_HINT = CORPUS_IMPLEMENTATION_BESPOKE_HINT

/** Map free-text / AI labels that clearly mean a services agency → canonical Agencies. */
function inferAgenciesCategory(segment: string): Category | null {
  const n = segment.trim().toLowerCase()
  if (!n) return null
  // Vertical B2B / insurtech — not “Agencies” (marketing shops)
  if (CORPUS_VERTICAL_B2B_BLOCKS_AGENCIES.test(n)) {
    return null
  }
  if (n === 'agency' || n === 'agencies') return 'Agencies'
  if (
    /\b(marketing|digital|creative|advertising|design|brand|growth|media|seo|web|development|dev|content|social|influencer|performance|ppc|paid media|ux|ui)\s+agenc(y|ies)\b/.test(
      n,
    )
  ) {
    return 'Agencies'
  }
  if (
    /\bagenc(y|ies)\b/.test(n) &&
    /\b(studio|consultancy|consulting|consultants?|clients?|retainers?)\b/.test(n)
  ) {
    return 'Agencies'
  }
  // Other “X agency” strings (e.g. PR agency, dev agency) — exclude non–marketing-agency meanings
  if (/\bagenc(y|ies)\b/.test(n)) {
    if (
      /\b(insurance|insurtech|travel|recruitment|talent|employment|staffing|real estate|executive search|news|government|regulatory)\s+agenc/i.test(
        n,
      )
    ) {
      return null
    }
    if (/\b(software|saas|platform|tool|app)\s+for\s+agencies\b/i.test(n)) {
      return null
    }
    return 'Agencies'
  }
  return null
}

/**
 * Collapse bad data (e.g. "Video Editing|AI Automation|SaaS") to one known category.
 * Picks the first segment that matches our category list; otherwise legacy alias or Other.
 */
export function normalizeToolCategory(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== 'string') return 'Other'
  const s = raw.trim()
  if (!s) return 'Other'
  if (categorySet.has(s)) return s
  const parts = s.split('|').map((p) => p.trim()).filter(Boolean)
  for (const p of parts) {
    if (categorySet.has(p)) return p
    const agency = inferAgenciesCategory(p)
    if (agency) return agency
    const pl = p.toLowerCase()
    const legacy = LEGACY_TOOL_CATEGORY_ALIASES[p] ?? LEGACY_TOOL_CATEGORY_ALIASES[pl]
    if (legacy && categorySet.has(legacy)) return legacy
    for (const c of categories) {
      if (c.toLowerCase() === pl) return c
    }
    const fuzzy = closestCanonicalCategory(p)
    if (fuzzy) return fuzzy
  }
  if (parts.length === 1) {
    const p0 = parts[0]
    const custom = sanitizeCustomCategoryLabel(p0)
    if (custom) return canonicalCaseIfMatches(custom)
    return 'Other'
  }
  return 'Other'
}

/**
 * After normalizing AI/user category picks: drop redundant "Other" when specific
 * labels exist; cap at {@link MAX_TOOL_CATEGORIES} (canonical + custom allowed).
 */
export function finalizeToolCategoriesList(normalized: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of normalized) {
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  const withoutOther = out.filter((c) => c !== 'Other')
  const base = withoutOther.length > 0 ? withoutOther : out
  const capped = base.slice(0, MAX_TOOL_CATEGORIES)
  return capped.length > 0 ? capped : ['Other']
}

/**
 * Video AI labels: keep specific custom tags (e.g. Claude, Cursor, Web Design) instead of
 * folding them into broad list labels via {@link closestCanonicalCategory}.
 */
export function normalizeVideoAiCategory(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== 'string') return 'Other'
  const s = raw.trim()
  if (!s) return 'Other'
  if (categorySet.has(s)) return s
  const parts = s.split('|').map((p) => p.trim()).filter(Boolean)
  for (const p of parts) {
    if (categorySet.has(p)) return p
    const pl = p.toLowerCase()
    const legacy =
      LEGACY_TOOL_CATEGORY_ALIASES[p] ?? LEGACY_TOOL_CATEGORY_ALIASES[pl]
    if (legacy && categorySet.has(legacy)) return legacy
    for (const c of categories) {
      if (c.toLowerCase() === pl) return c
    }
    const custom = sanitizeCustomCategoryLabel(p)
    if (custom) return canonicalCaseIfMatches(custom)
  }
  return 'Other'
}

/** Normalize each AI video category and dedupe/cap. */
export function finalizeVideoAiCategories(raw: string[]): string[] {
  const mapped = raw.map((x) => normalizeVideoAiCategory(String(x)))
  return finalizeToolCategoriesList(mapped)
}

/**
 * Agencies use a dedicated `isAgency` flag in the DB — they must not consume a category slot.
 * Call this before persisting: returns up to {@link MAX_TOOL_CATEGORIES} non-agency labels.
 */
export function stripAgencyFromCategoriesForStorage(
  categoriesIn: string[],
): { categories: string[]; isAgency: boolean } {
  const normalized = categoriesIn
    .map((c) => normalizeToolCategory(String(c)))
    .filter(Boolean)
  const finalized = finalizeToolCategoriesList(normalized)
  const isAgency = finalized.includes(AGENCY_CATEGORY_LABEL)
  const rest = finalized.filter((c) => c !== AGENCY_CATEGORY_LABEL)
  const categories = finalizeToolCategoriesList(
    rest.length > 0 ? rest : ['Other'],
  )
  return { categories, isAgency }
}

export function parseOptionalBool(v: unknown): boolean | undefined {
  if (v === true) return true
  if (v === false) return false
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'yes') return true
    if (s === 'false' || s === '0' || s === 'no') return false
  }
  return undefined
}

/**
 * If the page clearly describes a services or implementation firm but the model omitted "Agencies", add it.
 * Does **not** treat “for agencies” ICP copy or “book a demo” SaaS pages as proof the vendor is an agency.
 */
export function augmentCategoriesWithAgencySignals(
  categories: string[],
  corpus: string,
): string[] {
  if (!corpus?.trim() || categories.length === 0) return categories
  if (categories.includes('Agencies')) return categories

  const verticalProduct = CORPUS_VERTICAL_B2B_BLOCKS_AGENCIES.test(corpus)
  const vendorAgency = CORPUS_VENDOR_IS_SERVICES_AGENCY.test(corpus)
  const bespokeImpl = CORPUS_IMPLEMENTATION_BESPOKE_HINT.test(corpus)
  const selfServeProduct = corpusMatchesSelfServeSoftwareSignals(corpus)
  const agenciesAreICP = CORPUS_AGENCIES_AS_TARGET_CUSTOMER.test(corpus)

  if (selfServeProduct && !vendorAgency) {
    return categories
  }

  if (agenciesAreICP && !vendorAgency && !bespokeImpl) {
    return categories
  }

  if (verticalProduct && !bespokeImpl && !vendorAgency) {
    return categories
  }

  if (!vendorAgency && !bespokeImpl) {
    return categories
  }

  return finalizeToolCategoriesList(['Agencies', ...categories])
}

/**
 * When true, force {@code isAgency} false even if the model returned true — e.g. SaaS “for agencies” ICP copy.
 */
export function corpusIndicatesProductVendorNotServicesAgency(
  corpus: string,
): boolean {
  if (!corpus?.trim()) return false
  if (CORPUS_VENDOR_IS_SERVICES_AGENCY.test(corpus)) return false
  if (corpusMatchesSelfServeSoftwareSignals(corpus)) return true
  if (
    CORPUS_AGENCIES_AS_TARGET_CUSTOMER.test(corpus) &&
    !CORPUS_IMPLEMENTATION_BESPOKE_HINT.test(corpus)
  ) {
    return true
  }
  return false
}

/**
 * When scraped/title/body clearly names an industry vertical but the model omitted that list label, add it.
 * Uses tight regexes so generic words alone (e.g. “insurance” on a healthcare page) do not mis-tag.
 *
 * IMPORTANT: compliance badges like "HIPAA", "EHR", "EMR", "SOC 2", "GDPR" are
 * **weak** signals on their own — many B2B SaaS products list HIPAA next to SOC 2
 * just to show they're enterprise-ready, not because they're healthcare products.
 * They are only counted when paired with at least one **strong** healthcare signal
 * (medical/clinical/patient/etc.) in the same corpus. Same idea for the other
 * verticals: a bare keyword that's commonly mentioned outside its industry must
 * be backed by a clear domain phrase.
 */
export function augmentCategoriesWithIndustryVerticals(
  categories: string[],
  corpus: string,
): string[] {
  if (!corpus?.trim() || categories.length === 0) return categories

  // Strong = unambiguous industry phrasing. A single match auto-adds the label.
  // Weak  = compliance/jargon that's also used by horizontal SaaS (HIPAA, EHR, …).
  //         A weak match only counts when at least one strong match is also present.
  const verticals: {
    label: Category
    strong: RegExp
    weak?: RegExp
  }[] = [
    {
      label: 'Healthcare',
      strong:
        /\b(health[\s-]?care|health[- ]?tech|healthcare\s+practices?|medical\s+(practices?|offices?|professionals?|software|platform|providers?)|hospitals?|physicians?|patient\s+(intake|scheduling|records?|portal)|dental\s+practices?|\bdentists?\b|telehealth|telemedicine|clinical\s+workflows?|clinicians?|nursing\s+(homes?|staff)|pharmac(y|ies)|specifically\s+designed\s+for\s+healthcare|designed\s+for\s+healthcare|for\s+healthcare\s+(practices?|providers?|professionals?|teams?))\b/i,
      // HIPAA / EHR / EMR alone are not enough — many SaaS list them as compliance
      // badges. They only contribute when a strong healthcare signal is also present.
      weak: /\b(hipaa|\behr\b|\bemr\b|phi\b|protected\s+health\s+information)\b/i,
    },
    {
      label: 'Legal',
      strong:
        /\b(law\s+firms?|legal\s+practices?|litigation\s+(support|management)|for\s+attorneys?|paralegals?|legal\s+(software|platform|tech))\b/i,
    },
    {
      label: 'Insurance',
      strong:
        /\b(insurtech|for\s+insurance\s+brokers?|insurance\s+brokerages?|underwriting\s+(platform|software)|claims\s+(automation|software|management)|insurance\s+carriers?|policy\s+administration)\b/i,
    },
  ]

  let out = categories
  for (const { label, strong, weak } of verticals) {
    if (!categorySet.has(label)) continue
    if (out.includes(label)) continue
    const hasStrong = strong.test(corpus)
    if (!hasStrong) continue
    // For verticals that define a weak set (currently only Healthcare), the
    // strong match alone is sufficient — weak just expands what counts as
    // strong by combining (strong AND weak), which is implicitly true here
    // since hasStrong already passed. The weak regex exists so future
    // verticals can require BOTH if they want; today we only use strong.
    void weak
    out = finalizeToolCategoriesList([label, ...out])
  }
  return out
}

// Pre-process schema to handle empty strings for tools + legacy single `category`
const toolObjectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  url: z.string().url('Must be a valid URL'),
  logoUrl: z.union([z.string().url('Must be a valid URL'), z.null()]).optional().nullable(),
  categories: z
    .array(z.string().min(1).max(48))
    .min(1, 'Select at least one category')
    .max(MAX_TOOL_CATEGORIES),
  tags: z.string().optional().nullable(),
  traffic: z.enum(['low', 'medium', 'high', 'unknown']).optional().nullable(),
  revenue: z.enum(['free', 'freemium', 'paid', 'enterprise']).optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  estimatedVisits: z.number().int().positive().optional().nullable(),
  /** Service / implementation firm — stored separately; not in categories[]. */
  isAgency: z.boolean().optional().nullable(),
  /** Native/desktop/mobile store or explicit download links detected. */
  hasDownloadableApp: z.boolean().optional().nullable(),
})

const preprocessTool = z.preprocess((data: any) => {
  if (typeof data === 'object' && data !== null) {
    let fromList: string[] = []
    if (Array.isArray(data.categories) && data.categories.length > 0) {
      fromList = data.categories.map((c: unknown) =>
        normalizeToolCategory(String(c)),
      )
    }
    if (
      fromList.length === 0 &&
      data.category != null &&
      String(data.category).trim()
    ) {
      fromList = [normalizeToolCategory(String(data.category))]
    }
    const hadAgencyInInput = fromList.includes(AGENCY_CATEGORY_LABEL)
    const withoutAgency = [...new Set(fromList)].filter(
      (c) => c !== AGENCY_CATEGORY_LABEL,
    )
    let categories = finalizeToolCategoriesList(
      withoutAgency.length > 0 ? withoutAgency : ['Other'],
    )
    if (categories.length === 0) {
      categories = ['Other']
    }

    const explicit = parseOptionalBool(data.isAgency)
    let isAgency: boolean
    if (explicit === false) isAgency = false
    else if (explicit === true) isAgency = true
    else isAgency = hadAgencyInInput

    return {
      ...data,
      logoUrl: data.logoUrl === '' ? null : data.logoUrl,
      tags: data.tags === '' ? null : data.tags,
      traffic: data.traffic === '' ? null : data.traffic,
      revenue: data.revenue === '' ? null : data.revenue,
      categories,
      isAgency,
    }
  }
  return data
}, toolObjectSchema)

export const toolSchema = preprocessTool.transform((d) => ({
  ...d,
  category: d.categories[0],
  isAgency: d.isAgency,
}))

export type ToolInput = z.infer<typeof toolObjectSchema> & { category: string }

/** Videos use the same taxonomy as tools (filters + AI). Max 3 labels; primary = first. */
export const MAX_VIDEO_CATEGORIES = MAX_TOOL_CATEGORIES

/**
 * Legacy / niche video-only labels (pre–tools alignment) → canonical tool category.
 * New data should use `categories` from the shared list only.
 */
export const LEGACY_VIDEO_NICHE_TO_CANONICAL: Record<string, Category> = {
  'AI & Tech': 'AI Automation',
  'AI & Technology': 'AI Automation',
  'ASMR & Relaxation': 'Music & Audio',
  'Art & Creative': 'Design',
  'Beauty & Fashion': 'Marketing',
  'Business & Finance': 'SaaS',
  'Cars & Automotive': 'Other',
  Comedy: 'Other',
  'DIY & Crafts': 'Other',
  'Education & Tutorials': 'Education',
  Entertainment: 'Other',
  'Food & Cooking': 'Other',
  Gaming: 'Other',
  'Health & Wellness': 'Other',
  Motivational: 'Marketing',
  Music: 'Music & Audio',
  'Nature & Wildlife': 'Other',
  'News & Commentary': 'News',
  'Parenting & Family': 'Other',
  'Podcasts & Interviews': 'Music & Audio',
  'Reviews & Unboxing': 'Other',
  'Science & Documentary': 'Research',
  'Shorts & Clips': 'Video Editing',
  'Sports & Fitness': 'Other',
  'Travel & Lifestyle': 'Other',
  /** Old VideoCard chip keys */
  Cars: 'Other',
  Money: 'SaaS',
  AI: 'AI Automation',
}

/** Single-string normalization for legacy `video.category` cells. */
export function normalizeVideoCategory(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== 'string') return 'Other'
  const s = raw.trim()
  if (!s) return 'Other'
  const direct =
    LEGACY_VIDEO_NICHE_TO_CANONICAL[s] ??
    LEGACY_VIDEO_NICHE_TO_CANONICAL[s.toLowerCase()]
  if (direct) return normalizeToolCategory(direct)
  return normalizeToolCategory(s)
}

/**
 * Parse stored row → 1–3 labels (JSON array or legacy single `category`).
 */
export function parseVideoCategoriesFromRow(row: {
  category?: string | null
  categories?: unknown
}): string[] {
  const raw = row.categories
  if (Array.isArray(raw) && raw.length > 0) {
    const normalized = raw.map((c) => normalizeVideoCategory(String(c)))
    return finalizeToolCategoriesList([...new Set(normalized)])
  }
  return finalizeToolCategoriesList([normalizeVideoCategory(row.category)])
}

export const videoSources = ['youtube', 'tiktok'] as const
export type VideoSource = (typeof videoSources)[number]

function isValidVideoUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const isYoutube = host.includes('youtube.com') || host === 'youtu.be' || host === 'm.youtube.com'
    const isTiktok = host === 'www.tiktok.com' || host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com'
    return isYoutube || isTiktok
  } catch {
    return false
  }
}

// Pre-process schema: categories array (like tools) + legacy single `category`
const preprocessVideo = z.preprocess((data: any) => {
  if (typeof data === 'object' && data !== null) {
    let cats: string[] = []
    if (Array.isArray(data.categories) && data.categories.length > 0) {
      cats = data.categories.map((c: unknown) =>
        normalizeVideoCategory(String(c)),
      )
    } else if (data.category != null && String(data.category).trim()) {
      cats = [normalizeVideoCategory(String(data.category))]
    }
    cats = finalizeToolCategoriesList([...new Set(cats)])
    if (cats.length === 0) cats = ['Other']

    return {
      ...data,
      youtuberName: data.youtuberName === '' ? null : data.youtuberName,
      tags: data.tags === '' ? null : data.tags,
      description: data.description === '' ? null : data.description,
      channelThumbnailUrl: data.channelThumbnailUrl === '' ? null : data.channelThumbnailUrl,
      subscriberCount:
        typeof data.subscriberCount === 'string' && data.subscriberCount.trim() === ''
          ? null
          : data.subscriberCount,
      verified: data.verified === '' || data.verified === undefined ? null : !!data.verified,
      source: data.source === '' ? 'youtube' : (data.source ?? 'youtube'),
      categories: cats,
      category: cats[0],
    }
  }
  return data
}, z.object({
  title: z.string().min(1, 'Title is required'),
  url: z.string().refine((v) => isValidVideoUrl(v), 'Must be a valid YouTube or TikTok URL'),
  categories: z
    .array(z.string().min(1).max(48))
    .min(1, 'Select at least one category')
    .max(MAX_VIDEO_CATEGORIES),
  category: z.string().min(1),
  source: z.enum(videoSources).optional().default('youtube'),
  youtuberName: z.string().optional().nullable(),
  subscriberCount: z.number().int().nonnegative().optional().nullable(),
  channelThumbnailUrl: z.string().url().optional().nullable(),
  channelVideoCount: z.number().int().nonnegative().optional().nullable(),
  verified: z.boolean().optional().nullable(),
  tags: z.string().optional().nullable(),
  description: z.string().max(200, 'Description should be short (max 200 characters)').optional().nullable(),
}))

export const videoSchema = preprocessVideo

export type VideoInput = z.infer<typeof videoSchema>

