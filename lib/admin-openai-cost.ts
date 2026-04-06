/**
 * Rough USD estimates for admin UI (gpt-4o-mini list pricing, standard tier).
 * @see https://platform.openai.com/docs/pricing
 */
export const GPT_4O_MINI_USD_PER_INPUT_1M = 0.15
export const GPT_4O_MINI_USD_PER_OUTPUT_1M = 0.6

/** Max items per "refresh all" run (safety + cost control). */
export const MAX_BULK_REFRESH_ITEMS = 50

/** Pause between bulk items to reduce rate-limit / burst issues. */
export const BULK_REFRESH_DELAY_MS_VIDEO = 850
export const BULK_REFRESH_DELAY_MS_TOOL = 1200

/** Stop bulk run after this many failures in a row (likely systemic issue). */
export const MAX_BULK_CONSECUTIVE_FAILURES = 8

/** Heuristic tokens per /api/videos/analyze OpenAI call (title + long description in, JSON out). */
const VIDEO_ANALYZE_INPUT_TOKENS = 3200
const VIDEO_ANALYZE_OUTPUT_TOKENS = 500

/** Heuristic tokens per /api/tools/analyze main completion (scraped page + prompt). */
const TOOL_ANALYZE_INPUT_TOKENS = 9500
const TOOL_ANALYZE_OUTPUT_TOKENS = 650

export function estimateUsdGpt4oMini(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * GPT_4O_MINI_USD_PER_INPUT_1M +
    (outputTokens / 1_000_000) * GPT_4O_MINI_USD_PER_OUTPUT_1M
  )
}

/** One successful video re-analyze ≈ one gpt-4o-mini call in /api/videos/analyze. */
export function estimateUsdPerVideoAnalyzeCall(): number {
  return estimateUsdGpt4oMini(VIDEO_ANALYZE_INPUT_TOKENS, VIDEO_ANALYZE_OUTPUT_TOKENS)
}

/** One successful tool re-analyze ≈ one gpt-4o-mini call in /api/tools/analyze (main pass). */
export function estimateUsdPerToolAnalyzeCall(): number {
  return estimateUsdGpt4oMini(TOOL_ANALYZE_INPUT_TOKENS, TOOL_ANALYZE_OUTPUT_TOKENS)
}

export function estimateUsdVideoAnalyzeCalls(successCount: number): number {
  if (successCount <= 0) return 0
  return estimateUsdPerVideoAnalyzeCall() * successCount
}

export function estimateUsdToolAnalyzeCalls(successCount: number): number {
  if (successCount <= 0) return 0
  return estimateUsdPerToolAnalyzeCall() * successCount
}

/** Human-readable USD for toast copy (very small amounts show more precision). */
export function formatUsdEstimate(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '~$0'
  if (usd < 0.01) return `~$${usd.toFixed(4)}`
  if (usd < 1) return `~$${usd.toFixed(3)}`
  return `~$${usd.toFixed(2)}`
}

export function openAiCostNote(usd: number): string {
  const f = formatUsdEstimate(usd)
  return `Est. OpenAI cost ${f} (gpt-4o-mini, approximate).`
}

/** Video URL analyze: cost only if OPENAI_API_KEY is set and the model runs. */
export function videoAnalyzeCostHint(): string {
  return `${openAiCostNote(estimateUsdPerVideoAnalyzeCall())} Applies when the API key is set and classification runs.`
}

export function formatDurationMs(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return '—'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const ss = s % 60
  if (m > 0) return `${m}m ${ss.toString().padStart(2, '0')}s`
  return `${ss}s`
}
