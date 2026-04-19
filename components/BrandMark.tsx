"use client";

import Image from "next/image";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  /** Pixel size of the mark; renders a square. */
  size?: number;
  /**
   * Tone variant — kept for API back-compat with the previous SVG mark.
   * The new logo is a self-contained gradient tile that holds up on both
   * light and dark surfaces, so this prop is no longer used internally.
   * Existing callers (`<BrandMark tone="onDark" />`) keep working untouched.
   */
  tone?: "onLight" | "onDark";
  /**
   * Disable the soft outer halo pulse used in "live" contexts (Hero, splash).
   * Default `false` — the halo is on, matching the previous accent-dot pulse.
   */
  static?: boolean;
  className?: string;
};

/**
 * Brand mark — the AI Tools app icon.
 *
 * A premium squircle tile with the indigo→violet→fuchsia gradient that
 * threads through the rest of the site, a clean white "A" monogram, and a
 * baked-in gold accent dot that doubles as the "live" signal. Rendered as
 * a real PNG so the artwork stays consistent across the app, splash
 * loader, and OS-level favicon (`app/icon.png` ships the same file).
 *
 * The optional outer halo (default on) gives the mark a subtle pulse on
 * the homepage and splash screen without animating the icon itself —
 * keeps things calm and respects `prefers-reduced-motion` (the
 * `brand-accent-halo` keyframe is disabled in `globals.css` for users
 * who request reduced motion).
 */
export function BrandMark({
  size = 56,
  tone: _tone,
  static: isStatic = false,
  className,
}: BrandMarkProps) {
  void _tone;

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
      <Image
        src="/brand-logo.png"
        alt="AI Tools"
        width={size}
        height={size}
        priority
        sizes={`${size}px`}
        className="relative block h-full w-full select-none"
        draggable={false}
      />
    </span>
  );
}
