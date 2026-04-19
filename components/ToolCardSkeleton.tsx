/**
 * Structured skeleton placeholders for ToolCard (grid and list layouts).
 * Mirrors the real card's inner layout so the UI doesn't jump when content
 * arrives, and uses a staggered fade-in (`skeleton-card-enter`) so the
 * loading state feels like content streaming in rather than a single
 * bulk paint.
 */

import type { CSSProperties } from "react";

type SkeletonProps = {
  /**
   * Card position in the loading grid. Drives the stagger delay so the
   * first row paints in instantly and following rows ripple in. Wraps
   * around every 8 cards to keep the visible delay short even on long
   * grids.
   */
  index?: number;
};

function staggerStyle(index: number): CSSProperties {
  return { ["--i" as string]: index % 8 } as CSSProperties;
}

export function ToolCardGridSkeleton({ index = 0 }: SkeletonProps = {}) {
  return (
    <div
      className="skeleton-card-enter flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card"
      style={staggerStyle(index)}
      aria-hidden
    >
      {/* Logo + title + badge */}
      <div className="flex flex-col items-center gap-3 px-5 pb-3 pt-5">
        <div className="skeleton-wave h-14 w-14 rounded-xl" />
        <div className="w-full space-y-2">
          <div className="skeleton-wave mx-auto h-4 w-3/4 rounded" />
          <div className="skeleton-wave mx-auto h-4 w-1/2 rounded" />
        </div>
        <div className="skeleton-wave h-5 w-20 rounded-full" />
      </div>

      {/* Description lines */}
      <div className="flex-1 space-y-2 px-5 py-3">
        <div className="skeleton-wave h-3 w-full rounded" />
        <div className="skeleton-wave h-3 w-5/6 rounded" />
        <div className="skeleton-wave h-3 w-4/5 rounded" />
        <div className="skeleton-wave h-3 w-2/3 rounded" />
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-center gap-3 px-5 pb-2">
        <div className="skeleton-wave h-3.5 w-16 rounded" />
        <div className="skeleton-wave h-3.5 w-12 rounded" />
      </div>

      {/* Footer button */}
      <div className="border-t border-border/40 px-5 py-3.5">
        <div className="skeleton-wave mx-auto h-8 w-2/3 rounded-md" />
      </div>
    </div>
  );
}

export function ToolCardListSkeleton({ index = 0 }: SkeletonProps = {}) {
  return (
    <div
      className="skeleton-card-enter flex items-center gap-4 rounded-lg border border-border/50 bg-card px-4 py-3"
      style={staggerStyle(index)}
      aria-hidden
    >
      {/* Logo */}
      <div className="skeleton-wave h-10 w-10 shrink-0 rounded-lg" />

      {/* Name + description */}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton-wave h-4 w-1/3 rounded" />
        <div className="skeleton-wave h-3 w-2/3 rounded" />
      </div>

      {/* Actions */}
      <div className="flex shrink-0 gap-2">
        <div className="skeleton-wave h-8 w-14 rounded" />
        <div className="skeleton-wave h-8 w-14 rounded" />
        <div className="skeleton-wave h-8 w-16 rounded" />
      </div>
    </div>
  );
}
