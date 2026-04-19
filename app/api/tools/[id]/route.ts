import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { toolSchema } from '@/lib/schemas'
import { toolCategoryList } from '@/lib/tool-categories'
import { toolHasDownloadableApp, toolIsAgency } from '@/lib/tool-flags'
import { createClient } from '@supabase/supabase-js'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: tool, error } = await supabaseAdmin
      .from('tool')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !tool) {
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    const row = tool as Record<string, unknown>
    const cats = toolCategoryList({
      category: typeof row.category === 'string' ? row.category : null,
      categories: Array.isArray(row.categories)
        ? (row.categories as string[])
        : null,
    })
    return NextResponse.json({
      ...row,
      isAgency: toolIsAgency(row as { isAgency?: unknown; is_agency?: unknown }),
      hasDownloadableApp: toolHasDownloadableApp(
        row as { hasDownloadableApp?: unknown; has_downloadable_app?: unknown },
      ),
      categories: cats,
      category: cats[0],
    })
  } catch (error) {
    console.error('Error fetching tool:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tool' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json()
    const validatedData = toolSchema.parse(body)

    // Prepare data for Supabase - handle null values
    const updateData: Record<string, unknown> = {
      name: validatedData.name,
      description: validatedData.description,
      url: validatedData.url,
      category: validatedData.category,
      categories: validatedData.categories,
      isAgency: validatedData.isAgency,
      logoUrl: validatedData.logoUrl || null,
      tags: validatedData.tags || null,
      traffic: validatedData.traffic || null,
      revenue: validatedData.revenue || null,
      rating: validatedData.rating ?? null,
      estimatedVisits: validatedData.estimatedVisits ?? null,
      updatedAt: new Date().toISOString(), // Update timestamp
    }
    if (validatedData.isAgency !== undefined && validatedData.isAgency !== null) {
      updateData.isAgency = validatedData.isAgency === true
    }
    if (
      validatedData.hasDownloadableApp !== undefined &&
      validatedData.hasDownloadableApp !== null
    ) {
      updateData.hasDownloadableApp = validatedData.hasDownloadableApp === true
    }

    // Honest popularity signals — only included if the popularity migration ran.
    // Same graceful-degradation pattern as the POST handler in /api/tools.
    const popularityKeys = [
      'githubRepo',
      'githubStars',
      'trancoRank',
      'domainAgeYears',
      'wikipediaPageTitle',
      'wikipediaPageviews90d',
      'popularityScore',
      'popularityTier',
      'popularitySignals',
      'popularityRefreshedAt',
    ] as const
    const v = validatedData as unknown as Record<string, unknown>
    if (v.githubRepo !== undefined) updateData.githubRepo = v.githubRepo ?? null
    if (v.githubStars !== undefined) updateData.githubStars = v.githubStars ?? null
    if (v.trancoRank !== undefined) updateData.trancoRank = v.trancoRank ?? null
    if (v.domainAgeYears !== undefined) updateData.domainAgeYears = v.domainAgeYears ?? null
    if (v.wikipediaPageTitle !== undefined) updateData.wikipediaPageTitle = v.wikipediaPageTitle ?? null
    if (v.wikipediaPageviews90d !== undefined)
      updateData.wikipediaPageviews90d = v.wikipediaPageviews90d ?? null
    if (v.popularityScore !== undefined) updateData.popularityScore = v.popularityScore ?? null
    if (v.popularityTier !== undefined) updateData.popularityTier = v.popularityTier ?? null
    if (v.popularitySignals !== undefined) updateData.popularitySignals = v.popularitySignals ?? null
    if (
      v.popularityScore !== undefined ||
      v.popularitySignals !== undefined ||
      v.trancoRank !== undefined ||
      v.githubStars !== undefined
    ) {
      updateData.popularityRefreshedAt = new Date().toISOString()
    }

    // Type assertion to work around Proxy type issues
    const admin = supabaseAdmin as any
    let { data: tool, error } = await admin
      .from('tool')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    // 42703 = "undefined column" — retry without popularity fields when the
    // operator hasn't applied supabase-migration-popularity-signals.sql yet.
    if (error && (error.code === '42703' || /column .* does not exist/i.test(error.message ?? ''))) {
      console.warn(
        '[PUT /api/tools/:id] Popularity columns missing — retrying without them. Run supabase-migration-popularity-signals.sql to enable.'
      )
      const fallback: Record<string, unknown> = { ...updateData }
      for (const key of popularityKeys) delete fallback[key]
      const retry = await admin
        .from('tool')
        .update(fallback)
        .eq('id', id)
        .select()
        .single()
      tool = retry.data
      error = retry.error
    }

    if (error) {
      console.error('Error updating tool:', error)
      return NextResponse.json(
        { error: 'Failed to update tool', details: error.message },
        { status: 500 }
      )
    }

    const tr = tool as Record<string, unknown>
    return NextResponse.json({
      ...tr,
      isAgency: toolIsAgency(tr as { isAgency?: unknown; is_agency?: unknown }),
      hasDownloadableApp: toolHasDownloadableApp(
        tr as { hasDownloadableApp?: unknown; has_downloadable_app?: unknown },
      ),
    })
  } catch (error) {
    console.error('Error updating tool:', error)
    if (error && typeof error === 'object' && 'issues' in error) {
      return NextResponse.json(
        { error: 'Validation error', details: error },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to update tool' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { error } = await supabaseAdmin
      .from('tool')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting tool:', error)
      return NextResponse.json(
        { error: 'Failed to delete tool', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting tool:', error)
    return NextResponse.json(
      { error: 'Failed to delete tool' },
      { status: 500 }
    )
  }
}

