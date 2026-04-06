import { NextRequest, NextResponse } from 'next/server'
import {
  categories as preferredVideoCategories,
  finalizeVideoAiCategories,
  MAX_VIDEO_CATEGORIES,
} from '@/lib/schemas'

/**
 * Analyze a YouTube or TikTok video URL and return metadata for the Add Video form.
 * YouTube: YOUTUBE_API_KEY for full metadata; OPENAI_API_KEY (optional) for category.
 * TikTok: oEmbed for title + author; OPENAI_API_KEY (optional) for category. Follower count not in oEmbed.
 * Verified badge: set manually in admin for both.
 */

/** Detect if URL is TikTok */
function isTikTokUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    return host === 'www.tiktok.com' || host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com'
  } catch {
    return false
  }
}

/** Normalize TikTok URL for oEmbed (needs canonical form) */
function normalizeTikTokUrl(url: string): string {
  try {
    const u = new URL(url.trim())
    if (u.hostname.toLowerCase() === 'vm.tiktok.com' || u.hostname.toLowerCase() === 'vt.tiktok.com') {
      return url.trim()
    }
    return `https://www.tiktok.com${u.pathname}${u.search}`
  } catch {
    return url
  }
}

/** Fetch TikTok video metadata via oEmbed */
async function fetchTikTokOembed(url: string): Promise<{
  title: string
  youtuberName: string | null
  description: string | null
  channelThumbnailUrl: string | null
} | null> {
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
  const res = await fetch(oembedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Tools/1.0)' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    title?: string
    author_name?: string
    thumbnail_url?: string
  }
  return {
    title: data.title ?? '',
    youtuberName: data.author_name ?? null,
    description: null,
    channelThumbnailUrl: data.thumbnail_url ?? null,
  }
}

/** Extract YouTube video ID from common URL formats */
function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
      const parts = u.pathname.split('/').filter(Boolean)
      const id = parts[parts.length - 1]
      return id && id !== 'watch' ? id : null
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '')
      return id || null
    }
    return null
  } catch {
    return null
  }
}

/** Fetch video + channel metadata from YouTube Data API v3 */
async function fetchWithYouTubeApi(videoId: string) {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return null

  const base = 'https://www.googleapis.com/youtube/v3'
  const headers = { Accept: 'application/json' }

  const videoRes = await fetch(
    `${base}/videos?id=${videoId}&part=snippet&key=${key}`,
    { headers, signal: AbortSignal.timeout(10000) }
  )
  if (!videoRes.ok) return null
  const videoData = (await videoRes.json()) as {
    items?: Array<{
      snippet?: {
        title?: string
        description?: string
        channelId?: string
        channelTitle?: string
      }
    }>
  }
  const snippet = videoData.items?.[0]?.snippet
  if (!snippet?.channelId) return null

  const channelRes = await fetch(
    `${base}/channels?id=${encodeURIComponent(snippet.channelId)}&part=statistics,snippet&key=${key}`,
    { headers, signal: AbortSignal.timeout(10000) }
  )
  if (!channelRes.ok) return null
  const channelData = (await channelRes.json()) as {
    items?: Array<{
      statistics?: { subscriberCount?: string; videoCount?: string }
      snippet?: { thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string } } }
    }>
  }
  const channel = channelData.items?.[0]
  const subscriberCount = channel?.statistics?.subscriberCount
    ? parseInt(channel.statistics.subscriberCount, 10)
    : null
  const channelVideoCount = channel?.statistics?.videoCount
    ? parseInt(channel.statistics.videoCount, 10)
    : null
  const thumbnails = channel?.snippet?.thumbnails
  let channelThumbnailUrl =
    thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null

  if (!channelThumbnailUrl) {
    channelThumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  }

  return {
    title: snippet.title ?? '',
    description: (snippet.description ?? '').slice(0, 12000),
    youtuberName: snippet.channelTitle ?? null,
    subscriberCount: Number.isInteger(subscriberCount) ? subscriberCount : null,
    channelVideoCount: Number.isInteger(channelVideoCount) ? channelVideoCount : null,
    channelThumbnailUrl,
  }
}

