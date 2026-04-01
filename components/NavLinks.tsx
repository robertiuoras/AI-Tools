'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const HOVER_MS = 'duration-500'
const HOVER_EASE = 'ease-out'
const ADMIN_CACHE_KEY = 'auth:isAdmin'

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
  const [isAdmin, setIsAdmin] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(ADMIN_CACHE_KEY) === '1'
    } catch {
      return false
    }
  })
  const isToolsPage = pathname === '/'
  const isVideosPage = pathname === '/videos'
  const isPromptsPage =
    pathname === '/prompts' || pathname.startsWith('/prompts/')
  const isNotesPage = pathname === '/notes'
  const isProjectsPage = pathname === '/projects'
  const isCreatorsView = isVideosPage && searchParams.get('view') === 'creators'

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        if (!cancelled) setIsAdmin(false)
        try {
          localStorage.removeItem(ADMIN_CACHE_KEY)
        } catch {
          // ignore
        }
        return
      }
      try {
        const res = await fetch('/api/auth/check', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json()) as { role?: string }
        const admin = data?.role === 'admin'
        if (!cancelled) setIsAdmin(admin)
        try {
          if (admin) localStorage.setItem(ADMIN_CACHE_KEY, '1')
          else localStorage.removeItem(ADMIN_CACHE_KEY)
        } catch {
          // ignore
        }
      } catch {
        if (!cancelled) setIsAdmin(false)
      }
    }

    void check()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void check()
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

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
      {isAdmin ? (
        <>
          <span
            className="text-muted-foreground/60 px-0.5 font-light"
            aria-hidden
          >
            |
          </span>
          <Link
            href="/projects"
            className={cn(
              linkBase,
              isProjectsPage
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
                : 'text-muted-foreground hover:bg-background/50',
            )}
          >
            <NavLabel
              active={isProjectsPage}
              gradient={{ from: 'from-emerald-500', to: 'to-teal-600' }}
            >
              Projects
            </NavLabel>
          </Link>
        </>
      ) : null}
    </div>
  )
}
