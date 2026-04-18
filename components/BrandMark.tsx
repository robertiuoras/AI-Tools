"use client";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  /** Pixel size of the mark; renders a square. */
  size?: number;
  /** Tone variant: "onLight" for white/neutral surfaces, "onDark" for color/gradient surfaces. */
  tone?: "onLight" | "onDark";
  /** Disable orbital animation (used in static contexts). */
  static?: boolean;
  className?: string;
};

/**
 * Custom brand mark — a "directory node" with two orbiting tracer dots
 * around a luminous core. Replaces the generic Sparkles icon and gives
 * the site a single, ownable visual signature that works at any size.
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

  // Solid colors / opacities — tuned per tone so the mark reads on
  // both white card surfaces and the colored Hero gradient.
  const ringColor = onDark ? "rgba(255,255,255,0.42)" : "rgba(99,102,241,0.45)";
  const ringInner = onDark ? "rgba(255,255,255,0.28)" : "rgba(99,102,241,0.28)";
  const tracer1 = onDark ? "#ffffff" : "#6366f1";
  const tracer2 = onDark ? "#fde68a" : "#a855f7";
  const coreFill = onDark ? "url(#bm-core-light)" : "url(#bm-core-dark)";

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
        {/* Two gradients so the same mark works on both light/dark backgrounds. */}
        <radialGradient id="bm-core-light" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="60%" stopColor="#fde68a" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.85" />
        </radialGradient>
        <radialGradient id="bm-core-dark" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a5b4fc" stopOpacity="1" />
          <stop offset="55%" stopColor="#818cf8" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.95" />
        </radialGradient>
      </defs>

      {/* Outer orbit ring */}
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke={ringColor}
        strokeWidth="1"
        strokeDasharray="2 4"
      />
      {/* Inner orbit ring */}
      <circle
        cx="32"
        cy="32"
        r="16"
        fill="none"
        stroke={ringInner}
        strokeWidth="1"
      />

      {/* Outer tracer (clockwise) */}
      <g className={isStatic ? undefined : "brand-orbit-cw"} style={{ transformBox: "fill-box" }}>
        <circle cx="32" cy="6" r="2.4" fill={tracer1} />
      </g>

      {/* Inner tracer (counter-clockwise) */}
      <g className={isStatic ? undefined : "brand-orbit-ccw"} style={{ transformBox: "fill-box" }}>
        <circle cx="32" cy="16" r="1.8" fill={tracer2} />
      </g>

      {/* Faint guide marks at 0/90/180/270° on the outer ring */}
      <g fill={ringColor}>
        <circle cx="32" cy="6" r="0.85" opacity="0.55" />
        <circle cx="58" cy="32" r="0.85" opacity="0.55" />
        <circle cx="32" cy="58" r="0.85" opacity="0.55" />
        <circle cx="6" cy="32" r="0.85" opacity="0.55" />
      </g>

      {/* Luminous core */}
      <g className={isStatic ? undefined : "brand-pulse-core"} style={{ transformBox: "fill-box" }}>
        <circle cx="32" cy="32" r="6.5" fill={coreFill} />
        <circle cx="32" cy="32" r="2.5" fill="#ffffff" opacity="0.95" />
      </g>
    </svg>
  );
}
