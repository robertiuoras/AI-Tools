"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronUp, Sparkles, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { getLocalDateKey } from "@/lib/tool-recent";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ai-tools-new-tools-banner-dismissed-date";

const noopSubscribe = () => () => {};

function useLocalStorageItem(key: string): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => { try { return localStorage.getItem(key) } catch { return null } },
    () => null,
  );
}

type NewTool = {
  id: string;
  name: string;
  logoUrl: string | null;
};

type NewToolsBannerProps = {
  count: number;
  tools: NewTool[];
  className?: string;
};

export function NewToolsBanner({ count, tools, className }: NewToolsBannerProps) {
  const stored = useLocalStorageItem(STORAGE_KEY);
  const [manuallyDismissed, setManuallyDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  const dismissedToday = stored === getLocalDateKey();

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { localStorage.setItem(STORAGE_KEY, getLocalDateKey()); } catch { /* ignore */ }
    setManuallyDismissed(true);
  };

  const scrollToTool = (id: string) => {
    const el = document.getElementById(`tool-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (count <= 0 || dismissedToday || manuallyDismissed) return null;

  const noun = count === 1 ? "new tool" : "new tools";

  return (
    <div
      className={cn(
        "relative mb-4 overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-background shadow-sm dark:border-emerald-400/25 dark:from-emerald-500/20 dark:via-teal-500/15 dark:to-card",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {/* Left accent bar */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-emerald-400 via-emerald-500 to-teal-500"
      />

      {/* Clickable header row */}
      <button
        type="button"
        className="flex w-full items-center gap-3 py-2.5 pl-12 pr-4 text-left sm:gap-4 sm:pl-14"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Collapse new tools list" : "Expand new tools list"}
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-500 text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)] ring-2 ring-emerald-300/40 dark:ring-emerald-400/30">
          <Sparkles className="h-4 w-4" aria-hidden />
          <span
            aria-hidden
            className="absolute -right-1 -top-1 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.95)] motion-safe:animate-pulse"
          />
        </span>
        <p className="min-w-0 flex-1 text-sm leading-snug text-foreground">
          <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-bold tabular-nums text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200">
            +{count}
          </span>{" "}
          <span className="font-semibold">{noun}</span>{" "}
          <span className="text-muted-foreground">added today</span>
        </p>
        <ChevronUp
          className={cn(
            "mr-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-in-out",
            open ? "rotate-0" : "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {/* Expandable dropdown */}
      <div
        className={cn(
          "grid transition-all duration-300 ease-in-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-0.5 border-t border-emerald-500/20 px-3 pb-2 pt-1.5 sm:px-4">
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => scrollToTool(tool.id)}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {tool.logoUrl ? (
                  <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded">
                    <Image
                      src={tool.logoUrl}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="24px"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
                    {tool.name.charAt(0)}
                  </div>
                )}
                <span className="font-medium text-foreground">{tool.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dismiss */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute left-1.5 top-1.5 h-8 w-8 shrink-0 text-muted-foreground hover:text-red-500"
        onClick={dismiss}
        aria-label="Dismiss new tools notice for today"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
