"use client";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  /** Pixel size of the mark; renders a square. */
  size?: number;
  /**
   * Tone variant — kept for API back-compat with the previous PNG mark.
   * The new SVG is a self-contained gradient squircle that holds up on
   * both light and dark surfaces, so this prop is no longer used
   * internally. Existing callers (`<BrandMark tone="onDark" />`) keep
   * working untouched.
   */
  tone?: "onLight" | "onDark";
  /**
   * Disable the soft outer halo pulse used in "live" contexts (Hero,
   * splash). Default `false` — the halo is on, matching the previous
   * accent-dot pulse.
   */
  static?: boolean;
  className?: string;
};

/**
 * Brand mark — the AI Tools app icon.
 *
 * A premium squircle tile rendered as inline SVG so it stays crisp at
 * every zoom level, on every density of display, and works without any
 * network round-trip for `/brand-logo.png`. The mark layers:
 *
 *   1. A soft outer halo (drives the "live" pulse for splash/hero).
 *   2. A rounded gradient tile (indigo → violet → fuchsia) that threads
 *      through the rest of the site's accent palette.
 *   3. A glassy top-down sheen for depth.
 *   4. A subtle inner stroke that gives the tile its squircle definition.
 *   5. A clean geometric "A" monogram with one solid leg and one slightly
 *      translucent leg — reads as a single letter at a glance but carries
 *      a layered, design-forward feel up close.
 *   6. A baked-in gold accent dot that doubles as the "live" signal.
 *
 * The optional outer halo (default on) gives the mark a subtle pulse on
 * the homepage and splash screen. The pulse keyframe is disabled in
 * `globals.css` for `prefers-reduced-motion` users.
 */
export function BrandMark({
  size = 56,
  tone: _tone,
  static: isStatic = false,
  className,
}: BrandMarkProps) {
  void _tone;

  // Stable per-instance ID prefix so multiple marks on the same page
  // don't collide on <defs> ids (gradients).
  const uid = `bm-${size}`;

  return (
    <span
      className={cn("relative inline-block shrink-0 leading-none", className)}
      style={{ width: size, height: size }}
    >
      {!isStatic ? (
        <span
          aria-hidden
          className="brand-accent-halo pointer-events-none absolute inset-0 rounded-[28%] bg-fuchsia-500/30 blur-md"
        />
      ) : null}
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role="img"
        aria-label="AI Tools"
        className="relative block h-full w-full select-none drop-shadow-[0_4px_14px_rgba(124,58,237,0.35)]"
      >
        <defs>
          <linearGradient
            id={`${uid}-bg`}
            x1="0"
            y1="0"
            x2="64"
            y2="64"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="55%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#c026d3" />
          </linearGradient>
          <linearGradient
            id={`${uid}-sheen`}
            x1="32"
            y1="2"
            x2="32"
            y2="40"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={`${uid}-monogram`}
            x1="32"
            y1="14"
            x2="32"
            y2="50"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.92" />
          </linearGradient>
        </defs>

        {/* Squircle tile */}
        <rect
          x="2"
          y="2"
          width="60"
          height="60"
          rx="16"
          ry="16"
          fill={`url(#${uid}-bg)`}
        />

        {/* Glassy top-down sheen */}
        <rect
          x="2"
          y="2"
          width="60"
          height="60"
          rx="16"
          ry="16"
          fill={`url(#${uid}-sheen)`}
        />

        {/* Inner hairline stroke for definition */}
        <rect
          x="2.75"
          y="2.75"
          width="58.5"
          height="58.5"
          rx="15.25"
          ry="15.25"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.22"
          strokeWidth="1"
        />

        {/* "A" monogram — left leg (solid) */}
        <path
          d="M30 14 L34 14 L23 50 L18.5 50 Z"
          fill={`url(#${uid}-monogram)`}
        />
        {/* Right leg (slightly translucent for layered feel) */}
        <path
          d="M30 14 L34 14 L45.5 50 L41 50 Z"
          fill="#ffffff"
          fillOpacity="0.78"
        />
        {/* Crossbar */}
        <rect
          x="24.5"
          y="35"
          width="15"
          height="3.25"
          rx="1.6"
          ry="1.6"
          fill="#ffffff"
          fillOpacity="0.95"
        />

        {/* Gold accent dot — the "live" signal */}
        <circle
          cx="49.5"
          cy="14.5"
          r="3.6"
          fill="#fbbf24"
          stroke="#ffffff"
          strokeWidth="1.1"
          strokeOpacity="0.9"
        />
      </svg>
    </span>
  );
}
