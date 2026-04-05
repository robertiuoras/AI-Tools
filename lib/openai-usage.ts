import { supabaseAdmin } from './supabase'

// Pricing per token (USD) — update if OpenAI changes rates
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':         { input: 0.150 / 1_000_000, output: 0.600 / 1_000_000 },
  'gpt-4o':              { input: 5.000 / 1_000_000, output: 15.00 / 1_000_000 },
  'gpt-4-turbo':         { input: 10.00 / 1_000_000, output: 30.00 / 1_000_000 },
  'gpt-4':               { input: 30.00 / 1_000_000, output: 60.00 / 1_000_000 },
  'gpt-3.5-turbo':       { input: 0.500 / 1_000_000, output: 1.500 / 1_000_000 },
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  // Match on prefix so model variants like "gpt-4o-mini-2024-07-18" still match
  const pricing =
    Object.entries(MODEL_PRICING).find(([key]) => model.startsWith(key))?.[1] ??
    MODEL_PRICING['gpt-4o-mini']
  return pricing.input * promptTokens + pricing.output * completionTokens
}

/** Client- or server-safe: estimated USD for one completion (same rates as logging). */
export function estimateOpenAiUsageCostUsd(
  model: string | undefined,
  usage:
    | { prompt_tokens?: number; completion_tokens?: number }
    | null
    | undefined,
): number {
  if (
    !usage ||
    typeof usage.prompt_tokens !== 'number' ||
    typeof usage.completion_tokens !== 'number'
  ) {
    return 0
  }
  return estimateCost(
    model ?? 'gpt-4o-mini',
    usage.prompt_tokens,
    usage.completion_tokens,
  )
}

/**
 * Fire-and-forget: log one OpenAI completion call to Supabase.
 * Never throws — usage logging must never break the calling route.
 */
export function logOpenAIUsage(
  model: string,
  operation: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): void {
  const cost = estimateCost(model, usage.prompt_tokens, usage.completion_tokens)
  const row = {
    model,
    operation,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    estimated_cost_usd: cost,
  }
  // Table is created via openai-usage-migration.sql but not in generated Supabase types yet.
  void Promise.resolve(
    supabaseAdmin.from('openai_usage_log').insert(row as never) as unknown as Promise<{
      error: { message: string } | null
    }>,
  )
    .then(({ error }) => {
      if (error) console.error('[OpenAI Usage] Failed to log:', error.message)
    })
    .catch((e: unknown) =>
      console.error('[OpenAI Usage] Failed to log:', e),
    )
}
