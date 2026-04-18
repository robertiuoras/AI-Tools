"use client";

import { cn } from "@/lib/utils";

export type MarketKey = "csfloat" | "steam" | "buff" | "skinport" | "dmarket";

const META: Record<
  MarketKey,
  { label: string; bg: string; text: string; abbr: string }
> = {
  csfloat: {
    label: "CSFloat",
    bg: "bg-[#0b1220] border-blue-500/40",
    text: "text-blue-400",
    abbr: "CF",
  },
  steam: {
    label: "Steam Market",
    bg: "bg-[#16202d] border-sky-500/40",
    text: "text-sky-300",
    abbr: "ST",
  },
  buff: {
    label: "Buff.market",
    bg: "bg-[#1f1100] border-amber-500/40",
    text: "text-amber-400",
    abbr: "BM",
  },
  skinport: {
    label: "Skinport",
    bg: "bg-[#0e1320] border-indigo-500/40",
    text: "text-indigo-300",
    abbr: "SP",
  },
  dmarket: {
    label: "DMarket",
    bg: "bg-[#0b1a13] border-emerald-500/40",
    text: "text-emerald-300",
    abbr: "DM",
  },
};

/**
 * Compact 24px square badge using the marketplace's accent palette and a
 * 2-letter abbreviation. We deliberately avoid hot-linking external logos
 * (CORS / brand-asset risk) and keep everything as inline SVG/text.
 */
export function MarketLogo({
  market,
  size = 24,
  className,
  withLabel = false,
}: {
  market: MarketKey;
  size?: number;
  className?: string;
  withLabel?: boolean;
}) {
  const m = META[market];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2",
        withLabel ? "" : "shrink-0",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md border font-mono font-bold",
          m.bg,
          m.text,
        )}
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.42),
        }}
        aria-hidden
      >
        {m.abbr}
      </span>
      {withLabel && (
        <span className="text-sm font-semibold text-foreground">{m.label}</span>
      )}
    </span>
  );
}

export function marketLabel(market: MarketKey): string {
  return META[market].label;
}
