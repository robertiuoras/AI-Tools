"use client";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  /** Pixel size of the mark; renders a square. */
  size?: number;
  /** Tone variant: "onLight" for white/neutral surfaces, "onDark" for color/gradient surfaces. */
  tone?: "onLight" | "onDark";
  /** Disable the subtle accent-dot pulse (used in static contexts). */
  static?: boolean;
  className?: string;
};

/**
 * Brand mark — a stack of three rounded "tiles" with a single accent dot.
 *
 * Reads as a curated directory of items: the three layered plates evoke a
 * stack of cards being filtered down to the top recommendation, and the
 * gold accent dot doubles as the "live" signal. No orbital animation, no
 * spinning rings — every premium SaaS mark in this category (Linear,
 * Vercel, Anthropic, Arc, Loom) is a single static geometric primitive,
 * and that's the look we're going for.
 *
 * The mark is pure inline SVG (no font icons), so it stays crisp at any
 * scale and can be tinted via CSS without recoloring assets.
 */
export function BrandMark({
  size = 56,
  tone = "onDark",
  static: isStatic = false,
  className,
}: BrandMarkProps) {
  const onDark = tone === "onDark";

  // Per-tone palettes. On dark surfaces the tiles are washed white with
  // a warm gradient on the top tile; on light surfaces they switch to a
  // saturated indigo→violet ramp so the mark holds its weight against
  // white backgrounds.
  const tileBackFill = onDark
    ? "rgba(255,255,255,0.18)"
    : "rgba(99,102,241,0.18)";
  const tileMidFill = onDark
    ? "rgba(255,255,255,0.34)"
    : "rgba(99,102,241,0.42)";
  const topGradientId = onDark ? "bm-top-light" : "bm-top-dark";
  const topStroke = onDark ? "rgba(255,255,255,0.7)" : "rgba(99,102,241,0.85)";
  const accentFill = onDark ? "#fcd34d" : "#f59e0b";
  const accentHaloFill = onDark ? "rgba(252,211,77,0.55)" : "rgba(245,158,11,0.5)";
  const innerHighlight = onDark
    ? "rgba(255,255,255,0.55)"
    : "rgba(255,255,255,0.85)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="AI Tools"
      className={cn("block", className)}
    >
      <defs>
        {/* Warm light-on-dark gradient (used over the colored Hero). */}
        <linearGradient id="bm-top-light" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#fde68a" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.95" />
        </linearGradient>
        {/* Saturated indigo→violet gradient (used over white surfaces). */}
        <linearGradient id="bm-top-dark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="55%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#9333ea" />
        </linearGradient>
        {/* Soft drop shadow that lifts the top tile off the stack — kept
            inside the SVG so consumers don't need to add filter classes. */}
        <filter id="bm-top-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="0"
            dy="1.5"
            stdDeviation="1.6"
            floodColor="#0f172a"
            floodOpacity={onDark ? 0.35 : 0.18}
          />
        </filter>
      </defs>

      {/* Back tile (lowest in the stack) */}
      <rect
        x="14"
        y="22"
        width="32"
        height="32"
        rx="7"
        fill={tileBackFill}
      />

      {/* Middle tile */}
      <rect
        x="11"
        y="16"
        width="34"
        height="34"
        rx="8"
        fill={tileMidFill}
      />

      {/* Top tile — the hero plate, with gradient + drop shadow + a hairline
          inner highlight along the top edge for that subtle glassy lift. */}
      <g filter="url(#bm-top-shadow)">
        <rect
          x="8"
          y="10"
          width="36"
          height="36"
          rx="9"
          fill={`url(#${topGradientId})`}
          stroke={topStroke}
          strokeOpacity={onDark ? 0.35 : 0.4}
          strokeWidth="0.6"
        />
        {/* Inner top highlight — a 1px line that sells the tile as glass. */}
        <path
          d="M14 13 H38 A4 4 0 0 1 42 17"
          fill="none"
          stroke={innerHighlight}
          strokeWidth="0.8"
          strokeLinecap="round"
          opacity={onDark ? 0.55 : 0.7}
        />
      </g>

      {/* Accent dot at the top-right — doubles as the "live" pulse. The
          pulse is a single ping-out halo (no orbital tracer), so it reads
          as "active" without the busy spinning-ring vibe. */}
      <g style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        {!isStatic ? (
          <circle
            cx="42"
            cy="14"
            r="3.4"
            fill={accentHaloFill}
            className="brand-accent-halo"
          />
        ) : null}
        <circle
          cx="42"
          cy="14"
          r="2.4"
          fill={accentFill}
          stroke={onDark ? "rgba(15,23,42,0.45)" : "#ffffff"}
          strokeWidth={onDark ? 0.6 : 0.9}
        />
      </g>
    </svg>
  );
}
