import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY

  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 400 })
  }

  const now = new Date()
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
  // End date is tomorrow to ensure today's usage is included
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  try {
    const [usageRes, subRes] = await Promise.all([
      fetch(
        `https://api.openai.com/v1/dashboard/billing/usage?start_date=${fmt(startDate)}&end_date=${fmt(endDate)}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: 'no-store',
        },
      ),
      fetch('https://api.openai.com/v1/dashboard/billing/subscription', {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      }),
    ])

    if (!usageRes.ok) {
      const err = await usageRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: err?.error?.message ?? `OpenAI API error ${usageRes.status}` },
        { status: usageRes.status },
      )
    }

    const [usage, subscription] = await Promise.all([
      usageRes.json(),
      subRes.ok ? subRes.json() : Promise.resolve(null),
    ])

    // total_usage is in cents
    const totalCents: number = usage.total_usage ?? 0

    return NextResponse.json({
      totalCostDollars: totalCents / 100,
      totalCostCents: totalCents,
      startDate: fmt(startDate),
      endDate: fmt(now),
      plan: subscription?.plan?.title ?? null,
      hardLimitUsd: subscription?.hard_limit_usd ?? null,
      softLimitUsd: subscription?.soft_limit_usd ?? null,
      // Summarise by model snapshot
      breakdown: (usage.data ?? []).map(
        (row: {
          snapshot_id?: string
          n_requests?: number
          n_context_tokens_total?: number
          n_generated_tokens_total?: number
          n_cached_context_tokens_total?: number
          cost?: number
        }) => ({
          model: row.snapshot_id ?? 'unknown',
          requests: row.n_requests ?? 0,
          inputTokens: row.n_context_tokens_total ?? 0,
          outputTokens: row.n_generated_tokens_total ?? 0,
          cachedTokens: row.n_cached_context_tokens_total ?? 0,
        }),
      ),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
