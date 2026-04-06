'use client'

import { motion } from 'framer-motion'
import { CalendarDays, Sparkles } from 'lucide-react'

import Image from "next/image";

type HeroProps = {
  /** Shown as a prominent pill under the headline when &gt; 0 */
  toolsAddedTodayCount?: number
}

export function Hero({ toolsAddedTodayCount = 0 }: HeroProps) {
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 dark:from-indigo-900 dark:via-purple-900 dark:to-pink-900">
      <div className="absolute inset-0 bg-grid-white/[0.05] bg-[size:20px_20px]" />
      <div className="relative mx-auto max-w-7xl px-6 pb-24 pt-16 sm:px-6 sm:pb-32 sm:pt-24 lg:px-8 lg:pt-32">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mb-8 flex justify-center"
          >
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-white/20 blur-xl" />
              <div className="relative rounded-full bg-white/10 p-4 backdrop-blur-sm">
                <Sparkles className="h-12 w-12 text-white" />
              </div>
            </div>
          </motion.div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Discover the Best
            <span className="block bg-gradient-to-r from-pink-200 to-yellow-200 bg-clip-text text-transparent">
              AI Tools
            </span>
          </h1>
          <p className="mt-6 text-lg leading-8 text-white/90 sm:text-xl">
            Curated collection of cutting-edge AI tools. Find the perfect solution
            for your workflow, from video editing to code assistance.
          </p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-8 flex items-center justify-center gap-2 text-base text-white/80"
          >
            <span className="text-lg">Built by</span>
            <a
              href="https://taskdriver.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 transition-opacity hover:opacity-80"
            >
              <Image
                src="/whiteiconbgremove.png"
                alt="TaskDriver"
                width={24}
                height={24}
                className="h-6 w-6"
              />
              <span className="text-lg font-medium text-white">TaskDriver.ai</span>
            </a>
          </motion.div>
          {toolsAddedTodayCount > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.38 }}
              className="mt-7 flex justify-center px-2"
            >
              <div
                className="relative max-w-md rounded-2xl border border-white/25 bg-white/[0.12] p-[1px] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur-md"
                role="status"
              >
                <div className="rounded-2xl bg-gradient-to-br from-white/20 via-white/5 to-transparent px-4 py-3.5 sm:px-5 sm:py-4">
                  <div className="flex items-center gap-3.5 sm:gap-4">
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 via-orange-300 to-rose-400 text-amber-950 shadow-inner ring-2 ring-white/40 sm:h-12 sm:w-12">
                      <CalendarDays className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70 sm:text-[11px]">
                        Fresh picks
                      </p>
                      <p className="mt-0.5 text-base font-semibold leading-snug text-white sm:text-lg">
                        <span className="tabular-nums">
                          {toolsAddedTodayCount} new tool
                          {toolsAddedTodayCount !== 1 ? 's' : ''}
                        </span>
                        <span className="font-normal text-white/90"> today</span>
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-white/75 sm:text-sm">
                        Added in the last 24 hours — worth a look.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}
        </motion.div>
      </div>
    </div>
  )
}

