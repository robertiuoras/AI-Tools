"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";

import type { Tool } from "@/lib/supabase";
import { isToolCreatedToday } from "@/lib/tool-dates";
import { cn } from "@/lib/utils";

type RecentToolsTickerProps = {
  tools: Tool[];
  /** Cap items shown in the marquee. */
  limit?: number;
  className?: string;
};

/**
 * Continuous horizontal marquee of recent tools — name + logo + a "new"
 * dot for items added today. Tells visitors at a glance that the
 * directory is alive. Pauses on hover/focus so it's readable.
 *
 * Renders nothing if there are no tools; the parent decides placement.
 */
export function RecentToolsTicker({
  tools,
  limit = 18,
  className,
}: RecentToolsTickerProps) {
  const items = useMemo(() => {
    if (!Array.isArray(tools) || tools.length === 0) return [];
    // Newest first; createdAt may be missing on some rows — fall back to id ordering.
    const sorted = [...tools].sort((a, b) => {
      const ad = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bd = b.createdAt ? Date.parse(b.createdAt) : 0;
      return bd - ad;
    });
    return sorted.slice(0, limit);
  }, [tools, limit]);

  if (items.length === 0) return null;

  // Duplicate the list so the -50% translate loop is seamless.
  const doubled = [...items, ...items];

  return (
    <div
      className={cn(
        "ticker-pause group relative w-full overflow-hidden",
        "ticker-fade-edges",
        className,
      )}
      role="region"
      aria-label="Recently added AI tools"
    >
      <div className="ticker-track flex w-max items-center gap-2 py-3 pr-2">
        {doubled.map((tool, i) => {
          const isNew = isToolCreatedToday(tool.createdAt);
          return (
            <Link
              key={`${tool.id}-${i}`}
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${tool.name}`}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full",
                "border border-white/15 bg-white/[0.08] px-3 py-1.5",
                "text-[12px] font-medium text-white/90 backdrop-blur-md",
                "transition-colors hover:bg-white/[0.16] hover:text-white",
              )}
            >
              {tool.logoUrl ? (
                <span className="relative inline-block h-4 w-4 overflow-hidden rounded-full bg-white/20 ring-1 ring-white/20">
                  <Image
                    src={tool.logoUrl}
                    alt=""
                    fill
                    sizes="16px"
                    className="object-cover"
                    unoptimized
                  />
                </span>
              ) : (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[9px] font-bold text-white ring-1 ring-white/20">
                  {tool.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="max-w-[12rem] truncate">{tool.name}</span>
              {isNew ? (
                <span
                  className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-400/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-950"
                  aria-label="Added today"
                >
                  <span className="inline-block h-1 w-1 rounded-full bg-emerald-900" />
                  new
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
