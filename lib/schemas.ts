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
 * Site text strongly suggests a marketing/creative **services** firm (retainers, client work).
 * Used when the model returns categories but omits "Agencies".
 */
export const CORPUS_SERVICES_AGENCY_HINT = new RegExp(
  [
    String.raw`\b(digital|creative|marketing|advertising|design|brand|media|growth|seo|web|content|social|influencer|performance|ppc|paid media)\s+agenc(y|ies)\b`,
    String.raw`\b(full[- ]service|boutique)\s+agenc(y|ies)\b`,
    String.raw`\bwe\s+are\s+(a\s+)?(digital|creative|marketing|advertising|design|brand)\s+agency\b`,
    String.raw`\bagency\s+(specializing|focused|based)\s+in\b`,
  ].join('|'),
  'i',
)

/**
 * Custom implementation / integration shops: book-a-call motion, diagnostics, phased rollout,
 * “live in N days”, integrate with client systems — including vertical specialists (e.g. broker automation).
 */
export const CORPUS_IMPLEMENTATION_SERVICES_HINT = new RegExp(
  [
    String.raw`\bbook\s+(a\s+)?(call|consultation|demo|strategy|discovery)\b`,
    String.raw`\b(schedule|request)\s+(a\s+)?(call|demo|consultation|discovery)\b`,
    String.raw`\b(free\s+)?diagnostic\b`,
    String.raw`\bintegrat(e|ion)\s+with\s+your\s+(existing\s+)?`,
    String.raw`\b(live|go\s+live)\s+in\s+\d+\s*(days?|weeks?|months?)\b`,
    String.raw`\b\d+\s+days?\s+or\s+less\b`,
    String.raw`\b(system|solution)\s+is\s+live\s+in\b`,
    String.raw`\bconfigure(d)?\s+to\s+your\s+(standards?|workflows?|needs?)\b`,
    String.raw`\btemplates?\s+to\s+your\s+standards?\b`,
    String.raw`\broll[- ]?out\b`,
    String.raw`\broll\s+(it\s+)?out\b`,
    String.raw`\bphased\s+(rollout|deployment|launch)\b`,
    String.raw`\bwe\s+refine\b`,
    String.raw`\bwe\s+build\b`,
    String.raw`\b(custom|bespoke)\s+(implementation|build|deployment|integration|solution)\b`,
    String.raw`\bimplementation\s+(partner|services?|team)\b`,
    String.raw`\b(done[- ]for[- ]you|white[- ]glove)\s+(setup|onboarding|implementation)\b`,
    String.raw`\bno\s+(sales\s+)?pitch\b`,
  ].join('|'),
  'i',
)

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
 * If the page clearly describes a services or implementation firm but the model omitted "Agencies", add it.
 * Vertical B2B wording (e.g. “for brokers”) no longer blocks when implementation / book-a-call signals match.
 */
export function augmentCategoriesWithAgencySignals(
  categories: string[],
  corpus: string,
): string[] {
  if (!corpus?.trim() || categories.length === 0) return categories
  if (categories.includes('Agencies')) return categories

  const verticalProduct = CORPUS_VERTICAL_B2B_BLOCKS_AGENCIES.test(corpus)
  const marketingAgency = CORPUS_SERVICES_AGENCY_HINT.test(corpus)
  const implServices = CORPUS_IMPLEMENTATION_SERVICES_HINT.test(corpus)

  if (verticalProduct && !implServices && !marketingAgency) {
    return categories
  }
  if (!marketingAgency && !implServices) {
    return categories
  }

  return finalizeToolCategoriesList(['Agencies', ...categories])
}

/**
 * When scraped/title/body clearly names an industry vertical but the model omitted that list label, add it.
 * Uses tight regexes so generic words alone (e.g. “insurance” on a healthcare page) do not mis-tag.
 */
export function augmentCategoriesWithIndustryVerticals(
  categories: string[],
  corpus: string,
): string[] {
  if (!corpus?.trim() || categories.length === 0) return categories

  const verticals: { label: Category; re: RegExp }[] = [
    {
      label: 'Healthcare',
      re: /\b(healthcare|health\s+care|health[- ]?tech|specifically\s+designed\s+for\s+healthcare|designed\s+for\s+healthcare|for\s+healthcare|healthcare\s+practices?|medical\s+practices?|hospitals?|physicians?|patient\s+intake|\bpatients?\b.*\b(practices?|appointments?|scheduling|calls)\b|dental\s+practices?|\bdentists?\b|telehealth|\behr\b|\bemr\b|\bhipaa\b|clinical\s+workflows?\b)/i,
    },
    {
      label: 'Legal',
      re: /\b(law\s+firms?|legal\s+practices?|litigation\s+support|for\s+attorneys?|paralegal)\b/i,
    },
    {
      label: 'Insurance',
      re: /\b(insurtech|for\s+insurance\s+brokers?|insurance\s+brokerages?|underwriting\s+(platform|software)|claims\s+(automation|software))\b/i,
    },
  ]

  let out = categories
  for (const { label, re } of verticals) {
    if (!categorySet.has(label)) continue
    if (out.includes(label)) continue
    if (re.test(corpus)) {
      out = finalizeToolCategoriesList([label, ...out])
    }
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
})

