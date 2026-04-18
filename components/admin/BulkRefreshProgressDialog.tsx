'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Loader2, StopCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDurationMs, formatUsdEstimate } from '@/lib/admin-openai-cost'

export type BulkRefreshProgressState = {
  total: number
  currentIndex: number
  currentTitle: string
  completed: number
  succeeded: number
  failed: number
  startedAt: number
  /** Live USD spend so far. Updated after each completed item. */
  costUsd?: number
  /** Set to true when user clicks Stop; the loop should break before the next item. */
  stopRequested?: boolean
}

type BulkRefreshProgressDialogProps = {
  open: boolean
  busy: boolean
  progress: BulkRefreshProgressState | null
  title: string
  tick: number
  onOpenChange: (open: boolean) => void
  /** Called when user clicks Stop. Optional; if omitted the Stop button is hidden. */
  onStop?: () => void
}

export function BulkRefreshProgressDialog({
  open,
  busy,
  progress,
  title,
  tick,
  onOpenChange,
  onStop,
}: BulkRefreshProgressDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return
        if (!next) onOpenChange(false)
      }}
    >
      <DialogContent
        className={cn('sm:max-w-lg', busy && '[&>button]:hidden')}
        onPointerDownOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        {progress ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-8">
                {busy ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                ) : progress.failed === 0 ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0 text-amber-500" />
                )}
                <span>{title}</span>
              </DialogTitle>
              <DialogDescription className="sr-only">
                Bulk re-analyze progress: {progress.completed} of {progress.total} completed.
                Current: {progress.currentTitle}
              </DialogDescription>
            </DialogHeader>
            {(() => {
              const p = progress
              const elapsed = Date.now() - p.startedAt
              const pct =
                p.total > 0
                  ? Math.min(100, Math.round((p.completed / p.total) * 100))
                  : 0
              const etaMs =
                p.completed > 0 && p.completed < p.total
                  ? (elapsed / p.completed) * (p.total - p.completed)
                  : null
              const itemsPerMin =
                p.completed > 0 && elapsed > 0
                  ? (p.completed / (elapsed / 60_000))
                  : 0
              const cost = p.costUsd ?? 0
              const isFinished = p.completed >= p.total
              const stopped = p.stopRequested === true

              return (
                <div
                  className="space-y-4"
                  aria-live="polite"
                  data-refresh-tick={tick}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                      <span>{p.completed}</span>
                      <span className="text-muted-foreground"> / {p.total}</span>
                    </p>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {isFinished ? (stopped ? 'Stopped' : 'Done') : `${pct}%`}
                    </p>
                  </div>

                  {/* progress bar — gradient + animated shimmer while running */}
                  <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 transition-[width] duration-500 ease-out',
                        busy && !isFinished && 'animate-[pulse_1.6s_ease-in-out_infinite]',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {busy ? 'Now processing' : 'Last processed'}
                    </div>
                    <div
                      className="line-clamp-2 font-medium leading-snug"
                      title={p.currentTitle}
                    >
                      {p.currentTitle || '—'}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat
                      label="Elapsed"
                      value={formatDurationMs(elapsed)}
                    />
                    <Stat
                      label="ETA"
                      value={
                        etaMs != null && Number.isFinite(etaMs)
                          ? formatDurationMs(etaMs)
                          : '—'
                      }
                    />
                    <Stat
                      label="Speed"
                      value={
                        itemsPerMin > 0
                          ? `${itemsPerMin.toFixed(1)}/min`
                          : '—'
                      }
                    />
                    <Stat
                      label="Cost"
                      value={cost > 0 ? formatUsdEstimate(cost) : '~$0'}
                      accent={cost > 0 ? 'text-emerald-600 dark:text-emerald-400' : undefined}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs">
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="font-medium text-foreground">{p.succeeded}</span>{' '}
                        ok
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            p.failed > 0 ? 'bg-red-500' : 'bg-muted',
                          )}
                        />
                        <span
                          className={cn(
                            'font-medium',
                            p.failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground',
                          )}
                        >
                          {p.failed}
                        </span>{' '}
                        failed
                      </span>
                    </div>
                    {busy && onStop && !stopped && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onStop}
                        className="h-7 gap-1.5 px-2 text-xs"
                      >
                        <StopCircle className="h-3.5 w-3.5" />
                        Stop after current
                      </Button>
                    )}
                  </div>
                </div>
              )
            })()}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'font-mono text-sm font-semibold tabular-nums leading-tight',
          accent,
        )}
      >
        {value}
      </div>
    </div>
  )
}
