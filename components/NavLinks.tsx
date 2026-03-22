'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

const HOVER_MS = 'duration-500'
const HOVER_EASE = 'ease-out'

type GradientSpec = {
  from: string
  to: string
}

function NavLabel({
  active,
  children,
  gradient,
}: {
  active: boolean
  children: ReactNode
  gradient: GradientSpec
}) {
  const g = `bg-gradient-to-r ${gradient.from} ${gradient.to} bg-clip-text text-transparent`

  if (active) {
    return (
      <span className={cn('font-semibold', g)}>{children}</span>
    )
  }

  return (
    <span className="relative inline-grid place-items-center font-semibold [grid-template-areas:'stack']">
      <span
        className={cn(
          '[grid-area:stack] text-muted-foreground transition-opacity',
          HOVER_MS,
          HOVER_EASE,
          'group-hover:opacity-0',
        )}
      >
        {children}
      </span>
      <span
        className={cn(
          '[grid-area:stack] opacity-0 transition-opacity',
          HOVER_MS,
          HOVER_EASE,
          'group-hover:opacity-100',
          g,
        )}
        aria-hidden
      >
        {children}
      </span>
    </span>
  )
}

export function NavLinks() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isToolsPage = pathname === '/'
  const isVideosPage = pathname === '/videos'
  const isPromptsPage =
    pathname === '/prompts' || pathname.startsWith('/prompts/')
  const isNotesPage = pathname === '/notes'
  const isCreatorsView = isVideosPage && searchParams.get('view') === 'creators'

  const linkBase =
    'group rounded-md px-4 py-2 text-sm font-semibold transition-colors ' +
    `${HOVER_MS} ${HOVER_EASE}`

  return (
    <div
      data-tutorial="main-nav-links"
      className="flex items-center gap-1 rounded-lg bg-muted/50 p-1"
    >
      <Link
        href="/"
        className={cn(
          linkBase,
          isToolsPage
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
            : 'text-muted-foreground hover:bg-background/50',
        )}
      >
        <NavLabel
          active={isToolsPage}
          gradient={{ from: 'from-indigo-600', to: 'to-pink-600' }}
        >
          AI Tools
        </NavLabel>
      </Link>
      <span className="text-muted-foreground/60 px-0.5 font-light" aria-hidden>
        |
      </span>
      <Link
        href="/videos"
        className={cn(
          linkBase,
          isVideosPage && !isCreatorsView
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
            : 'text-muted-foreground hover:bg-background/50',
        )}
      >
        <NavLabel
          active={isVideosPage && !isCreatorsView}
          gradient={{ from: 'from-rose-500', to: 'to-orange-500' }}
        >
          Videos
        </NavLabel>
      </Link>
      <span className="text-muted-foreground/60 px-0.5 font-light" aria-hidden>
        |
      </span>
      <Link
        href="/videos?view=creators"
        className={cn(
          linkBase,
          isCreatorsView
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
            : 'text-muted-foreground hover:bg-background/50',
        )}
      >
        <NavLabel
          active={isCreatorsView}
          gradient={{ from: 'from-rose-500', to: 'to-orange-500' }}
        >
          Creators
        </NavLabel>
      </Link>
      <span className="text-muted-foreground/60 px-0.5 font-light" aria-hidden>
        |
      </span>
      <Link
        href="/prompts"
        className={cn(
          linkBase,
          isPromptsPage
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
            : 'text-muted-foreground hover:bg-background/50',
        )}
      >
        <NavLabel
          active={isPromptsPage}
          gradient={{ from: 'from-cyan-500', to: 'to-violet-600' }}
        >
          Prompts
        </NavLabel>
      </Link>
      <span className="text-muted-foreground/60 px-0.5 font-light" aria-hidden>
        |
      </span>
      <Link
        href="/notes"
        className={cn(
          linkBase,
          isNotesPage
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
            : 'text-muted-foreground hover:bg-background/50',
        )}
      >
        <NavLabel
          active={isNotesPage}
          gradient={{ from: 'from-violet-500', to: 'to-indigo-500' }}
        >
          Notes
        </NavLabel>
      </Link>
    </div>
  )
}
