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
  }
  if (parts.length === 1) {
    const p0 = parts[0]
    const legacy =
      LEGACY_TOOL_CATEGORY_ALIASES[s] ??
      LEGACY_TOOL_CATEGORY_ALIASES[lower]
    if (legacy && categorySet.has(legacy)) return legacy
    for (const c of categories) {
      if (c.toLowerCase() === p0.toLowerCase()) return c
    }
    return 'Other'
  }
  return 'Other'
}

// Pre-process schema to handle empty strings for tools + legacy single `category`
const toolObjectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  url: z.string().url('Must be a valid URL'),
  logoUrl: z.union([z.string().url('Must be a valid URL'), z.null()]).optional().nullable(),
  categories: z
    .array(z.string())
    .min(1, 'Select at least one category')
    .max(12),
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
      categories = [...new Set(fromArr)].filter((c) => c.length > 0)
    }
    if (
      categories.length === 0 &&
      data.category != null &&
      String(data.category).trim()
    ) {
      categories = [normalizeToolCategory(String(data.category))]
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

