import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { enforceApiRateLimit } from '@/lib/api-rate-limit'

export const dynamic = 'force-dynamic'

function normalizeVideoUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`
    const u = new URL(withProto)
    if (!u.hostname) return null
    // Strip tracking params
    ;['si', 'pp', 'feature', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(
      (p) => u.searchParams.delete(p),
    )
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

function detectVideoSource(url: string): 'youtube' | 'tiktok' | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube'
    if (host === 'www.tiktok.com' || host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com')
      return 'tiktok'
    return null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceApiRateLimit(request, 'videos_suggest')
  if (limited) return limited

  try {
    const body = (await request.json()) as { url?: string; note?: string }
    const canonical = normalizeVideoUrl(String(body.url ?? ''))
    if (!canonical) {
      return NextResponse.json({ error: 'Valid YouTube or TikTok URL required' }, { status: 400 })
    }

    const source = detectVideoSource(canonical)
    if (!source) {
      return NextResponse.json(
        { error: 'Unsupported URL.', message: 'Only YouTube and TikTok video URLs are accepted.' },
        { status: 400 },
      )
    }

    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null
    const admin = supabaseAdmin as any

    // Check if already in the video library
    const { data: existingVideos } = await admin.from('video').select('url').ilike('url', `%${canonical}%`)
    const videosArray = (existingVideos || []) as Array<{ url: string }>
    if (videosArray.some((row) => normalizeVideoUrl(row.url) === canonical)) {
      return NextResponse.json(
        {
          error: 'already_exists',
          message: 'This video is already in the curated list. You can find it on the Videos tab.',
        },
        { status: 409 },
      )
    }

    // Check for duplicate pending suggestion
    const { data: pendingDup } = await admin
      .from('video_suggestion')
      .select('id')
      .eq('normalized_url', canonical)
      .eq('status', 'pending')
      .maybeSingle()

    if (pendingDup) {
      return NextResponse.json(
        {
          error: 'already_suggested',
          message: 'Someone already suggested this video. We will review it soon.',
        },
        { status: 409 },
      )
    }

    let suggestedByUserId: string | null = null
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '')
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const {
        data: { user },
      } = await userClient.auth.getUser(token)
      suggestedByUserId = user?.id ?? null
    }

    const { data: inserted, error } = await admin
      .from('video_suggestion')
      .insert({
        url: canonical,
        normalized_url: canonical,
        note: note || null,
        status: 'pending',
        suggested_by_user_id: suggestedByUserId,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'already_suggested', message: 'This video is already in the suggestion queue.' },
          { status: 409 },
        )
      }
      console.error('[videos/suggest]', error)
      return NextResponse.json({ error: 'Could not save suggestion' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      id: inserted?.id,
      message: 'Thanks! An admin will review your suggestion.',
    })
  } catch (e) {
    console.error('[videos/suggest]', e)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
