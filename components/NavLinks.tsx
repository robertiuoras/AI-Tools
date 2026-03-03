'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

export function NavLinks() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isToolsPage = pathname === '/'
  const isVideosPage = pathname === '/videos'
  const isCreatorsView = isVideosPage && searchParams.get('view') === 'creators'

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
      <Link
        href="/"
        className={cn(
          'rounded-md px-4 py-2 text-sm font-semibold transition-all',
          isToolsPage
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
            : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
        )}
      >
        <span
          className={cn(
            isToolsPage && 'bg-gradient-to-r from-indigo-600 to-pink-600 bg-clip-text text-transparent'
          )}
        >
          AI Tools
        </span>
      </Link>
      <span className="text-muted-foreground/60 px-0.5 font-light" aria-hidden>
        |
      </span>
      <Link
        href="/videos"
        className={cn(
          'rounded-md px-4 py-2 text-sm font-semibold transition-all',
          isVideosPage && !isCreatorsView
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
            : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
        )}
      >
        <span
          className={cn(
            isVideosPage && !isCreatorsView && 'bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-transparent'
          )}
        >
          Videos
        </span>
      </Link>
      <span className="text-muted-foreground/60 px-0.5 font-light" aria-hidden>
        |
      </span>
      <Link
        href="/videos?view=creators"
        className={cn(
          'rounded-md px-4 py-2 text-sm font-semibold transition-all',
          isCreatorsView
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
            : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
        )}
      >
        <span
          className={cn(
            isCreatorsView && 'bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-transparent'
          )}
        >
          Creators
        </span>
      </Link>
    </div>
  )
}
