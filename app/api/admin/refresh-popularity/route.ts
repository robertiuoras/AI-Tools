/**
 * POST /api/admin/refresh-popularity
 *
 * Recompute honest popularity signals (Tranco rank, GitHub stars, domain age,
 * Wikipedia presence, on-page hard claims) for tools and persist the result.
 *
 * Strategy is "least-recently-refreshed first" so the cron-style usage stays
 * efficient: each call refreshes the next stale batch and bumps their
 * `popularityRefreshedAt` timestamp. Per-tool cost ≈ 1 page fetch + 5 small
 * parallel API calls; under load we cap concurrency to avoid hammering Wayback
 * or Tranco.
 *
 * Request body (all optional):
 * ```json
 * {
 *   "limit": 25,           // default 15, hard-cap 50 per call
 *   "toolIds": ["..."],    // explicit list (overrides staleness query)
 *   "force": false         // refresh even rows already up-to-date
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { computePopularity } from '@/lib/popularity-signals'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 15
const MAX_LIMIT = 50
const FETCH_TIMEOUT_MS = 8_000
const PER_TOOL_DELAY_MS = 350

interface RefreshResult {
  id: string
  name: string
  url: string
  tier: string | null
  score: number | null
  trancoRank: number | null
  githubStars: number | null
  domainAgeYears: number | null
  changed: boolean
  error?: string
}

async function fetchHtmlSnippet(url: string): Promise<{ html: string | null; text: string }> {
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
    if (!r.ok) return { html: null, text: '' }
    const html = await r.text()
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 5_000)
    return { html: html.slice(0, 80_000), text }
  } catch {
    return { html: null, text: '' }
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

  let body: { limit?: number; toolIds?: string[]; force?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    /* empty body OK */
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT))
  const force = Boolean(body.force)
  const toolIds = Array.isArray(body.toolIds)
    ? body.toolIds.filter((x): x is string => typeof x === 'string')
    : null

  const admin = supabaseAdmin as any

  // Pick rows to refresh. Hand-picked IDs win; otherwise we sort by
  // `popularityRefreshedAt asc` which means "null first, then oldest first" —
  // exactly what we want for staleness-driven crons.
  let query = admin
    .from('tool')
    .select('id, name, url, popularityRefreshedAt')
    .order('popularityRefreshedAt', { ascending: true, nullsFirst: true })
    .limit(limit)
  if (toolIds && toolIds.length > 0) query = query.in('id', toolIds)

  const { data: tools, error } = await query
  if (error) {
    // 42703 → migration not applied yet.
    if (error.code === '42703' || /column .* does not exist/i.test(error.message ?? '')) {
      return NextResponse.json(
        {
          error: 'Popularity columns missing',
          hint: 'Run supabase/sql/supabase-migration-popularity-signals.sql in your Supabase SQL editor, then retry.',
        },
        { status: 503 },
      )
    }
    console.error('[refresh-popularity] supabase fetch failed:', error)
    return NextResponse.json({ error: 'Failed to fetch tools' }, { status: 500 })
  }

  const list = (tools || []) as Array<{
    id: string
    name: string
    url: string
    popularityRefreshedAt: string | null
  }>
  if (list.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No tools to refresh',
      processed: 0,
      results: [],
    })
  }

  const results: RefreshResult[] = []
  let changedCount = 0

  for (const tool of list) {
    try {
      // If we're not forcing, and the row was refreshed within the last 24h,
      // skip it. Cheap guard against accidentally hammering the same batch.
      if (!force && tool.popularityRefreshedAt) {
        const ageMs = Date.now() - new Date(tool.popularityRefreshedAt).getTime()
        if (Number.isFinite(ageMs) && ageMs < 24 * 60 * 60 * 1_000) {
          results.push({
            id: tool.id,
            name: tool.name,
            url: tool.url,
            tier: null,
            score: null,
            trancoRank: null,
            githubStars: null,
            domainAgeYears: null,
            changed: false,
            error: 'skipped_recent',
          })
          continue
        }
      }

      const { html, text } = await fetchHtmlSnippet(tool.url)
      const popularity = await computePopularity({
        url: tool.url,
        toolName: tool.name,
        pageHtml: html ?? '',
        pageText: text,
      })

      const updatePayload: Record<string, unknown> = {
        trancoRank: popularity.trancoRank,
        githubRepo: popularity.githubRepo,
        githubStars: popularity.githubStars,
        domainAgeYears: popularity.domainAgeYears,
        wikipediaPageTitle: popularity.wikipediaPageTitle,
        wikipediaPageviews90d: popularity.wikipediaPageviews90d,
        popularityScore: popularity.score,
        popularityTier: popularity.tier,
        popularitySignals: popularity,
        popularityRefreshedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const { error: updateError } = await admin
        .from('tool')
        .update(updatePayload)
        .eq('id', tool.id)

      if (updateError) {
        results.push({
          id: tool.id,
          name: tool.name,
          url: tool.url,
          tier: popularity.tier,
          score: popularity.score,
          trancoRank: popularity.trancoRank,
          githubStars: popularity.githubStars,
          domainAgeYears: popularity.domainAgeYears,
          changed: false,
          error: updateError.message,
        })
        continue
      }

      changedCount++
      results.push({
        id: tool.id,
        name: tool.name,
        url: tool.url,
        tier: popularity.tier,
        score: popularity.score,
        trancoRank: popularity.trancoRank,
        githubStars: popularity.githubStars,
        domainAgeYears: popularity.domainAgeYears,
        changed: true,
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      results.push({
        id: tool.id,
        name: tool.name,
        url: tool.url,
        tier: null,
        score: null,
        trancoRank: null,
        githubStars: null,
        domainAgeYears: null,
        changed: false,
        error: message,
      })
    }
    await new Promise((r) => setTimeout(r, PER_TOOL_DELAY_MS))
  }

  return NextResponse.json({
    success: true,
    processed: list.length,
    changedCount,
    results,
  })
}
