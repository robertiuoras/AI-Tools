import { NextRequest, NextResponse } from 'next/server'
import { videoCategories } from '@/lib/schemas'
import { logOpenAIUsage } from '@/lib/openai-usage'

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
    description: (snippet.description ?? '').slice(0, 200),
    youtuberName: snippet.channelTitle ?? null,
    subscriberCount: Number.isInteger(subscriberCount) ? subscriberCount : null,
    channelVideoCount: Number.isInteger(channelVideoCount) ? channelVideoCount : null,
    channelThumbnailUrl,
  }
}

/** Use OpenAI to suggest category, short description, and tags from title + description */
async function suggestCategoryDescriptionAndTags(
  title: string,
  description: string
): Promise<{ category: string | null; shortDescription: string | null; tags: string | null }> {
  const key = process.env.OPENAI_API_KEY
  if (!key?.startsWith('sk-')) return { category: null, shortDescription: null, tags: null }
  const categories = videoCategories as readonly string[]
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You analyze YouTube video metadata. Reply with a single JSON object only, no markdown, with these keys:
- "category": exactly one of: ${categories.join(', ')}
- "shortDescription": one concise line summarizing the video (max 200 characters)
- "tags": comma-separated relevant tags (e.g. motivation, cars, money, AI), no quotes needed`,
          },
          {
            role: 'user',
            content: `Title: ${title}\nDescription: ${(description || '').slice(0, 800)}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return { category: null, shortDescription: null, tags: null }
    const data = (await res.json()) as { model?: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; choices?: Array<{ message?: { content?: string } }> }
    if (data.usage) logOpenAIUsage(data.model ?? 'gpt-4o-mini', 'video_analyze', data.usage)
    const raw = data.choices?.[0]?.message?.content?.trim()
    if (!raw) return { category: null, shortDescription: null, tags: null }
    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, '').trim()
    let parsed: { category?: string; shortDescription?: string; tags?: string }
    try {
      parsed = JSON.parse(cleaned) as { category?: string; shortDescription?: string; tags?: string }
    } catch {
      return { category: null, shortDescription: null, tags: null }
    }
    const category = parsed.category && categories.includes(parsed.category as any)
      ? (parsed.category as (typeof videoCategories)[number])
      : categories.find((c) => c.toLowerCase() === (parsed.category || '').toLowerCase()) ?? null
    const shortDescription =
      typeof parsed.shortDescription === 'string'
        ? parsed.shortDescription.slice(0, 200).trim() || null
        : null
    const tags =
      typeof parsed.tags === 'string' ? parsed.tags.slice(0, 500).trim() || null : null
    return { category, shortDescription, tags }
  } catch {
    return { category: null, shortDescription: null, tags: null }
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
      const { category: suggestedCategory, shortDescription: aiDescription, tags: suggestedTags } =
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
        suggestedCategory: suggestedCategory ?? undefined,
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

    const { category: suggestedCategory, shortDescription: aiDescription, tags: suggestedTags } =
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
      suggestedCategory: suggestedCategory ?? undefined,
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
