"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface WatchEntry {
  id: string;
  marketHashName: string;
  targetPriceUsd: number;
  /** Optional max float / min float (only honoured by CSFloat). */
  maxFloat: number | null;
  minFloat: number | null;
  /** Last best price across all markets, or null if not checked yet. */
  lastPriceUsd: number | null;
  /** ISO timestamp of last check. */
  lastCheckedAt: string | null;
  /** True if the most recent check was at-or-below the target. */
  triggered: boolean;
  createdAt: string;
}

const STORAGE_KEY = "cs2.watchlist.v1";
const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes
const NOTIFY_COOLDOWN_MS = 30 * 60_000; // throttle re-notifying same skin

function loadEntries(): WatchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e === "object") as WatchEntry[];
  } catch {
    return [];
  }
}

function saveEntries(list: WatchEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // out of quota / private browsing — silently swallow
  }
}

interface CheckResponse {
  quotes?: Array<{ priceUsd: number | null }>;
}

async function fetchBestPrice(
  marketHashName: string,
  filters: { maxFloat: number | null; minFloat: number | null },
): Promise<number | null> {
  try {
    const res = await fetch("/api/projects/cs2/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: marketHashName,
        maxFloat: filters.maxFloat,
        minFloat: filters.minFloat,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CheckResponse;
    const prices = (data.quotes ?? [])
      .map((q) => q.priceUsd)
      .filter((p): p is number => typeof p === "number" && p > 0);
    if (prices.length === 0) return null;
    return Math.min(...prices);
  } catch {
    return null;
  }
}

/**
 * LocalStorage-backed price watchlist with browser notifications.
 *
 * Persistence: list lives in `localStorage` so refreshing the tab keeps it.
 * Polling: only runs while the page is open (background tabs throttle the
 *          interval automatically). For true offline alerts we'd need a
 *          server-side cron + push subscription; this is a deliberate
 *          simplification for v1.
 * Notifications: uses the standard Notification API with a 30-min per-skin
 *                cooldown so we don't spam the user when a price hovers.
 */
export function PriceWatchlist({
  prefillName,
  prefillFilters,
}: {
  prefillName: string;
  prefillFilters: { maxFloat: number | null; minFloat: number | null };
}) {
  const [entries, setEntries] = useState<WatchEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    setEntries(loadEntries());
    setLoaded(true);
    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (loaded) saveEntries(entries);
  }, [entries, loaded]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
    } catch {
      // ignore
    }
  }, []);

  const notifyHit = useCallback(
    (entry: WatchEntry, price: number) => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      try {
        new Notification(`CS2 alert: ${entry.marketHashName}`, {
          body: `Now $${price.toFixed(2)} (target $${entry.targetPriceUsd.toFixed(2)})`,
          tag: `cs2-${entry.id}`,
          icon: "/favicon.ico",
        });
      } catch {
        // browser may block from non-secure context
      }
    },
    [],
  );

  const lastNotifiedAtRef = useMemo(() => new Map<string, number>(), []);

  const checkOne = useCallback(
    async (id: string) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      setEntries((cur) =>
        cur.map((e) =>
          e.id === id
            ? { ...e, lastCheckedAt: new Date().toISOString() }
            : e,
        ),
      );
      const price = await fetchBestPrice(entry.marketHashName, {
        maxFloat: entry.maxFloat,
        minFloat: entry.minFloat,
      });
      const triggered = price != null && price <= entry.targetPriceUsd;
      setEntries((cur) =>
        cur.map((e) =>
          e.id === id
            ? {
                ...e,
                lastPriceUsd: price,
                lastCheckedAt: new Date().toISOString(),
                triggered,
              }
            : e,
        ),
      );
      if (triggered && price != null) {
        const last = lastNotifiedAtRef.get(id) ?? 0;
        if (Date.now() - last > NOTIFY_COOLDOWN_MS) {
          notifyHit(entry, price);
          lastNotifiedAtRef.set(id, Date.now());
        }
      }
    },
    [entries, lastNotifiedAtRef, notifyHit],
  );

  const checkAll = useCallback(async () => {
    if (busy || entries.length === 0) return;
    setBusy(true);
    try {
      for (const e of entries) {
        await checkOne(e.id);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, entries, checkOne]);

  // background polling while page is open
  useEffect(() => {
    if (!loaded || entries.length === 0) return;
    const id = window.setInterval(() => {
      void checkAll();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loaded, entries.length, checkAll]);

  const addEntry = useCallback(() => {
    const t = parseFloat(target);
    if (!Number.isFinite(t) || t <= 0 || !prefillName.trim()) return;
    const entry: WatchEntry = {
      id: crypto.randomUUID(),
      marketHashName: prefillName.trim(),
      targetPriceUsd: t,
      maxFloat: prefillFilters.maxFloat,
      minFloat: prefillFilters.minFloat,
      lastPriceUsd: null,
      lastCheckedAt: null,
      triggered: false,
      createdAt: new Date().toISOString(),
    };
    setEntries((cur) => [entry, ...cur]);
    setTarget("");
    if (permission === "default") void requestPermission();
  }, [target, prefillName, prefillFilters, permission, requestPermission]);

  const removeEntry = (id: string) => {
    setEntries((cur) => cur.filter((e) => e.id !== id));
  };

  const notifBtn =
    permission === "granted" ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        <Bell className="h-3 w-3" /> Alerts on
      </span>
    ) : permission === "denied" ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        <BellOff className="h-3 w-3" /> Blocked in browser
      </span>
    ) : (
      <button
        type="button"
        onClick={() => void requestPermission()}
        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <Bell className="h-3 w-3" /> Enable alerts
      </button>
    );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          We poll every 5 min while the page is open. Add the skin you're
          watching above, set a target, and we'll ping you when any market
          drops below it.
        </div>
        <div className="flex items-center gap-2">
          {notifBtn}
          {entries.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void checkAll()}
              disabled={busy}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Check now
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Watch this skin
          </label>
          <div className="truncate text-sm font-medium">{prefillName}</div>
        </div>
        <div className="sm:w-32">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Target $
          </label>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="e.g. 14.50"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addEntry();
              }
            }}
            className="h-9 text-sm"
          />
        </div>
        <Button
          type="button"
          onClick={addEntry}
          disabled={!target.trim() || !prefillName.trim()}
          className="h-9 gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Add alert
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
          No alerts yet. Add one above to get notified when the price drops.
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border bg-background p-3 text-sm sm:flex-row sm:items-center",
                e.triggered
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-border/60",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {e.marketHashName}
                  </span>
                  {e.triggered && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                      <TriangleAlert className="h-3 w-3" />
                      Hit
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Target ${e.targetPriceUsd.toFixed(2)}
                  {e.maxFloat != null && ` · max float ${e.maxFloat.toFixed(3)}`}
                  {e.minFloat != null && ` · min float ${e.minFloat.toFixed(3)}`}
                  {e.lastCheckedAt &&
                    ` · checked ${new Date(e.lastCheckedAt).toLocaleTimeString()}`}
                </div>
              </div>
              <div className="flex items-center gap-3 sm:ml-auto">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Best now
                  </div>
                  <div
                    className={cn(
                      "font-mono text-sm font-semibold",
                      e.triggered && "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {e.lastPriceUsd != null
                      ? `$${e.lastPriceUsd.toFixed(2)}`
                      : "—"}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 p-0"
                  onClick={() => void checkOne(e.id)}
                  title="Check now"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 p-0 text-destructive hover:text-destructive"
                  onClick={() => removeEntry(e.id)}
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
