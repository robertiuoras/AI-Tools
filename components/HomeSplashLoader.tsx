"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type HomeSplashLoaderProps = {
  /** When false, overlay fades out (parent should unmount after ~500ms). */
  loading: boolean;
};

/** Fast linear ramp, then slow crawl so the bar never looks stuck before data arrives. */
function progressValue(elapsedMs: number): number {
  const fastMs = 700;
  const cap = 98;
  if (elapsedMs < fastMs) {
    return (elapsedMs / fastMs) * cap;
  }
  return Math.min(99.6, cap + ((elapsedMs - fastMs) / 3500) * 1.6);
}

export function HomeSplashLoader({ loading }: HomeSplashLoaderProps) {
  const [barPct, setBarPct] = useState(0);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setBarPct(100);
      return;
    }
    setBarPct(0);
    const t0 = performance.now();
    const id = setInterval(() => {
      const elapsed = performance.now() - t0;
      setBarPct(progressValue(elapsed));
    }, 32);
    return () => clearInterval(id);
  }, [loading]);

  const rounded = Math.min(100, Math.round(barPct));
  const widthPct = `${Math.min(100, barPct)}%`;
  const fillClass =
    "h-full min-w-0 rounded-full bg-gradient-to-r from-primary via-accent to-secondary transition-[width] duration-200 ease-out";

  return (
    <div
      role="status"
      aria-busy={loading}
      aria-live="polite"
      className={cn(
        "fixed inset-0 z-[9999] flex flex-col bg-background transition-opacity duration-500 ease-out print:hidden",
        loading ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <span className="sr-only">Loading AI tools catalog</span>

      <div className="pointer-events-none absolute inset-0 bg-background" aria-hidden />

      <div
        className="pointer-events-none absolute -left-[20%] top-1/4 h-[min(80vw,28rem)] w-[min(80vw,28rem)] rounded-full bg-primary/25 blur-3xl home-splash-blob"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-[15%] bottom-1/4 h-[min(70vw,24rem)] w-[min(70vw,24rem)] rounded-full bg-accent/20 blur-3xl home-splash-blob-delayed"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[min(90vw,32rem)] w-[min(90vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-secondary/15 blur-[100px] home-splash-blob-slow"
        aria-hidden
      />

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-card/80 p-10 shadow-2xl shadow-primary/10 backdrop-blur-xl dark:bg-card/65">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-primary/20 opacity-40 [animation-duration:2.2s]" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent shadow-lg">
                <Sparkles className="h-8 w-8 text-primary-foreground" strokeWidth={1.75} />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="bg-gradient-to-r from-foreground via-primary to-accent bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
                AI Tools
              </h2>
              <p className="text-sm text-muted-foreground">
                Loading the catalog from the database…
              </p>
            </div>

            <div className="w-full space-y-2">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={rounded}
                className="h-2.5 w-full overflow-hidden rounded-full bg-muted shadow-inner"
              >
                <div className={fillClass} style={{ width: widthPct }} />
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">{rounded}%</p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="relative z-[2] w-full shrink-0 border-t border-border/40 bg-muted/90 shadow-[0_-12px_40px_-12px_rgba(99,102,241,0.12)] backdrop-blur-sm dark:shadow-[0_-12px_40px_-12px_rgba(167,139,250,0.1)]"
        aria-hidden
      >
        <div className="relative h-3 w-full overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-muted via-muted/50 to-muted" />
          <div
            className="relative h-full overflow-hidden rounded-r-full shadow-[0_0_24px_rgba(99,102,241,0.45)]"
            style={{ width: widthPct }}
          >
            <div className="h-full w-full bg-gradient-to-r from-primary via-accent to-secondary" />
          </div>
        </div>
      </div>
    </div>
  );
}
