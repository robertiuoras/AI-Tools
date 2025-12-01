import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AuthButton } from '@/components/AuthButton'
import { ToastProvider } from '@/components/ui/toaster'
import Link from 'next/link'

const inter = Inter({ subsets: ['latin'] })

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
      <body className={inter.className}>
        <ToastProvider>
          <div className="min-h-screen bg-background">
            <nav className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="container flex h-16 items-center justify-between px-4">
                <Link href="/" className="flex items-center space-x-2">
                  <span className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-pink-600 bg-clip-text text-transparent">
                    AI Tools
                  </span>
                </Link>
                <div className="flex items-center gap-4">
                  <AuthButton />
                  <ThemeToggle />
                </div>
              </div>
            </nav>
            {children}
          </div>
          <Analytics />
          <SpeedInsights />
        </ToastProvider>
      </body>
    </html>
  )
}

