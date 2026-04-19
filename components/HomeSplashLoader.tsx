"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";

type HomeSplashLoaderProps = {
  /** When false, overlay fades out (parent should unmount after ~500ms). */
  loading: boolean;
};

const LOADING_MESSAGES = [
  "Pulling fresh tools from the catalog",
  "Ranking by community upvotes",
  "Indexing categories & tags",
  "Calibrating recommendations",
  "Polishing the last details",
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

      {/* Layer 1: ambient color blobs (kept subtle so the dot grid reads first) */}
      <div
        className="pointer-events-none absolute -left-[20%] top-1/4 h-[min(80vw,28rem)] w-[min(80vw,28rem)] rounded-full bg-indigo-500/15 blur-3xl home-splash-blob"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-[15%] bottom-1/4 h-[min(70vw,24rem)] w-[min(70vw,24rem)] rounded-full bg-violet-500/12 blur-3xl home-splash-blob-delayed"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[min(90vw,32rem)] w-[min(90vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/8 blur-[100px] home-splash-blob-slow"
        aria-hidden
      />

      {/* Layer 2: precise dot grid — the "engineered" texture that anchors the splash and pulls it away from generic SaaS gradient backgrounds. */}
      <div
        className="pointer-events-none absolute inset-0 splash-dot-grid"
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

            {/* Brand plate with a single, gentle halo ripple. The mark is a
                self-contained gradient tile, so we no longer wrap it in an
                additional gradient div — that used to clash with the icon
                art. One quiet halo pulse draws the eye to the logo. */}
            <div className="relative flex h-24 w-24 items-center justify-center">
              {/* Outer halo — soft expanding ripple (CSS keyframe). */}
              <div
                className="splash-halo-pulse pointer-events-none absolute h-20 w-20 rounded-2xl bg-indigo-500/15 blur-md dark:bg-indigo-400/15"
                aria-hidden
              />
              <BrandMark size={72} tone="onDark" />
            </div>

            {/* Title + cycling message — message styled like a status feed line */}
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                AI Tools
              </h2>
              <p
                className="flex min-h-[1.25rem] items-center justify-center gap-1.5 text-sm text-muted-foreground transition-opacity duration-250"
                style={{ opacity: msgVisible ? 1 : 0 }}
              >
                <span
                  aria-hidden
                  className="text-indigo-500/80 dark:text-indigo-400/80"
                >
                  ›
                </span>
                <span>
                  {loading ? LOADING_MESSAGES[msgIdx] : "Catalog ready"}
                </span>
              </p>
            </div>

            {/* Progress bar + percentage with a tiny "live" status row */}
            <div className="w-full space-y-2">
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
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]"
                  />
                  live
                </span>
                <span className="tabular-nums">{rounded}%</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
