'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, LayoutDashboard } from 'lucide-react'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useToast } from '@/components/ui/toaster'
import {
  DEFAULT_ASSISTANT_DASHBOARD,
  getAssistantDashboardUrl,
  getAssistantOpenApiUrl,
} from '@/lib/assistant-urls'

export default function AssistantPage() {
  const router = useRouter()
  const { addToast } = useToast()
  const { isReady, session, isAdmin } = useAuthSession()
  const redirectedRef = useRef(false)
  const [mixedContentIframe, setMixedContentIframe] = useState(false)

  const dashboardUrl = getAssistantDashboardUrl()
  const docsUrl = getAssistantOpenApiUrl()

  useEffect(() => {
    if (!isReady || redirectedRef.current) return
    if (!session) {
      redirectedRef.current = true
      router.replace('/')
      return
    }
    if (!isAdmin) {
      redirectedRef.current = true
      addToast({
        variant: 'error',
        title: 'Access denied',
        description: 'Only admins can open the assistant dashboard.',
      })
      router.replace('/')
    }
  }, [isReady, session, isAdmin, router, addToast])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const pageHttps = window.location.protocol === 'https:'
    // Embedding http content in an https page is blocked (mixed content).
    setMixedContentIframe(pageHttps && dashboardUrl.startsWith('http:'))
  }, [dashboardUrl])

  if (!isReady || !session || !isAdmin) {
    return (
      <div className="container mx-auto flex min-h-[50vh] items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="h-7 w-7 text-violet-600 dark:text-violet-400" />
            Personal assistant
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the assistant backend locally (
            <code className="rounded bg-muted px-1 py-0.5 text-xs">python main.py</code> in{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">assistant/backend</code>
            ), then use the frame below or open in a new tab.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="default" className="gap-2">
            <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open dashboard
            </a>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <a href={docsUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              API docs
            </a>
          </Button>
        </div>
      </div>

      {mixedContentIframe ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cannot embed over HTTPS</CardTitle>
            <CardDescription>
              This site is served over HTTPS, but your assistant URL is HTTP. Browsers block that
              inside a frame. Use &quot;Open dashboard&quot; above, run ai-tools locally (
              <code className="text-xs">npm run dev</code> on http://localhost:3000), or serve the
              assistant over HTTPS / same hostname.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
                Open dashboard in new tab
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-lg">
          <iframe
            title="Assistant dashboard"
            src={dashboardUrl}
            className="h-[min(85vh,900px)] w-full border-0 bg-background"
          />
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        URL:{' '}
        <code className="rounded bg-muted px-1 py-0.5">
          {dashboardUrl}
        </code>
        . Override with{' '}
        <code className="rounded bg-muted px-1 py-0.5">
          NEXT_PUBLIC_ASSISTANT_DASHBOARD_URL
        </code>{' '}
        (default{' '}
        <code className="rounded bg-muted px-1 py-0.5">{DEFAULT_ASSISTANT_DASHBOARD}</code>).
      </p>
    </div>
  )
}
