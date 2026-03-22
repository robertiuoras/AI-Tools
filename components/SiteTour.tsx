"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ai-tools-site-tour-v1";

type TourStep = {
  id: string;
  title: string;
  body?: string;
  bullets?: string[];
  selector?: string;
  scrollBlock?: ScrollLogicalPosition;
  /** Pin tooltip above / below the highlight; default picks from viewport fit */
  tooltipPlacement?: "auto" | "above" | "below";
  /** Place tooltip to the right of the highlight (e.g. filters sidebar on desktop) */
  tooltipSide?: "auto" | "right";
  /** Extra px to move tooltip up (negative nudge) when using vertical placement */
  tooltipLift?: number;
  /** After scrollIntoView, scroll window by this px (negative = up) so the tour card stays visible */
  scrollNudgeY?: number;
  /** Override arrow label (e.g. always “below” for card grid step) */
  arrowHint?: "auto" | "below" | "above" | "here";
};

const STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome",
    body: "Here’s a quick tour. Use **Next** to jump to each area, or **Skip** (✕) to close. You won’t see this again unless you **clear site data**.",
  },
  {
    id: "search",
    title: "Search",
    selector: '[data-tutorial="search-bar"]',
    body: "Search tools by **name**, **description**, or **tags**. Suggestions appear as you type.",
  },
  {
    id: "filters",
    title: "Filters & categories",
    selector: '[data-tutorial="filter-sidebar"]',
    scrollBlock: "start",
    tooltipSide: "right",
    arrowHint: "here",
    body: "Filter by **category**, **traffic** tier, **revenue** model, and **favorites** (when signed in). On small screens, open **Filters**.",
  },
  {
    id: "nav",
    title: "Videos, Creators & Notes",
    selector: '[data-tutorial="main-nav-links"]',
    body: "Use the header for **Videos**, **Creators**, **Prompts** (community library + **My prompts** page), and private **Notes** (**sign in** required for notes).",
  },
  {
    id: "results",
    title: "Results & layout",
    selector: '[data-tutorial="tool-results-first-row"]',
    scrollBlock: "end",
    scrollNudgeY: -140,
    tooltipPlacement: "above",
    tooltipLift: 160,
    arrowHint: "below",
    bullets: [
      "**Tool cards** (below) — browse each listing.",
      "**Grid / list** icons — switch layout (toolbar above).",
      "**Sort** — change order; **ℹ️** explains **Most Popular**.",
      "**Heart** — favorite a tool (**signed in**).",
      "**Thumbs-up / thumbs-down** — vote; counts **this month** (**signed in**). Share shows **% up vs down** when there are votes.",
    ],
  },
];