/** Use OpenAI to suggest 1–3 categories (tools taxonomy), short description, and tags */
async function suggestCategoryDescriptionAndTags(
  title: string,
  description: string
): Promise<{ categories: string[] | null; shortDescription: string | null; tags: string | null }> {
  const key = process.env.OPENAI_API_KEY
  if (!key?.startsWith('sk-')) return { categories: null, shortDescription: null, tags: null }
  const preferred = preferredVideoCategories as readonly string[]
  const descSnippet = (description || '').slice(0, 10000)
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You analyze YouTube/TikTok video metadata. Reply with a single JSON object only (no markdown fences). Keys:
- "categories": array of 1 to ${MAX_VIDEO_CATEGORIES} strings. You MUST output between 1 and ${MAX_VIDEO_CATEGORIES} labels.

Accuracy rules:
- Prefer the *most specific* labels for what the video is actually about: named products (Cursor, Claude, ChatGPT, Midjourney), topics (Web Design, Hacking, Cybersecurity, Prompt Engineering), or skills (Education, Tutorials). Use custom Title Case labels (2–4 words, max 40 chars) when they describe the video better than a broad bucket.
- Also use the canonical list when it fits exactly (match spelling): ${preferred.join(', ')}. Mix list + custom as needed (e.g. ["Education", "Claude"] or ["Code Assistants", "Cursor"]).
- Use 1 category when the video is single-topic; use 2 or 3 when the content clearly covers multiple topics (e.g. tool + learning style). Do NOT default everything to "SaaS", "AI Automation", or "Other" unless nothing else fits.
- Order by relevance (first = primary). No duplicate labels. No emojis in category strings.
- "shortDescription": one concise line summarizing the video (max 200 characters)
- "tags": comma-separated relevant tags (lowercase, no #), no quotes`,
          },
          {
            role: 'user',
            content: `Title: ${title}

Video description (may be truncated; use title + description together):
${descSnippet || '(no description — infer from title only)'}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 650,
        temperature: 0.25,
      }),
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) return { categories: null, shortDescription: null, tags: null }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data.choices?.[0]?.message?.content?.trim()
    if (!raw) return { categories: null, shortDescription: null, tags: null }
    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, '').trim()
    let parsed: {
      categories?: unknown
      category?: string
      shortDescription?: string
      tags?: string
    }
    try {
      parsed = JSON.parse(cleaned) as typeof parsed
    } catch {
      return { categories: null, shortDescription: null, tags: null }
    }
    let list: string[] = []
    if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
      list = parsed.categories.map((c) => String(c).trim()).filter(Boolean)
    } else if (parsed.category != null && String(parsed.category).trim()) {
      list = [String(parsed.category).trim()]
    }
    list = finalizeVideoAiCategories(list)
    const shortDescription =
      typeof parsed.shortDescription === 'string'
        ? parsed.shortDescription.slice(0, 200).trim() || null
        : null
    const tags =
      typeof parsed.tags === 'string' ? parsed.tags.slice(0, 500).trim() || null : null
    return { categories: list.length > 0 ? list : null, shortDescription, tags }
  } catch {
    return { categories: null, shortDescription: null, tags: null }
  }
}

/** Fallback: oembed (no API key) - title and channel name only */
async function fetchWithOembed(normalizedUrl: string) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`
  const res = await fetch(oembedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Tools/1.0)' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { title?: string; author_name?: string }
  const videoId = getYouTubeVideoId(normalizedUrl) ?? null
  const fallbackThumb = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null
  return {
    title: data.title ?? '',
    youtuberName: data.author_name ?? null,
    description: null as string | null,
    subscriberCount: null as number | null,
    channelThumbnailUrl: fallbackThumb,
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    let normalizedUrl = url.trim()
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`
    }

    const parsed = new URL(normalizedUrl)
    const isYoutube =
      parsed.hostname === 'www.youtube.com' ||
      parsed.hostname === 'youtube.com' ||
      parsed.hostname === 'youtu.be' ||
      parsed.hostname === 'm.youtube.com'
    const isTiktok = isTikTokUrl(normalizedUrl)

    if (isTiktok) {
      const tiktokUrl = normalizeTikTokUrl(normalizedUrl)
      const oembed = await fetchTikTokOembed(tiktokUrl)
      if (!oembed) {
        return NextResponse.json(
          { error: 'Could not fetch TikTok video info. Check the URL.' },
          { status: 422 }
        )
      }
      const { categories: suggestedCategories, shortDescription: aiDescription, tags: suggestedTags } =
        await suggestCategoryDescriptionAndTags(oembed.title, oembed.description ?? '')
      return NextResponse.json({
        url: tiktokUrl,
        source: 'tiktok',
        title: oembed.title || 'Untitled',
        youtuberName: oembed.youtuberName,
        description: (aiDescription || '').slice(0, 200) || null,
        subscriberCount: null,
        channelVideoCount: null,
        channelThumbnailUrl: oembed.channelThumbnailUrl,
        suggestedCategories: suggestedCategories ?? undefined,
        suggestedCategory: suggestedCategories?.[0] ?? undefined,
        suggestedTags: suggestedTags ?? undefined,
        verified: null,
      })
    }

    if (!isYoutube) {
      return NextResponse.json(
        { error: 'URL must be a YouTube or TikTok video' },
        { status: 400 }
      )
    }

    const videoId = getYouTubeVideoId(normalizedUrl)
    if (!videoId) {
      return NextResponse.json(
        { error: 'Could not parse video ID from URL' },
        { status: 400 }
      )
    }

    let title: string
    let youtuberName: string | null
    let description: string | null
    let subscriberCount: number | null
    let channelVideoCount: number | null
    let channelThumbnailUrl: string | null

    const fromApi = await fetchWithYouTubeApi(videoId)
    if (fromApi) {
      title = fromApi.title || 'Untitled'
      youtuberName = fromApi.youtuberName
      description = fromApi.description
      subscriberCount = fromApi.subscriberCount
      channelThumbnailUrl = fromApi.channelThumbnailUrl
      channelVideoCount = fromApi.channelVideoCount ?? null
    } else {
      const fromOembed = await fetchWithOembed(normalizedUrl)
      if (!fromOembed) {
        return NextResponse.json(
          {
            error: 'Could not fetch video info. Check the URL or add YOUTUBE_API_KEY for full metadata.',
            details: 'Oembed failed',
          },
          { status: 422 }
        )
      }
      title = fromOembed.title || 'Untitled'
      youtuberName = fromOembed.youtuberName
      description = fromOembed.description
      subscriberCount = fromOembed.subscriberCount
      channelThumbnailUrl = fromOembed.channelThumbnailUrl
      channelVideoCount = null
    }

    const { categories: suggestedCategories, shortDescription: aiDescription, tags: suggestedTags } =
      await suggestCategoryDescriptionAndTags(title, description ?? '')

    const finalDescription =
      (aiDescription && aiDescription.length > 0) || (description && description.length > 0)
        ? (aiDescription || description || '').slice(0, 200)
        : null

    return NextResponse.json({
      url: normalizedUrl,
      source: 'youtube',
      title,
      youtuberName,
      description: finalDescription,
      subscriberCount,
      channelVideoCount,
      channelThumbnailUrl,
      suggestedCategories: suggestedCategories ?? undefined,
      suggestedCategory: suggestedCategories?.[0] ?? undefined,
      suggestedTags: suggestedTags ?? undefined,
      verified: null as boolean | null,
    })
  } catch (error) {
    console.error('Videos analyze error:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch video info',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
