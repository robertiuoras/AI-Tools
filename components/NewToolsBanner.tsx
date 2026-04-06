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

  const label =
    count === 1 ? "1 new tool was added today" : `${count} new tools added today`;

  return (
    <div
      className={cn(
        "relative mb-4 flex items-start gap-3 rounded-xl border border-violet-500/25 bg-gradient-to-r from-violet-500/15 via-indigo-500/10 to-background px-3 py-2.5 pr-10 shadow-sm dark:from-violet-500/20 dark:via-indigo-500/15 dark:to-card sm:items-center sm:gap-4 sm:px-4",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center sm:gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600/20 text-violet-700 dark:bg-violet-500/25 dark:text-violet-200">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <p className="min-w-0 text-sm font-semibold leading-snug text-foreground">
          {label}
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
