import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { enforceApiRateLimit } from '@/lib/api-rate-limit'
import { normalizeToolSiteUrl } from '@/lib/normalize-tool-site-url'

export const dynamic = 'force-dynamic'

function normalizeIncomingUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`
    const u = new URL(withProto)
    if (!u.hostname) return null
    return u.toString()
  } catch {
    return null
  }
}

async function toolExistsWithUrl(admin: any, normalized: string): Promise<boolean> {
  const { data: existingTools } = await admin
    .from('tool')
    .select('url')
    .ilike('url', `%${normalized}%`)
  const toolsArray = (existingTools || []) as Array<{ url: string }>
  return toolsArray.some((row) => normalizeToolSiteUrl(row.url) === normalized)
}

export async function POST(request: NextRequest) {
  const limited = enforceApiRateLimit(request, 'tools_suggest')
  if (limited) return limited

  try {
    const body = (await request.json()) as { url?: string }
    const canonical = normalizeIncomingUrl(String(body.url ?? ''))
    if (!canonical) {
      return NextResponse.json({ error: 'Valid URL required' }, { status: 400 })
    }

    const normalized = normalizeToolSiteUrl(canonical)
    const admin = supabaseAdmin as any

    if (await toolExistsWithUrl(admin, normalized)) {
      return NextResponse.json(
        {
          error: 'already_exists',
          message: 'This tool is already in the directory. Use search to find it.',
        },
        { status: 409 },
      )
    }

    const { data: pendingDup } = await admin
      .from('tool_suggestion')
      .select('id')
      .eq('normalized_url', normalized)
      .eq('status', 'pending')
      .maybeSingle()

    if (pendingDup) {
      return NextResponse.json(
        {
          error: 'already_suggested',
          message: 'Someone already suggested this tool. We will review it soon.',
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
      .from('tool_suggestion')
      .insert({
        url: canonical,
        normalized_url: normalized,
        status: 'pending',
        suggested_by_user_id: suggestedByUserId,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error: 'already_suggested',
            message: 'This URL is already in the suggestion queue.',
          },
          { status: 409 },
        )
      }
      console.error('[tools/suggest]', error)
      return NextResponse.json({ error: 'Could not save suggestion' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      id: inserted?.id,
      message: 'Thanks! An admin will review your suggestion.',
    })
  } catch (e) {
    console.error('[tools/suggest]', e)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
