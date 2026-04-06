import { z } from 'zod'

/** AI tool categories (alphabetical). DB stores free text; keep analyze prompt in sync. */
export const categories = [
  'AI Agents',
  'AI Automation',
  'Analytics',
  'Code Assistants',
  'Customer Support',
  'Design',
  'Education',
  'Image Generation',
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

export type Category = typeof categories[number]

const categorySet = new Set<string>(categories)

/** Max categories per tool (1–3; primary = first). */
export const MAX_TOOL_CATEGORIES = 3

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
  Photo: 'Image Generation',
  Art: 'Image Generation',
  Career: 'Job',
  Jobs: 'Job',
  Recruitment: 'Job',
  Translation: 'Language',
  NLP: 'Language',
  Legaltech: 'Legal',
  Ads: 'Marketing',
  SEO: 'Marketing',
  Social: 'Marketing',
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
 * Collapse bad data (e.g. "Video Editing|AI Automation|SaaS") to one known category.
 * Picks the first segment that matches our category list; otherwise legacy alias or Other.
 */
export function normalizeToolCategory(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== 'string') return 'Other'
  const s = raw.trim()
  if (!s) return 'Other'
  if (categorySet.has(s)) return s
  const lower = s.toLowerCase()
  const parts = s.split('|').map((p) => p.trim()).filter(Boolean)
  for (const p of parts) {
    if (categorySet.has(p)) return p
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
  /** Consulting / services business (not primarily a self-serve product). */
  isAgency: z.boolean().optional().nullable(),
  /** Native/desktop/mobile store or explicit download links detected. */
  hasDownloadableApp: z.boolean().optional().nullable(),
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

