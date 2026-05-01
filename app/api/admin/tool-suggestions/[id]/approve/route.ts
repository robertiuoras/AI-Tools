import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdminUserId } from '@/lib/admin-auth'
import { getInternalBaseUrl } from '@/lib/internal-base-url'
import { buildToolPayloadFromAnalyzeResponse } from '@/lib/build-tool-payload-from-analyze'
import { normalizeToolSiteUrl } from '@/lib/normalize-tool-site-url'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const adminId = await requireAdminUserId(request)
  if (!adminId) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const admin = supabaseAdmin as any
  const { data: row, error: fetchErr } = await admin
    .from('tool_suggestion')
    .select('id, url, normalized_url, status')
    .eq('id', id)
    .single()

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Suggestion is not pending' }, { status: 400 })
  }

  const url = String(row.url)
  const base = getInternalBaseUrl(request)

  const analyzeRes = await fetch(`${base}/api/tools/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })

  const analyzed = (await analyzeRes.json()) as Record<string, unknown>
  if (!analyzeRes.ok) {
    return NextResponse.json(
      {
        error: 'Analyze failed',
        details: analyzed.error ?? analyzeRes.statusText,
      },
      { status: 502 },
    )
  }

  if (analyzed.error && typeof analyzed.error === 'string') {
    return NextResponse.json({ error: analyzed.error, details: analyzed }, { status: 502 })
  }

  const normalized = normalizeToolSiteUrl(String(analyzed.url ?? url))
  const { data: existingTools } = await admin.from('tool').select('url').ilike('url', `%${normalized}%`)
  const toolsArray = (existingTools || []) as Array<{ url: string }>
  const dup = toolsArray.some((t) => normalizeToolSiteUrl(t.url) === normalized)
  if (dup) {
    await admin.from('tool_suggestion').update({ status: 'rejected' }).eq('id', id)
    return NextResponse.json(
      { error: 'Tool already exists in directory; suggestion dismissed.' },
      { status: 409 },
    )
  }

  const payload = buildToolPayloadFromAnalyzeResponse(analyzed)
  if (!payload) {
    return NextResponse.json(
      { error: 'Analyze returned incomplete data', raw: analyzed },
      { status: 502 },
    )
  }

  const postRes = await fetch(`${base}/api/tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const created = await postRes.json()
  if (!postRes.ok) {
    return NextResponse.json(
      {
        error: 'Failed to create tool',
        details: created,
        status: postRes.status,
      },
      { status: 502 },
    )
  }

  await admin.from('tool_suggestion').update({ status: 'approved' }).eq('id', id)

  return NextResponse.json({ ok: true, tool: created })
}
