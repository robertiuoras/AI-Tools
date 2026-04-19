'use client'

import { useEffect, useRef, useState } from 'react'

type CountUpProps = {
  /** Target value to animate to. Falsy/zero values render the placeholder. */
  value: number
  /** Animation duration in ms. */
  duration?: number
  /** Optional prefix appended to the formatted value (e.g. "+"). */
  prefix?: string
  /** Optional suffix (e.g. "%"). */
  suffix?: string
  /** Locale used for the thousands separator. Defaults to user locale. */
  locale?: string
  /** Rendered when `value` is null/undefined/<=0 — keeps layout stable. */
  placeholder?: string
  /** Tailwind classes for the rendered span. */
  className?: string
  /**
   * Optional className applied only to the placeholder span. Useful when
   * `className` uses `bg-clip-text text-transparent` for a gradient
   * number — the placeholder ("—") would otherwise render invisibly.
   */
  placeholderClassName?: string
  /**
   * Re-run the animation every time `value` changes? Defaults to true so a
   * polled stat (e.g. "tools added today") flips up smoothly when the
   * number bumps. Set false to lock to a one-shot intro animation.
   */
  animateOnChange?: boolean
}

/**
 * Lightweight count-up animation for hero / stat cards. Uses
 * requestAnimationFrame + easeOutCubic so the number races up and softly
 * settles — feels premium without dragging in a heavy animation library.
 *
 * Honors `prefers-reduced-motion`: such users see the final value
 * immediately with no animation.
 */
export function CountUp({
  value,
  duration = 1200,
  prefix = '',
  suffix = '',
  locale,
  placeholder = '—',
  className,
  placeholderClassName,
  animateOnChange = true,
}: CountUpProps) {
  const target = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastTargetRef = useRef<number | null>(null)

  useEffect(() => {
    if (target <= 0) {
      setDisplay(0)
      return
    }

    if (
      lastTargetRef.current !== null &&
      lastTargetRef.current === target &&
      !animateOnChange
    ) {
      return
    }

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setDisplay(target)
      lastTargetRef.current = target
      return
    }

    const from = lastTargetRef.current ?? 0
    fromRef.current = from
    lastTargetRef.current = target
    const start = performance.now()

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const current = from + (target - from) * eased
      setDisplay(current)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [target, duration, animateOnChange])

  if (!Number.isFinite(value) || value <= 0) {
    return (
      <span className={placeholderClassName ?? className}>{placeholder}</span>
    )
  }

  // Round to int for whole-number stats — no jittery decimals during the ramp.
  const rounded = Math.round(display)
  const formatted = rounded.toLocaleString(locale)

  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}
