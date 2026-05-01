'use client'

import { useState } from 'react'
import { Lightbulb, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toaster'
import { useAuthSession } from '@/components/AuthSessionProvider'
import Link from 'next/link'

export function SuggestToolCard() {
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { addToast } = useToast()
  const { accessToken } = useAuthSession()

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
        description: 'Enter a valid website like canva.com or https://canva.com',
      })
      return
    }
    setSubmitting(true)
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`
      }
      const r = await fetch('/api/tools/suggest', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: parsed.toString() }),
      })
      const data = (await r.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }
      if (r.status === 409) {
        if (data.error === 'already_exists') {
          addToast({
            variant: 'warning',
            title: 'Already in the directory',
            description:
              data.message ||
              'Search the homepage for this tool — it may already be listed.',
          })
        } else {
          addToast({
            variant: 'info',
            title: 'Already suggested',
            description: data.message || 'This URL is already in the review queue.',
          })
        }
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
        description:
          data.message || 'An admin will review your suggestion.',
      })
      setUrl('')
    } catch {
      addToast({
        variant: 'error',
        title: 'Network error',
        description: 'Try again in a moment.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur sm:p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />
        Suggest a tool
      </div>
      <p className="mb-3 text-xs text-muted-foreground sm:text-sm">
        Missing something? Paste a website URL. If it&apos;s new, we&apos;ll queue it for review.
        If it&apos;s already listed, use{' '}
        <Link href="/" className="font-medium text-primary underline-offset-2 hover:underline">
          search
        </Link>{' '}
        to find it.
      </p>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          inputMode="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1"
          disabled={submitting}
          autoComplete="url"
        />
        <Button type="submit" disabled={submitting || !url.trim()} className="shrink-0 gap-2">
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Submit
        </Button>
      </form>
    </div>
  )
}
