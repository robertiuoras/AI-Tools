"use client";

import { cn } from "@/lib/utils";

type LiveSyncBadgeProps = {
  /** Body text shown in the pill. Defaults to "Syncing catalog". */
  label?: string;
  /** Optional className override for outer pill. */
  className?: string;
};

/**
 * Compact "live data" status pill — pulsing dot, gradient text shimmer,
 * and a conic-gradient tracer arc. Designed to feel like a developer-tool
 * status indicator (Linear / Vercel / Stripe Dashboard) rather than a
 * generic AI spinner.
 *
 * Prefer this over plain "Updating…" text for any background refresh state.
 */
export function LiveSyncBadge({
  label = "Syncing catalog",
  className,
}: LiveSyncBadgeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pill-rise inline-flex select-none items-center gap-2 rounded-full",
        "border border-indigo-500/25 bg-indigo-500/[0.06] px-2.5 py-1",
        "text-[11px] font-medium tracking-wide text-foreground/75",
        "shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_4px_14px_-6px_rgba(99,102,241,0.35)]",
        "backdrop-blur-md",
        "dark:border-indigo-400/30 dark:bg-indigo-400/[0.08]",
        "dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_4px_18px_-8px_rgba(129,140,248,0.55)]",
        className,
      )}
    >
      {/* Live status dot — halo ring + animated core */}
      <span
        className="relative flex h-2 w-2 items-center justify-center"
        aria-hidden
      >
        <span
          className="live-dot-halo absolute inline-flex h-2 w-2 rounded-full bg-indigo-500/60 dark:bg-indigo-400/55"
        />
        <span
          className="live-dot-core relative inline-flex h-2 w-2 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 shadow-[0_0_8px_rgba(99,102,241,0.85)]"
        />
      </span>

      {/* Shimmering text — gradient pans through the label like data flow */}
      <span
        className={cn(
          "sync-shimmer-text bg-clip-text text-transparent",
          "bg-gradient-to-r from-foreground/55 via-foreground to-foreground/55",
        )}
      >
        {label}
      </span>

      {/* Custom conic tracer arc — distinctive vs typical loader spinners */}
      <span className="relative h-3 w-3" aria-hidden>
        <span className="conic-spinner absolute inset-0 rounded-full" />
      </span>
    </div>
  );
}
