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

export async function GET() {
  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    // Fetch all rows for current month
    const { data: rows, error } = await supabaseAdmin
      .from('openai_usage_log')
      .select('model, operation, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, created_at')
      .gte('created_at', monthStart)
      .order('created_at', { ascending: false })

    if (error) {
      // Table doesn't exist yet — guide the user
      if (error.code === '42P01') {
        return NextResponse.json(
          { error: 'Usage table not created yet. Run openai-usage-migration.sql in your Supabase SQL editor.' },
          { status: 400 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const safeRows = (rows ?? []) as OpenaiUsageLogRow[]

    // Aggregate totals
    const totalCostDollars = safeRows.reduce((s, r) => s + Number(r.estimated_cost_usd), 0)
    const totalTokens = safeRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0)
    const totalRequests = safeRows.length

    // Breakdown by model
    const byModel: Record<string, { requests: number; promptTokens: number; completionTokens: number; cost: number }> = {}
    for (const r of safeRows) {
      if (!byModel[r.model]) byModel[r.model] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 }
      byModel[r.model].requests++
      byModel[r.model].promptTokens += r.prompt_tokens ?? 0
      byModel[r.model].completionTokens += r.completion_tokens ?? 0
      byModel[r.model].cost += Number(r.estimated_cost_usd)
    }

    // Breakdown by operation
    const byOperation: Record<string, { requests: number; cost: number }> = {}
    for (const r of safeRows) {
      if (!byOperation[r.operation]) byOperation[r.operation] = { requests: 0, cost: 0 }
      byOperation[r.operation].requests++
      byOperation[r.operation].cost += Number(r.estimated_cost_usd)
    }

    // Recent entries (last 10)
    const recent = safeRows.slice(0, 10).map((r) => ({
      model: r.model,
      operation: r.operation,
      totalTokens: r.total_tokens,
      costDollars: Number(r.estimated_cost_usd),
      createdAt: r.created_at,
    }))

    return NextResponse.json({
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      totalCostDollars,
      totalTokens,
      totalRequests,
      byModel: Object.entries(byModel).map(([model, v]) => ({ model, ...v })),
      byOperation: Object.entries(byOperation).map(([operation, v]) => ({ operation, ...v })),
      recent,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
