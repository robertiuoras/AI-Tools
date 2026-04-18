"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ALL_WEARS,
  CS2_CATALOG,
  CS2_GROUPS,
  buildMarketHashName,
  type CatalogEntry,
  type Wear,
} from "@/lib/cs2-catalog";

export interface SkinSelection {
  base: string;
  wear: Wear | null;
  stattrak: boolean;
  souvenir: boolean;
  /** Final composed Steam-style market_hash_name. */
  marketHashName: string;
  /** Set when the user typed a custom name not in the catalogue. */
  custom: boolean;
}

const DEFAULT_BASE = "AK-47 | Redline";

function findEntry(base: string): CatalogEntry | undefined {
  return CS2_CATALOG.find((c) => c.base === base);
}

/**
 * Pick a base skin (autocomplete from the curated catalogue), wear, and
 * StatTrak / Souvenir flags. The composed `market_hash_name` is exposed via
 * the `onChange` callback so the parent stays simple.
 */
export function SkinPicker({
  value,
  onChange,
}: {
  value: SkinSelection;
  onChange: (next: SkinSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CS2_GROUPS.map((g) => ({
      group: g,
      items: CS2_CATALOG.filter((c) => c.group === g).filter((c) =>
        q ? c.base.toLowerCase().includes(q) : true,
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const entry = findEntry(value.base);
  const allowedWears = entry?.wears ?? ALL_WEARS;
  const allowsStat = entry?.stattrak ?? true;
  const allowsSouvenir = entry?.souvenir ?? false;

  const apply = (patch: Partial<SkinSelection>) => {
    const merged: SkinSelection = { ...value, ...patch };
    const baseEntry = findEntry(merged.base);
    const wearAllowed = baseEntry?.wears ?? ALL_WEARS;
    const wear =
      merged.wear && wearAllowed.includes(merged.wear)
        ? merged.wear
        : (wearAllowed[0] ?? "Field-Tested");
    const stattrak =
      (baseEntry?.stattrak ?? true) ? merged.stattrak : false;
    const souvenir =
      (baseEntry?.souvenir ?? false) ? merged.souvenir && !stattrak : false;
    const marketHashName = buildMarketHashName({
      base: merged.base,
      wear,
      stattrak,
      souvenir,
    });
    onChange({
      base: merged.base,
      wear,
      stattrak,
      souvenir,
      marketHashName,
      custom: merged.custom ?? false,
    });
  };

  const pickBase = (base: string) => {
    apply({ base, custom: false, stattrak: false, souvenir: false, wear: null });
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="group flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-left text-sm transition-colors hover:border-foreground/30"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">
              {value.base || "Pick a skin…"}
            </span>
            {value.stattrak && (
              <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
                ST
              </span>
            )}
            {value.souvenir && (
              <span className="rounded-full bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-600 dark:text-yellow-400">
                Souvenir
              </span>
            )}
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[28rem] overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            <div className="sticky top-0 border-b border-border bg-popover p-2">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search popular skins (e.g. Redline, Asiimov, Karambit)…"
                className="h-9 text-sm"
              />
            </div>
            <div className="max-h-[22rem] overflow-y-auto p-1">
              {groups.length === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    apply({
                      base: query.trim() || DEFAULT_BASE,
                      custom: true,
                    });
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                >
                  <span>
                    Use custom name:{" "}
                    <span className="font-mono text-xs">
                      {query.trim() || "—"}
                    </span>
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    custom
                  </span>
                </button>
              ) : (
                groups.map((g) => (
                  <div key={g.group} className="mb-1">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.group}
                    </div>
                    {g.items.map((it) => {
                      const selected = it.base === value.base;
                      return (
                        <button
                          key={it.base}
                          type="button"
                          onClick={() => pickBase(it.base)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                            selected
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-accent/60",
                          )}
                        >
                          <span className="truncate text-left">{it.base}</span>
                          {it.priceHintUsd != null && (
                            <span className="ml-2 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                              ~${it.priceHintUsd}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-border bg-muted/30 p-0.5">
          {allowedWears.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => apply({ wear: w })}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                value.wear === w
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {shortWear(w)}
            </button>
          ))}
        </div>

        {allowsStat && (
          <button
            type="button"
            onClick={() =>
              apply({ stattrak: !value.stattrak, souvenir: false })
            }
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              value.stattrak
                ? "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            StatTrak™
          </button>
        )}
        {allowsSouvenir && (
          <button
            type="button"
            onClick={() =>
              apply({ souvenir: !value.souvenir, stattrak: false })
            }
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              value.souvenir
                ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Souvenir
          </button>
        )}
      </div>

      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span>Searching as</span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
          {value.marketHashName}
        </code>
        {value.custom && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            custom
            <X className="h-2.5 w-2.5" />
          </span>
        )}
      </p>
    </div>
  );
}

function shortWear(w: Wear): string {
  switch (w) {
    case "Factory New":
      return "FN";
    case "Minimal Wear":
      return "MW";
    case "Field-Tested":
      return "FT";
    case "Well-Worn":
      return "WW";
    case "Battle-Scarred":
      return "BS";
  }
}

/** Default selection used when the page first loads. */
export const DEFAULT_SKIN_SELECTION: SkinSelection = {
  base: DEFAULT_BASE,
  wear: "Field-Tested",
  stattrak: false,
  souvenir: false,
  marketHashName: buildMarketHashName({
    base: DEFAULT_BASE,
    wear: "Field-Tested",
    stattrak: false,
    souvenir: false,
  }),
  custom: false,
};
