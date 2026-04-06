"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type HomeSplashLoaderProps = {
  /** When false, overlay fades out (parent should unmount after ~500ms). */
  loading: boolean;
};

const LOADING_MESSAGES = [
  "Fetching AI tools…",
  "Sorting by popularity…",
  "Building catalog…",
  "Almost ready…",
];

/** Fast linear ramp, then slow crawl so the bar never looks stuck before data arrives. */
function progressValue(elapsedMs: number): number {
  const fastMs = 700;
  const cap = 88;
  if (elapsedMs < fastMs) {
    return (elapsedMs / fastMs) * cap;
  }
  return Math.min(99.6, cap + ((elapsedMs - fastMs) / 3500) * 11.6);
}

export function HomeSplashLoader({ loading }: HomeSplashLoaderProps) {
  const [barPct, setBarPct] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);
  const [msgVisible, setMsgVisible] = useState(true);

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
      setBarPct(progressValue(performance.now() - t0));
    }, 32);
    return () => clearInterval(id);
  }, [loading]);

  // Cycle messages with a fade-out/in crossfade
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setMsgVisible(false);
      setTimeout(() => {
        setMsgIdx((i) => (i + 1) % LOADING_MESSAGES.length);
        setMsgVisible(true);
      }, 250);
    }, 2000);
    return () => clearInterval(id);
  }, [loading]);

  const rounded = Math.min(100, Math.round(barPct));
  const widthPct = `${Math.min(100, barPct)}%`;

  return (
    <div
      role="status"
      aria-busy={loading}
      aria-live="polite"
      className={cn(
        "fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background transition-opacity duration-500 ease-out print:hidden",
        loading ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <span className="sr-only">Loading AI tools catalog</span>

      {/* Ambient background blobs */}
      <div
        className="pointer-events-none absolute -left-[20%] top-1/4 h-[min(80vw,28rem)] w-[min(80vw,28rem)] rounded-full bg-indigo-500/20 blur-3xl home-splash-blob"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-[15%] bottom-1/4 h-[min(70vw,24rem)] w-[min(70vw,24rem)] rounded-full bg-violet-500/15 blur-3xl home-splash-blob-delayed"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[min(90vw,32rem)] w-[min(90vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/10 blur-[100px] home-splash-blob-slow"
        aria-hidden
      />

      {/* Glass card */}
      <div className="relative z-[1] w-full max-w-[22rem] px-5">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/70 p-10 shadow-2xl shadow-black/10 backdrop-blur-2xl dark:border-white/8 dark:bg-white/5">

          {/* Top inner highlight line */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
            aria-hidden
          />

          <div className="flex flex-col items-center gap-8 text-center">

            {/* Icon with orbit ring + pulse */}
            <div className="relative flex h-24 w-24 items-center justify-center">
              {/* Slow spinning dashed orbit */}
              <div
                className="absolute inset-0 animate-spin rounded-full border border-dashed border-indigo-400/40 dark:border-indigo-400/30"
                style={{ animationDuration: "9s" }}
                aria-hidden
              />
              {/* Ping pulse */}
              <div
                className="absolute h-16 w-16 animate-ping rounded-full bg-indigo-500/12 dark:bg-indigo-400/10"
                style={{ animationDuration: "2.2s" }}
                aria-hidden
              />
              {/* Icon button */}
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 shadow-lg shadow-indigo-500/35">
                <Sparkles className="h-8 w-8 text-white" strokeWidth={1.75} />
              </div>
            </div>

            {/* Title + cycling message */}
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                AI Tools
              </h2>
              <p
                className="min-h-[1.25rem] text-sm text-muted-foreground transition-opacity duration-250"
                style={{ opacity: msgVisible ? 1 : 0 }}
              >
                {loading ? LOADING_MESSAGES[msgIdx] : "Ready!"}
              </p>
            </div>

            {/* Progress bar + percentage */}
            <div className="w-full space-y-2.5">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={rounded}
                className="h-1.5 w-full overflow-hidden rounded-full bg-black/8 dark:bg-white/10"
              >
                <div
                  className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 transition-[width] duration-200 ease-out progress-shimmer"
                  style={{ width: widthPct }}
                />
              </div>
              <p className="text-xs tabular-nums text-muted-foreground/60">
                {rounded}%
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
