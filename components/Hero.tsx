'use client'

import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

export function Hero() {
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
        </motion.div>
      </div>
    </div>
  )
}