const preprocessTool = z.preprocess((data: any) => {
  if (typeof data === 'object' && data !== null) {
    let categories: string[] = []
    if (Array.isArray(data.categories) && data.categories.length > 0) {
      const fromArr: string[] = data.categories.map((c: unknown) =>
        normalizeToolCategory(String(c)),
      )
      categories = finalizeToolCategoriesList(
        [...new Set(fromArr)].filter((c) => c.length > 0),
      )
    }
    if (
      categories.length === 0 &&
      data.category != null &&
      String(data.category).trim()
    ) {
      categories = finalizeToolCategoriesList([
        normalizeToolCategory(String(data.category)),
      ])
    }
    if (categories.length === 0) {
      categories = ['Other']
    }
    return {
      ...data,
      logoUrl: data.logoUrl === '' ? null : data.logoUrl,
      tags: data.tags === '' ? null : data.tags,
      traffic: data.traffic === '' ? null : data.traffic,
      revenue: data.revenue === '' ? null : data.revenue,
      categories,
    }
  }
  return data
}, toolObjectSchema)

export const toolSchema = preprocessTool.transform((d) => ({
  ...d,
  category: d.categories[0],
}))

export type ToolInput = z.infer<typeof toolObjectSchema> & { category: string }

// Video-specific categories for the /videos page (keep in sync with analyze prompt in /api/videos/analyze)
export const videoCategories = [
  'AI & Tech',
  'ASMR & Relaxation',
  'Art & Creative',
  'Beauty & Fashion',
  'Business & Finance',
  'Cars & Automotive',
  'Comedy',
  'DIY & Crafts',
  'Education & Tutorials',
  'Entertainment',
  'Food & Cooking',
  'Gaming',
  'Health & Wellness',
  'Motivational',
  'Music',
  'Nature & Wildlife',
  'News & Commentary',
  'Parenting & Family',
  'Podcasts & Interviews',
  'Reviews & Unboxing',
  'Science & Documentary',
  'Shorts & Clips',
  'Sports & Fitness',
  'Travel & Lifestyle',
  'Other',
] as const

export type VideoCategory = typeof videoCategories[number]

const videoCategorySet = new Set<string>(videoCategories)

/**
 * Map legacy DB values (renamed lists, typos, overly narrow labels) to current broad categories.
 * Extend `LEGACY_VIDEO_CATEGORY_ALIASES` as you discover old values in Supabase.
 */
export const LEGACY_VIDEO_CATEGORY_ALIASES: Record<string, VideoCategory> = {
  // Examples — adjust to match strings actually stored in your `video` table
  'AI & Technology': 'AI & Tech',
  Technology: 'AI & Tech',
  Tech: 'AI & Tech',
  Education: 'Education & Tutorials',
  Tutorials: 'Education & Tutorials',
  Tutorial: 'Education & Tutorials',
  Documentary: 'Science & Documentary',
  Fitness: 'Sports & Fitness',
  Travel: 'Travel & Lifestyle',
  Lifestyle: 'Travel & Lifestyle',
}

/** Collapse unknown/legacy video category strings to a valid `videoCategories` value. */
export function normalizeVideoCategory(raw: string | null | undefined): VideoCategory {
  if (raw == null || typeof raw !== 'string') return 'Other'
  const s = raw.trim()
  if (!s) return 'Other'
  if (videoCategorySet.has(s)) return s as VideoCategory
  const lower = s.toLowerCase()
  for (const c of videoCategories) {
    if (c.toLowerCase() === lower) return c
  }
  const mapped =
    LEGACY_VIDEO_CATEGORY_ALIASES[s] ?? LEGACY_VIDEO_CATEGORY_ALIASES[lower]
  if (mapped && videoCategorySet.has(mapped)) return mapped
  return 'Other'
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

// Pre-process schema to handle empty strings for videos
const preprocessVideo = z.preprocess((data: any) => {
  if (typeof data === 'object' && data !== null) {
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
    }
  }
  return data
}, z.object({
  title: z.string().min(1, 'Title is required'),
  url: z.string().refine((v) => isValidVideoUrl(v), 'Must be a valid YouTube or TikTok URL'),
  category: z.enum(videoCategories, {
    errorMap: () => ({ message: 'Category is required' }),
  }),
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

