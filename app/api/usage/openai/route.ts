import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/** Row shape for `openai_usage_log` (table from migration; not in generated Supabase types yet). */
type OpenaiUsageLogRow = {
  model: string
  operation: string
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  estimated_cost_usd: number | string | null
  created_at: string
}

function isMissingOpenaiUsageTable(error: {
  code?: string
  message?: string
}): boolean {
  const msg = (error.message ?? '').toLowerCase()
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('openai_usage_log')
  )
}

function emptyPayload(
  now: Date,
  monthStart: Date,
  setupRequired: boolean,
  setupMessage?: string,
) {
  const startDate = monthStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const endDate = now.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return {
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    totalCostDollars: 0,
    totalTokens: 0,
    totalRequests: 0,
    startDate,
    endDate,
    plan: null as string | null,
    hardLimitUsd: null as number | null,
    softLimitUsd: null as number | null,
    breakdown: [] as {
      model: string
      requests: number
      inputTokens: number
      outputTokens: number
      cachedTokens: number
    }[],
    byOperation: [] as { operation: string; requests: number; cost: number }[],
    recent: [] as {
      model: string
      operation: string
      totalTokens: number | null
      costDollars: number
      createdAt: string
    }[],
    setupRequired,
    setupMessage: setupMessage ?? null,
  }
}

export async function GET() {
  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthStartIso = monthStart.toISOString()

    const { data: rows, error } = await supabaseAdmin
      .from('openai_usage_log')
      .select(
        'model, operation, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, created_at',
      )
      .gte('created_at', monthStartIso)
      .order('created_at', { ascending: false })

    if (error) {
      if (isMissingOpenaiUsageTable(error)) {
        return NextResponse.json(
          emptyPayload(
            now,
            monthStart,
            true,
            'Run supabase/sql/openai-usage-migration.sql in the Supabase SQL editor, then Dashboard → Settings → API → Reload schema cache.',
          ),
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const safeRows = (rows ?? []) as OpenaiUsageLogRow[]

    const totalCostDollars = safeRows.reduce(
      (s, r) => s + Number(r.estimated_cost_usd),
      0,
    )
    const totalTokens = safeRows.reduce(
      (s, r) => s + (r.total_tokens ?? 0),
      0,
    )
    const totalRequests = safeRows.length

    const byModel: Record<
      string,
      {
        requests: number
        promptTokens: number
        completionTokens: number
        cost: number
      }
    > = {}
    for (const r of safeRows) {
      if (!byModel[r.model])
        byModel[r.model] = {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
        }
      byModel[r.model].requests++
      byModel[r.model].promptTokens += r.prompt_tokens ?? 0
      byModel[r.model].completionTokens += r.completion_tokens ?? 0
      byModel[r.model].cost += Number(r.estimated_cost_usd)
    }

    const breakdown = Object.entries(byModel).map(([model, v]) => ({
      model,
      requests: v.requests,
      inputTokens: v.promptTokens,
      outputTokens: v.completionTokens,
      cachedTokens: 0,
    }))

    const byOperation: Record<string, { requests: number; cost: number }> = {}
    for (const r of safeRows) {
      if (!byOperation[r.operation])
        byOperation[r.operation] = { requests: 0, cost: 0 }
      byOperation[r.operation].requests++
      byOperation[r.operation].cost += Number(r.estimated_cost_usd)
    }

    const recent = safeRows.slice(0, 10).map((r) => ({
      model: r.model,
      operation: r.operation,
      totalTokens: r.total_tokens,
      costDollars: Number(r.estimated_cost_usd),
      createdAt: r.created_at,
    }))

    const startDate = monthStart.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    const endDate = now.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

    return NextResponse.json({
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      totalCostDollars,
      totalTokens,
      totalRequests,
      startDate,
      endDate,
      plan: null,
      hardLimitUsd: null,
      softLimitUsd: null,
      breakdown,
      byOperation: Object.entries(byOperation).map(([operation, v]) => ({
        operation,
        ...v,
      })),
      recent,
      setupRequired: false,
      setupMessage: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (isMissingOpenaiUsageTable({ message })) {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      return NextResponse.json(
        emptyPayload(
          now,
          monthStart,
          true,
          'Run supabase/sql/openai-usage-migration.sql in the Supabase SQL editor, then reload the schema cache.',
        ),
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
