import { cn } from '@/lib/utils'
import { normalizeToolCategory } from '@/lib/schemas'

/** Tailwind classes for category badges — shared by ToolCard and admin. */
export const toolCategoryBadgeClassName = (category: string): string => {
  const key = normalizeToolCategory(category)
  const map: Record<string, string> = {
    'AI Agents': 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/25',
    'AI Automation':
      'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/25',
    Agencies:
      'bg-violet-600/10 text-violet-800 dark:text-violet-300 border-violet-500/30',
    Analytics:
      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
    'Code Assistants':
      'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/25',
    'Customer Support':
      'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25',
    Design: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25',
    Education: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/25',
    'Image Generation':
      'bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/25',
    Insurance:
      'bg-cyan-950/20 text-cyan-900 dark:text-cyan-300 border-cyan-600/35',
    Job: 'bg-stone-500/10 text-stone-800 dark:text-stone-300 border-stone-500/25',
    Language:
      'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400 border-fuchsia-500/25',
    Legal: 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/25',
    Marketing:
      'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/25',
    'Music & Audio':
      'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25',
    News: 'bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/25',
    Other: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/25',
    Productivity:
      'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/25',
    Research: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25',
    SaaS: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/25',
    'Video Editing':
      'bg-sky-950/20 text-sky-900 dark:text-sky-300 border-sky-600/35',
    'Voice & Audio':
      'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/25',
    Writing: 'bg-lime-500/10 text-lime-800 dark:text-lime-400 border-lime-500/25',
  }
  return map[key] ?? map.Other
}

/** Outline badge wrapper (matches home ToolCard + admin). */
export function toolCategoryBadgeClass(category: string): string {
  return cn(
    'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize',
    toolCategoryBadgeClassName(category),
  )
}
