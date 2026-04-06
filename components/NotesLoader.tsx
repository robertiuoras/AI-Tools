"use client";

import { NotebookPen } from "lucide-react";

/**
 * Full-page notes workspace loader — shown on initial auth + first notes fetch.
 */
export function NotesPageLoader({ message = "Loading workspace…" }: { message?: string }) {
  return (
    <div
      className="flex min-h-[min(70vh,560px)] flex-col items-center justify-center gap-5 px-4 py-24"
      aria-busy
      aria-label={message}
      role="status"
    >
      <span className="sr-only">{message}</span>

      {/* Icon with glow ring */}
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-primary/20 opacity-50 [animation-duration:2s]" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-indigo-500/25">
          <NotebookPen className="h-7 w-7 text-white" strokeWidth={1.75} />
        </div>
      </div>

      {/* Label */}
      <p className="text-sm font-medium text-muted-foreground">{message}</p>

      {/* Progress bar */}
      <div className="h-1.5 w-44 max-w-[85vw] overflow-hidden rounded-full bg-muted">
        <div className="notes-loading-bar h-full w-1/3 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" />
      </div>
    </div>
  );
}

/**
 * Overlay loader — shown when notes are reloading inside an already-visible workspace.
 */
export function NotesOverlayLoader({ message = "Loading notes…" }: { message?: string }) {
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-xl border border-border/50 bg-background/90 p-6 backdrop-blur-sm"
      aria-busy
      aria-label={message}
      role="status"
    >
      <span className="sr-only">{message}</span>

      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 ring-1 ring-indigo-500/20">
        <NotebookPen className="h-5 w-5 text-indigo-500 dark:text-indigo-400" strokeWidth={1.75} />
      </div>

      <div className="h-1.5 w-40 max-w-[85vw] overflow-hidden rounded-full bg-muted">
        <div className="notes-loading-bar h-full w-1/3 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" />
      </div>

      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
