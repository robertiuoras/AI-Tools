"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLocalDateKey } from "@/lib/tool-recent";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ai-tools-new-tools-banner-dismissed-date";

type NewToolsBannerProps = {
  count: number;
  className?: string;
};

export function NewToolsBanner({ count, className }: NewToolsBannerProps) {
  const [mounted, setMounted] = useState(false);
  const [dismissedToday, setDismissedToday] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setDismissedToday(stored === getLocalDateKey());
    } catch {
      setDismissedToday(false);
    }
  }, []);

  const dismiss = () => {
    const today = getLocalDateKey();
    try {
      localStorage.setItem(STORAGE_KEY, today);
    } catch {
      /* ignore */
    }
    setDismissedToday(true);
  };

  if (!mounted || count <= 0 || dismissedToday) return null;

  const noun = count === 1 ? "new tool" : "new tools";

  return (
    <div
      className={cn(
        "group relative mb-4 overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-background px-3 py-2.5 pr-10 shadow-sm dark:border-emerald-400/25 dark:from-emerald-500/20 dark:via-teal-500/15 dark:to-card sm:px-4",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-emerald-400 via-emerald-500 to-teal-500"
      />
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-500 text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)] ring-2 ring-emerald-300/40 dark:ring-emerald-400/30">
          <Sparkles className="h-4 w-4" aria-hidden />
          <span
            aria-hidden
            className="absolute -right-1 -top-1 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.95)] motion-safe:animate-pulse"
          />
        </span>
        <p className="min-w-0 text-sm leading-snug text-foreground">
          <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-bold tabular-nums text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200">
            +{count}
          </span>{" "}
          <span className="font-semibold">{noun}</span>{" "}
          <span className="text-muted-foreground">added today</span>
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={dismiss}
        aria-label="Dismiss new tools notice for today"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
