"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ai-tools-site-tour-v1";

type TourStep = {
  id: string;
  title: string;
  body: string;
  /** CSS selector; omit for centered welcome step */
  selector?: string;
};

const STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome",
    body: "Here’s a quick tour of the site. Use Next to jump to each area, or Skip to close. You won’t see this again unless you clear site data.",
  },
  {
    id: "search",
    title: "Search",
    selector: '[data-tutorial="search-bar"]',
    body: "Search tools by name, description, or tags. Matching suggestions appear as you type.",
  },
  {
    id: "filters",
    title: "Filters & categories",
    selector: '[data-tutorial="filter-sidebar"]',
    body: "Filter by category, traffic tier, revenue model, and favorites (when signed in). On small screens, open filters with the Filters button.",
  },
  {
    id: "nav",
    title: "Videos, Creators & Notes",
    selector: '[data-tutorial="main-nav-links"]',
    body: "Use the header to leave the tools directory: Videos and Creators, or your private Notes (sign in required).",
  },
  {
    id: "results",
    title: "Results & layout",
    selector: '[data-tutorial="tool-results"]',
    body: "Switch grid or list and change sort order. When signed in, use the heart on each card to favorite a tool, and the thumbs-up to upvote it (counts toward this month’s ranking). Click the ℹ️ next to sort to read how “Most Popular” works.",
  },
];

function markComplete() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export type SiteTourProps = {
  /**
   * Increment from the home page (e.g. admin “test tour” button) to clear the
   * completion flag and open the tour from the welcome step.
   */
  adminReplayNonce?: number;
};

export function SiteTour({ adminReplayNonce = 0 }: SiteTourProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardStyle, setCardStyle] = useState<React.CSSProperties>({});
  const [arrowToHighlight, setArrowToHighlight] = useState<"up" | "down" | null>(
    null,
  );
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

  /** Admin testing: each new nonce runs the tour once from the start. */
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

  /**
   * Measure highlight + tooltip position only (no scroll). Safe to call on every scroll.
   */
  const measureLayout = useCallback(() => {
    const pad = 6;
    const cardW = Math.min(
      320,
      typeof window !== "undefined" ? window.innerWidth - 24 : 320,
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

    let top = r.bottom + gap;
    let left = r.left + r.width / 2 - cardW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - cardW - 12));
    const estCardH = 220;
    let placeAbove = false;
    if (top + estCardH > window.innerHeight - 12) {
      top = Math.max(12, r.top - estCardH - gap);
      placeAbove = true;
    }
    setArrowToHighlight(placeAbove ? "down" : "up");

    setCardStyle({
      position: "fixed",
      top,
      left,
      width: cardW,
      zIndex: 202,
      transform: "none",
    });
  }, [step]);

  /**
   * When the step opens: bring target into view once (instant = no fight with user scroll).
   */
  const scrollTargetIntoViewAndMeasure = useCallback(() => {
    if (!step.selector) {
      measureLayout();
      return;
    }
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "auto" });
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(measureLayout);
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
        <div
          className="fixed inset-0 z-[200] bg-black/65"
          aria-hidden
        />
      )}

      {rect && step.selector ? (
        <div
          className="pointer-events-none fixed z-[201] rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
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
          "rounded-xl border border-border bg-card p-4 shadow-2xl",
          stepIndex === 0 && "border-primary/30",
        )}
        style={cardStyle}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <p
            id="site-tour-title"
            className="text-sm font-semibold text-foreground"
          >
            {step.title}
          </p>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Skip tour"
            onClick={finish}
          >
            ✕
          </button>
        </div>
        {rect && step.selector && arrowToHighlight && (
          <div
            className="mb-2 flex items-center justify-center gap-1 text-[11px] font-medium text-primary"
            aria-hidden
          >
            {arrowToHighlight === "up" ? (
              <>
                <ArrowUp className="h-4 w-4 shrink-0 animate-bounce" />
                <span>Highlighted above</span>
              </>
            ) : (
              <>
                <span>Highlighted below</span>
                <ArrowDown className="h-4 w-4 shrink-0 animate-bounce" />
              </>
            )}
          </div>
        )}
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          {step.body}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              >
                Back
              </Button>
            )}
            <Button type="button" size="sm" className="h-8 text-xs" onClick={next}>
              {stepIndex >= STEPS.length - 1 ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
