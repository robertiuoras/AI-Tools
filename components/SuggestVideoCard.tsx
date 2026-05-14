'use client'

import { useState } from 'react'
import { Film, Loader2, Send, Youtube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toaster'
import { useAuthSession } from '@/components/AuthSessionProvider'

function detectPlatform(url: string): 'youtube' | 'tiktok' | null {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase()
    if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube'
    if (host.endsWith('tiktok.com')) return 'tiktok'
    return null
  } catch {
    return null
  }
}

export function SuggestVideoCard() {
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { addToast } = useToast()
  const { accessToken } = useAuthSession()

  const platform = url.trim() ? detectPlatform(url.trim()) : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    let parsed: URL
    try {
      parsed = new URL(normalized)
    } catch {
      addToast({
        variant: 'error',
        title: 'Invalid URL',
        description: 'Enter a valid YouTube or TikTok URL.',
      })
      return
    }

    if (!detectPlatform(parsed.toString())) {
      addToast({
        variant: 'error',
        title: 'Unsupported URL',
        description: 'Only YouTube and TikTok video URLs are accepted.',
      })
      return
    }

    setSubmitting(true)
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`

      const r = await fetch('/api/videos/suggest', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: parsed.toString() }),
      })
      const data = (await r.json().catch(() => ({}))) as {
        error?: string
        errorType?: string
        message?: string
        details?: string
        retryAfter?: number
      }

      if (r.status === 409) {
        if (data.error === 'already_exists') {
          addToast({
            variant: 'warning',
            title: 'Already in the list',
            description: data.message || 'This video is already in the curated library.',
          })
        } else {
          addToast({
            variant: 'info',
            title: 'Already suggested',
            description: data.message || 'This video is already in the review queue.',
          })
        }
        return
      }
      if (r.status === 429) {
        addToast({
          variant: 'error',
          title: 'Too many suggestions',
          description: data.details || 'Please wait before submitting again.',
        })
        return
      }
      if (!r.ok) {
        addToast({
          variant: 'error',
          title: 'Could not submit',
          description: data.message || data.error || `Error ${r.status}`,
        })
        return
      }
      addToast({
        variant: 'success',
        title: 'Thanks!',
        description: data.message || 'An admin will review your suggestion.',
      })
      setUrl('')
    } catch {
      addToast({ variant: 'error', title: 'Network error', description: 'Try again in a moment.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur sm:p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Film className="h-4 w-4 text-rose-500" aria-hidden />
        Suggest a video
      </div>
      <p className="mb-3 text-xs text-muted-foreground sm:text-sm">
        Know a great YouTube or TikTok video that belongs here? Paste the URL and we&apos;ll review it.
      </p>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Input
            type="text"
            inputMode="url"
            placeholder="https://youtube.com/watch?v=… or https://tiktok.com/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="pr-20"
            disabled={submitting}
            autoComplete="url"
          />
          {platform && (
            <span
              className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                platform === 'youtube'
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
              }`}
            >
              {platform === 'youtube' ? <Youtube className="h-3 w-3" /> : <Film className="h-3 w-3" />}
              {platform}
            </span>
          )}
        </div>
        <Button type="submit" disabled={submitting || !url.trim()} className="shrink-0 gap-2">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit
        </Button>
      </form>
    </div>
  )
}
