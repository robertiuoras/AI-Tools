/**
 * POST /api/admin/repair-logos
 *
 * Re-resolve logos for tools whose `logoUrl` is null **or** is one of our weak
 * fallbacks (Google S2 / DuckDuckGo). Useful for fixing existing rows after we
 * upgrade the resolver — e.g. canva.com originally landed with the og:image
 * banner; now we want it pointed at the Schema.org Organization logo.
 *
 * Request body (all optional):
 * ```json
 * {
 *   "limit": 50,        // max tools to process (default 25, hard cap 100)
 *   "force": false,     // re-resolve even when current logoUrl is "strong"
 *   "toolIds": ["..."]  // only repair these specific IDs
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import {
  isWeakLogoFallback,
  resolveLogoFromHostnameOnly,
  resolveLogoFromHtml,
} from '@/lib/logo-resolver'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const FETCH_TIMEOUT_MS = 8_000
const PER_TOOL_DELAY_MS = 250

interface RepairResult {
  id: string
  name: string
  url: string
  before: string | null
  after: string | null
  source: string
  changed: boolean
  error?: string
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    if (!r.ok) return null
    return await r.text()
  } catch {
    return null
  }
}

async function requireAdminUserId(request: NextRequest): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await client.auth.getUser(token)
  if (!user) return null
  const admin = supabaseAdmin as any
  const { data: row } = await admin
    .from('user')
    .select('role')
    .eq('id', user.id)
    .single()
  if ((row as { role?: string } | null)?.role !== 'admin') return null
  return user.id
}

export async function POST(request: NextRequest) {
  const adminUserId = await requireAdminUserId(request)
  if (!adminUserId) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: {
    limit?: number
    force?: boolean
    toolIds?: string[]
  } = {}
  try {
    body = await request.json()
  } catch {
    /* empty body is fine */
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT))
  const force = Boolean(body.force)
  const toolIds = Array.isArray(body.toolIds)
    ? body.toolIds.filter((x): x is string => typeof x === 'string')
    : null

  const admin = supabaseAdmin as any
  let query = admin
    .from('tool')
    .select('id, name, url, logoUrl')
    .order('updatedAt', { ascending: true })
    .limit(limit)

  if (toolIds && toolIds.length > 0) {
    query = query.in('id', toolIds)
  } else if (!force) {
    // Only weak-fallback or null logos by default.
    query = query.or('logoUrl.is.null,logoUrl.ilike.%google.com/s2/favicons%,logoUrl.ilike.%icons.duckduckgo.com%')
  }

  const { data: tools, error } = await query
  if (error) {
    console.error('[repair-logos] supabase fetch failed:', error)
    return NextResponse.json({ error: 'Failed to fetch tools' }, { status: 500 })
  }

  const list = (tools || []) as Array<{
    id: string
    name: string
    url: string
    logoUrl: string | null
  }>

  if (list.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No tools matched — everything already has a strong logo',
      processed: 0,
      results: [],
    })
  }

  const results: RepairResult[] = []
  let changedCount = 0

  for (const tool of list) {
    try {
      // Skip if logo is already strong and force=false (defensive — the SQL
      // filter should have already excluded these).
      if (!force && tool.logoUrl && !isWeakLogoFallback(tool.logoUrl)) {
        results.push({
          id: tool.id,
          name: tool.name,
          url: tool.url,
          before: tool.logoUrl,
          after: tool.logoUrl,
          source: 'skipped_strong',
          changed: false,
        })
        continue
      }

      const html = await fetchHtml(tool.url)
      const resolved = html
        ? await resolveLogoFromHtml(tool.url, html)
        : await resolveLogoFromHostnameOnly(new URL(tool.url).hostname)

      const after = resolved.url
      const changed = after !== tool.logoUrl
      if (changed) {
        const { error: updateError } = await admin
          .from('tool')
          .update({ logoUrl: after, updatedAt: new Date().toISOString() })
          .eq('id', tool.id)
        if (updateError) {
          results.push({
            id: tool.id,
            name: tool.name,
            url: tool.url,
            before: tool.logoUrl,
            after,
            source: resolved.source,
            changed: false,
            error: updateError.message,
          })
          continue
        }
        changedCount++
      }

      results.push({
        id: tool.id,
        name: tool.name,
        url: tool.url,
        before: tool.logoUrl,
        after,
        source: resolved.source,
        changed,
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      results.push({
        id: tool.id,
        name: tool.name,
        url: tool.url,
        before: tool.logoUrl,
        after: tool.logoUrl,
        source: 'error',
        changed: false,
        error: message,
      })
    }
    // Small delay so we don't hammer one publisher when many of their tools land
    // in the same batch.
    await new Promise((r) => setTimeout(r, PER_TOOL_DELAY_MS))
  }

  return NextResponse.json({
    success: true,
    processed: list.length,
    changedCount,
    results,
  })
}
