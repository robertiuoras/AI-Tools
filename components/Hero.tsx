'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'

import { BrandMark } from '@/components/BrandMark'
import { RecentToolsTicker } from '@/components/RecentToolsTicker'
import type { Tool } from '@/lib/supabase'

type HeroProps = {
  /** Full tools list — used to drive the live status card and recent ticker. */
  tools?: Tool[]
  /** Number of tools added in the last 24h (drives the "fresh today" stat). */
  toolsAddedTodayCount?: number
}

export function Hero({ tools = [], toolsAddedTodayCount = 0 }: HeroProps) {
  const totalTools = tools.length

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 dark:from-indigo-950 dark:via-violet-950 dark:to-fuchsia-950">
      {/* Layered background — engineered dot grid + soft color glow.
          Anchors the page in a "live product" texture instead of a flat gradient. */}
      <div className="pointer-events-none absolute inset-0 hero-dot-grid" aria-hidden />
      <div
        className="pointer-events-none absolute -left-[15%] top-[-10%] h-[28rem] w-[28rem] rounded-full bg-cyan-400/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-[10%] bottom-[-20%] h-[26rem] w-[26rem] rounded-full bg-fuchsia-400/25 blur-3xl"
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-6 pb-12 pt-12 sm:px-6 sm:pb-16 sm:pt-16 lg:px-8 lg:pb-20 lg:pt-24">
        {/* Two-column asymmetric layout (lg+); single column below. */}
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
          {/* ─── Left: brand line + headline + subhead + meta ───────────────── */}
          <div className="lg:col-span-7">
            {/* Eyebrow row: brand mark + small label. Establishes identity in
                a single line instead of a giant centered icon. */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-6 flex items-center gap-3"
            >
              <BrandMark size={42} tone="onDark" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/75">
                AI Tools — Directory
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl"
            >
              AI tools, ranked by{' '}
              <span className="bg-gradient-to-r from-amber-200 via-pink-200 to-fuchsia-200 bg-clip-text text-transparent">
                builders.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.12 }}
              className="mt-5 max-w-xl text-balance text-base leading-relaxed text-white/80 sm:text-lg"
            >
              A live, opinionated catalog of the AI tools worth opening twice.
              Votes are public, the noise gets buried — no SEO-bait listicles,
              no paid placements.
            </motion.p>

            {/* Meta row: Built by + total tracked count.
                Reads like a footer credit instead of an ad. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.22 }}
              className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/70"
            >
              <a
                href="https://taskdriver.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 transition-colors hover:text-white"
              >
                <span className="text-white/55">Built by</span>
                <Image
                  src="/whiteiconbgremove.png"
                  alt=""
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px]"
                />
                <span className="font-medium text-white/95">TaskDriver.ai</span>
              </a>
              {totalTools > 0 ? (
                <>
                  <span aria-hidden className="hidden h-1 w-1 rounded-full bg-white/30 sm:inline-block" />
                  <span className="inline-flex items-center gap-1.5 text-white/75">
                    <span className="tabular-nums font-semibold text-white">
                      {totalTools.toLocaleString()}
                    </span>
                    tools tracked
                  </span>
                </>
              ) : null}
            </motion.div>
          </div>

          {/* ─── Right: live catalog status card ─────────────────────────────
              Tells visitors immediately that this isn't a static dump.
              Compact, glassy, with real numbers and a green LIVE pulse. */}
          <motion.aside
            initial={{ opacity: 0, x: 16, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.18 }}
            className="lg:col-span-5"
            aria-label="Live catalog status"
          >
            <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] p-5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-6">
              {/* Subtle inner top highlight */}
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
                aria-hidden
              />

              {/* Header: LIVE badge + label */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100">
                  <span className="relative flex h-1.5 w-1.5 items-center justify-center" aria-hidden>
                    <span className="live-dot-halo absolute inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300/80" />
                    <span className="live-dot-core relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_6px_rgba(110,231,183,0.95)]" />
                  </span>
                  Live
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/55">
                  Catalog
                </span>
              </div>

              {/* Stats row */}
              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/55">
                    Tracked
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-3xl font-semibold tabular-nums text-white sm:text-4xl">
                      {totalTools > 0 ? totalTools.toLocaleString() : '—'}
                    </span>
                    <span className="text-xs font-medium text-white/55">tools</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/55">
                    Last 24h
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-3xl font-semibold tabular-nums text-white sm:text-4xl">
                      {toolsAddedTodayCount > 0
                        ? `+${toolsAddedTodayCount}`
                        : '—'}
                    </span>
                    <span className="text-xs font-medium text-white/55">added</span>
                  </div>
                </div>
              </div>

              {/* Mini ticker label */}
              <div className="mt-5 flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/55">
                  Recently added
                </span>
                <span className="text-[10px] text-white/40">hover to pause</span>
              </div>

              {/* Embedded recent-tools marquee — uses the same source
                  list as the main ticker; mask edges fade into the card. */}
              <div className="mt-2 -mx-1">
                <RecentToolsTicker tools={tools} limit={12} />
              </div>
            </div>
          </motion.aside>
        </div>
      </div>
    </section>
  )
}
