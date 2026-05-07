import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdminUserId } from '@/lib/admin-auth'
import { getInternalBaseUrl } from '@/lib/internal-base-url'
import { buildToolPayloadFromAnalyzeResponse } from '@/lib/build-tool-payload-from-analyze'
import { normalizeToolSiteUrl } from '@/lib/normalize-tool-site-url'
import { createNotification } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
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
      .select('id, url, normalized_url, status, suggested_by_user_id')
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

    let analyzeRes: Response
    try {
      analyzeRes = await fetch(`${base}/api/tools/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
    } catch (err) {
      return NextResponse.json(
        { error: 'Could not reach analyze service', details: String(err) },
        { status: 502 },
      )
    }

    const analyzed = await analyzeRes.json().catch(() => null) as Record<string, unknown> | null
    if (!analyzeRes.ok || !analyzed) {
      const reason =
        typeof analyzed?.error === 'string' && analyzed.error
          ? analyzed.error
          : analyzeRes.statusText || 'Analyze failed'
      return NextResponse.json(
        { error: reason, details: analyzed },
        { status: 502 },
      )
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

    let postRes: Response
    try {
      postRes = await fetch(`${base}/api/tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      return NextResponse.json(
        { error: 'Could not reach tools service', details: String(err) },
        { status: 502 },
      )
    }

    const created = await postRes.json().catch(() => null)
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

    const suggesterId = typeof row.suggested_by_user_id === 'string' ? row.suggested_by_user_id : null
    if (suggesterId) {
      const toolName = typeof analyzed.name === 'string' && analyzed.name ? analyzed.name : url
      const toolId = typeof created?.id === 'string' ? created.id : null
      await createNotification({
        userId: suggesterId,
        type: 'tool_suggestion_approved',
        title: 'Your tool suggestion was approved!',
        body: `"${toolName}" has been added to the directory.`,
        link: toolId ? `/?highlight=${toolId}` : '/',
      })
    }

    return NextResponse.json({ ok: true, tool: created })
  } catch (err) {
    console.error('[approve suggestion]', err)
    return NextResponse.json(
      { error: 'Unexpected server error', details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