/** Renders `**bold**` segments as <strong>. */
function RichLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          const inner = part.slice(2, -2);
          return (
            <strong
              key={i}
              className="font-semibold text-foreground/95 dark:text-foreground"
            >
              {inner}
            </strong>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function markComplete() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export type SiteTourProps = {
  adminReplayNonce?: number;
};

export function SiteTour({ adminReplayNonce = 0 }: SiteTourProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardStyle, setCardStyle] = useState<React.CSSProperties>({});
  const [arrowToHighlight, setArrowToHighlight] = useState<
    "up" | "down" | "here" | null
  >(null);
  const lastAdminReplayRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (pathname !== "/") return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      return;
    }
    const t = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(t);
  }, [pathname]);

  useEffect(() => {
    if (!adminReplayNonce || adminReplayNonce <= lastAdminReplayRef.current) {
      return;
    }
    lastAdminReplayRef.current = adminReplayNonce;
    if (pathname !== "/") return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setStepIndex(0);
    setOpen(true);
  }, [adminReplayNonce, pathname]);

  const step = STEPS[stepIndex] ?? STEPS[0];
  const scrollRafRef = useRef<number | null>(null);

  const measureLayout = useCallback(() => {
    const pad = 6;
    const cardW = Math.min(
      340,
      typeof window !== "undefined" ? window.innerWidth - 24 : 340,
    );
    const gap = 14;

    if (!step.selector) {
      setRect(null);
      setArrowToHighlight(null);
      setCardStyle({
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: cardW,
        zIndex: 202,
      });
      return;
    }

    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      setRect(null);
      setArrowToHighlight(null);
      setCardStyle({
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: cardW,
        zIndex: 202,
      });
      return;
    }

    const r = el.getBoundingClientRect();
    setRect(
      new DOMRect(
        r.left - pad,
        r.top - pad,
        r.width + pad * 2,
        r.height + pad * 2,
      ),
    );

    const estCardH = step.bullets?.length ? 260 : 220;
    const placement = step.tooltipPlacement ?? "auto";
    const navClearance = 72;
    const lift = step.tooltipLift ?? 0;
    const side = step.tooltipSide ?? "auto";

    let top: number;
    let left: number;
    let tooltipAboveTarget = false;
    let effectiveArrow = step.arrowHint ?? "auto";

    const useRightSide =
      side === "right" && r.right + gap + cardW <= window.innerWidth - 12;

    if (useRightSide) {
      left = r.right + gap;
      top = Math.max(navClearance, r.top + 28);
      const maxTop = window.innerHeight - estCardH - 12;
      if (top > maxTop) top = Math.max(navClearance, maxTop);
      setArrowToHighlight("here");
    } else {
      if (placement === "above") {
        let t = r.top - gap - estCardH - lift;
        t = Math.max(navClearance, t);
        if (t + estCardH > r.top - gap) {
          top = r.bottom + gap;
          tooltipAboveTarget = false;
          if (effectiveArrow === "below") {
            effectiveArrow = "auto";
          }
        } else {
          top = t;
          tooltipAboveTarget = true;
        }
      } else if (placement === "below") {
        top = r.bottom + gap;
        tooltipAboveTarget = false;
      } else {
        top = r.bottom + gap;
        tooltipAboveTarget = false;
        if (top + estCardH > window.innerHeight - 12) {
          const above = Math.max(
            navClearance,
            r.top - gap - estCardH - lift,
          );
          if (above + estCardH <= r.top - gap) {
            top = above;
            tooltipAboveTarget = true;
          }
        }
      }

      left = r.left + r.width / 2 - cardW / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - cardW - 12));

      if (effectiveArrow === "below") {
        setArrowToHighlight("down");
      } else if (effectiveArrow === "above") {
        setArrowToHighlight("up");
      } else if (effectiveArrow === "here") {
        setArrowToHighlight("here");
      } else {
        setArrowToHighlight(tooltipAboveTarget ? "down" : "up");
      }
    }

    if (useRightSide) {
      setCardStyle({
        position: "fixed",
        top,
        left,
        width: cardW,
        zIndex: 202,
        transform: "none",
      });
      return;
    }

    setCardStyle({
      position: "fixed",
      top,
      left,
      width: cardW,
      zIndex: 202,
      transform: "none",
    });
  }, [step]);

  const scrollTargetIntoViewAndMeasure = useCallback(() => {
    if (!step.selector) {
      measureLayout();
      return;
    }
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({
        block: step.scrollBlock ?? "center",
        behavior: "auto",
      });
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (step.scrollNudgeY) {
          window.scrollBy({
            top: step.scrollNudgeY,
            left: 0,
            behavior: "auto",
          });
        }
        measureLayout();
      });
    });
  }, [step, measureLayout]);

  useEffect(() => {
    if (!open) return;
    scrollTargetIntoViewAndMeasure();
    const onResize = () => measureLayout();
    const onScroll = () => {
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        measureLayout();
      });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    const id = window.setTimeout(measureLayout, 80);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      window.clearTimeout(id);
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [open, stepIndex, measureLayout, scrollTargetIntoViewAndMeasure]);

  const finish = () => {
    markComplete();
    setOpen(false);
  };

  const next = () => {
    if (stepIndex >= STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  if (!mounted || !open || typeof document === "undefined") return null;

  return createPortal(
    <>
      {stepIndex === 0 && (
        <div className="fixed inset-0 z-[200] bg-black/60" aria-hidden />
      )}

      {rect && step.selector ? (
        <div
          className="pointer-events-none fixed z-[201] rounded-xl ring-2 ring-sky-500/90 ring-offset-2 ring-offset-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] dark:ring-sky-400/80"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ) : null}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-tour-title"
        className={cn(
          "rounded-2xl border p-4 shadow-2xl backdrop-blur-md",
          "border-sky-200/90 bg-white/95 text-slate-800",
          "dark:border-sky-500/25 dark:bg-slate-950/90 dark:text-slate-100",
          "font-sans antialiased",
          stepIndex === 0 && "border-sky-300 dark:border-sky-500/40",
        )}
        style={{
          ...cardStyle,
          fontFeatureSettings: '"kern" 1, "liga" 1',
        }}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <p
            id="site-tour-title"
            className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-50"
          >
            {step.title}
          </p>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="Skip tour"
            onClick={finish}
          >
            ✕
          </button>
        </div>
        {rect && step.selector && arrowToHighlight && (
          <div
            className={cn(
              "mb-2 flex items-center gap-1.5 text-[11px] font-medium text-sky-600 dark:text-sky-400",
              arrowToHighlight === "here"
                ? "justify-start"
                : "justify-center",
            )}
            aria-hidden
          >
            {arrowToHighlight === "up" ? (
              <>
                <ArrowUp className="h-4 w-4 shrink-0 animate-bounce" />
                <span>Highlighted above</span>
              </>
            ) : arrowToHighlight === "down" ? (
              <>
                <span>Highlighted below</span>
                <ArrowDown className="h-4 w-4 shrink-0 animate-bounce" />
              </>
            ) : (
              <>
                <span>Highlighted here</span>
                <ArrowRight className="h-4 w-4 shrink-0 animate-bounce" />
              </>
            )}
          </div>
        )}
        {step.bullets && step.bullets.length > 0 ? (
          <ul className="mb-4 max-h-[min(52vh,320px)] list-disc space-y-2 overflow-y-auto overscroll-contain pl-4 pr-1 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            {step.bullets.map((line, i) => (
              <li key={i}>
                <RichLine text={line} />
              </li>
            ))}
          </ul>
        ) : null}
        {step.body ? (
          <p className="mb-4 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            <RichLine text={step.body} />
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-700/80">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              >
                Back
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="h-8 bg-sky-600 text-xs text-white hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500"
              onClick={next}
            >
              {stepIndex >= STEPS.length - 1 ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
