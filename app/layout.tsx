import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AuthButton } from '@/components/AuthButton'
import { ToastProvider } from '@/components/ui/toaster'
import { NavLinks } from '@/components/NavLinks'
import { AdminNavLink } from '@/components/AdminNavLink'
import { ToolsCatalogProvider } from '@/components/ToolsCatalogProvider'
import { AuthSessionProvider } from '@/components/AuthSessionProvider'

const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'] })

export const metadata: Metadata = {
  title: 'AI Tools Directory - Discover the Best AI Tools',
  description: 'Curated collection of cutting-edge AI tools for your workflow',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={plusJakartaSans.className} suppressHydrationWarning>
        <ToastProvider>
          <AuthSessionProvider>
          <ToolsCatalogProvider>
            <div className="min-h-screen bg-background">
              <nav className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container flex h-16 items-center justify-between px-4">
                  <Suspense fallback={<div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 px-4 py-2 text-sm text-muted-foreground">AI Tools | Videos | Creators | Prompts | Notes</div>}>
                    <NavLinks />
                  </Suspense>
                  <div className="flex items-center gap-4">
                    <AdminNavLink />
                    <AuthButton />
                    <ThemeToggle />
                  </div>
                </div>
              </nav>
              {children}
            </div>
          </ToolsCatalogProvider>
          </AuthSessionProvider>
          <Analytics />
          <SpeedInsights />
        </ToastProvider>
      </body>
    </html>
  )
}

