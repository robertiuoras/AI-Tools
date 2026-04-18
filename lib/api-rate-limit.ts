import { NextRequest, NextResponse } from 'next/server'

/** In-memory sliding windows per server instance (resets on cold start). */
const buckets = new Map<string, number[]>()

let sweepCounter = 0

function envInt(name: string, fallback: number): number {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function isRateLimitDisabled(): boolean {
  return process.env.RATE_LIMIT_DISABLED === 'true'
}

function prune(ts: number[], windowMs: number, now: number) {
  const cutoff = now - windowMs
  while (ts.length > 0 && ts[0]! < cutoff) {
    ts.shift()
  }
}

function maybeSweepStale() {
  if (++sweepCounter % 250 !== 0) return
  const now = Date.now()
  const oldestKeep = now - 3_700_000 // > 1h + slack
  for (const [key, ts] of buckets.entries()) {
    while (ts.length > 0 && ts[0]! < oldestKeep) {
      ts.shift()
    }
    if (ts.length === 0) {
      buckets.delete(key)
    }
  }
}

/**
 * Client IP for rate limiting (Vercel / proxies: first hop in x-forwarded-for).
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  const cf = request.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  return 'unknown'
}

export type RateLimitKind =
  | 'tools_analyze'
  | 'videos_analyze'
  | 'openai_test'
  | 'video_summary'

const LIMITS: Record<RateLimitKind, { windowMs: number; max: number }[]> = {
  tools_analyze: [
    {
      windowMs: 60_000,
      max: envInt('RATE_LIMIT_TOOLS_ANALYZE_PER_MINUTE', 45),
    },
    {
      windowMs: 3_600_000,
      max: envInt('RATE_LIMIT_TOOLS_ANALYZE_PER_HOUR', 400),
    },
  ],
  videos_analyze: [
    {
      windowMs: 60_000,
      max: envInt('RATE_LIMIT_VIDEOS_ANALYZE_PER_MINUTE', 60),
    },
    {
      windowMs: 3_600_000,
      max: envInt('RATE_LIMIT_VIDEOS_ANALYZE_PER_HOUR', 500),
    },
  ],
  openai_test: [
    {
      windowMs: 60_000,
      max: envInt('RATE_LIMIT_OPENAI_TEST_PER_MINUTE', 10),
    },
    {
      windowMs: 3_600_000,
      max: envInt('RATE_LIMIT_OPENAI_TEST_PER_HOUR', 50),
    },
  ],
  // AI Video Summariser project. Tighter than `videos_analyze` because each
  // call may transcribe + summarise (more tokens, longer wall time).
  video_summary: [
    {
      windowMs: 60_000,
      max: envInt('RATE_LIMIT_VIDEO_SUMMARY_PER_MINUTE', 10),
    },
    {
      windowMs: 3_600_000,
      max: envInt('RATE_LIMIT_VIDEO_SUMMARY_PER_HOUR', 80),
    },
  ],
}

/**
 * Apply sliding-window limits for this kind + IP. Returns 429 JSON if over limit.
 */
export function enforceApiRateLimit(
  request: NextRequest,
  kind: RateLimitKind,
): NextResponse | null {
  if (isRateLimitDisabled()) {
    return null
  }

  const ip = getClientIp(request)
  const spec = LIMITS[kind]
  const now = Date.now()
  const keys = spec.map((_, i) => `${kind}:${ip}:w${i}`)

  for (let i = 0; i < spec.length; i++) {
    const { windowMs, max } = spec[i]
    const key = keys[i]
    let ts = buckets.get(key)
    if (!ts) {
      ts = []
      buckets.set(key, ts)
    }
    prune(ts, windowMs, now)
    if (ts.length >= max) {
      const oldest = ts[0]!
      const retryAfterMs = Math.max(0, oldest + windowMs - now)
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000))
      return NextResponse.json(
        {
          error: 'Too many requests',
          errorType: 'app_rate_limit',
          details: `Server rate limit (${kind}). Try again in ${retryAfterSec}s.`,
          retryAfter: retryAfterSec,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSec),
          },
        },
      )
    }
  }

  for (let i = 0; i < spec.length; i++) {
    const { windowMs } = spec[i]
    const key = keys[i]
    const ts = buckets.get(key)!
    ts.push(now)
    prune(ts, windowMs, now)
  }

  maybeSweepStale()
  return null
}
