'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDurationMs } from '@/lib/admin-openai-cost'

export type BulkRefreshProgressState = {
  total: number
  currentIndex: number
  currentTitle: string
  completed: number
  succeeded: number
  failed: number
  startedAt: number
}

type BulkRefreshProgressDialogProps = {
  open: boolean
  busy: boolean
  progress: BulkRefreshProgressState | null
  title: string
  tick: number
  onOpenChange: (open: boolean) => void
}

export function BulkRefreshProgressDialog({
  open,
  busy,
  progress,
  title,
  tick,
  onOpenChange,
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
        className={cn('sm:max-w-md', busy && '[&>button]:hidden')}
        onPointerDownOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        {progress ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-8">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                {title}
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
              return (
                <div
                  className="space-y-4"
                  aria-live="polite"
                  data-refresh-tick={tick}
                >
                  <p className="text-center text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                    {p.completed} / {p.total}
                  </p>
                  <p className="text-sm leading-snug text-muted-foreground">
                    <span className="font-medium text-foreground">Now processing:</span>{' '}
                    <span className="line-clamp-2" title={p.currentTitle}>
                      {p.currentTitle || '—'}
                    </span>
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Overall progress</span>
                      <span className="tabular-nums">{pct}%</span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-300 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Elapsed</div>
                      <div className="font-mono text-sm font-medium tabular-nums">
                        {formatDurationMs(elapsed)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Est. remaining</div>
                      <div className="font-mono text-sm font-medium tabular-nums">
                        {etaMs != null && Number.isFinite(etaMs)
                          ? formatDurationMs(etaMs)
                          : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-center gap-6 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <span>
                      <span className="font-medium text-foreground">{p.succeeded}</span> ok
                    </span>
                    <span>
                      <span className="font-medium text-foreground">{p.failed}</span> failed
                    </span>
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
