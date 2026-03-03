'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function AdminNavLink() {
  const pathname = usePathname()
  const isAdmin = pathname === '/admin'

  return (
    <Link
      href="/admin"
      className={cn(
        'text-sm font-medium transition-colors',
        isAdmin
          ? 'text-foreground relative'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <span
        className={cn(
          isAdmin &&
            'bg-gradient-to-r from-amber-400 to-rose-500 bg-clip-text text-transparent'
        )}
      >
        Admin
      </span>
      {isAdmin && (
        <span className="pointer-events-none absolute inset-x-0 -bottom-1 h-px bg-gradient-to-r from-amber-400/60 via-rose-500/60 to-purple-500/60 blur-[1px]" />
      )}
    </Link>
  )
}

