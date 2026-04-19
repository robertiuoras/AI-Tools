"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck, Loader2, Trash2 } from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { useToast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

interface ApiResponse {
  items: NotificationRow[];
  unreadCount: number;
}

/**
 * Polling is only the *fallback* now — the real-time `postgres_changes`
 * subscription below pushes new rows the instant they're inserted. We keep
 * a slow background poll so the bell stays consistent if the websocket
 * drops, falls behind, or the realtime publication isn't applied yet on a
 * given environment.
 */
const POLL_INTERVAL_MS = 60_000;
/** Bumped each time the bell stops/starts polling so we don't double-fire toasts. */
const SEEN_LS_KEY = "notif:lastSeenIds";

function loadSeenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(SEEN_LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    // Cap at 200 to avoid unbounded growth.
    const arr = Array.from(ids).slice(-200);
    localStorage.setItem(SEEN_LS_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsBell() {
  const { user, accessToken } = useAuthSession();
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const { addToast } = useToast();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Hydrate the "already seen" id set so we don't toast existing notifications
  // on every page load.
  useEffect(() => {
    seenIdsRef.current = loadSeenIds();
  }, []);

  const fetchNotifications = useCallback(
    async ({ silent = true }: { silent?: boolean } = {}) => {
      const tok = tokenRef.current;
      if (!tok) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetch("/api/notifications?limit=30", {
          headers: { Authorization: `Bearer ${tok}` },
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as ApiResponse;
        setItems(data.items);
        setUnreadCount(data.unreadCount);

        // Toast for any unread notifications we haven't seen yet.
        const seen = seenIdsRef.current;
        const fresh = data.items.filter(
          (n) => !n.is_read && !seen.has(n.id),
        );
        // Mark every returned id as seen so we don't toast them next poll.
        for (const n of data.items) seen.add(n.id);
        saveSeenIds(seen);

        if (!firstLoadRef.current && fresh.length > 0) {
          // Burst protection: only show toast for up to 3 most recent.
          for (const n of fresh.slice(0, 3)) {
            addToast({
              title: n.title,
              description: n.body ?? undefined,
              variant: "info",
              duration: 7000,
            });
          }
          // Broadcast on the window so other pages (notes page, etc.) can
          // refresh their data immediately instead of waiting for the user
          // to manually reload. Detail.types lets listeners filter to the
          // notifications they care about (e.g. only "note_shared").
          if (typeof window !== "undefined") {
            try {
              window.dispatchEvent(
                new CustomEvent("ai-tools:new-notifications", {
                  detail: {
                    items: fresh,
                    types: Array.from(new Set(fresh.map((n) => n.type))),
                  },
                }),
              );
            } catch {
              /* CustomEvent constructor failure should never block UI */
            }
          }
        }
        firstLoadRef.current = false;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [addToast],
  );

  // Initial fetch + polling, only while logged in.
  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnreadCount(0);
      firstLoadRef.current = true;
      return;
    }
    void fetchNotifications({ silent: false });
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchNotifications({ silent: true });
    }, POLL_INTERVAL_MS);
    const onFocus = () => {
      if (document.visibilityState === "visible") void fetchNotifications();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [user, fetchNotifications]);

  // Real-time push for new notifications. Subscribes to INSERTs on
  // public.notification scoped to this user, so as soon as a share API
  // call writes the row, the bell updates and a toast fires — no waiting
  // for the 60s poll, no need to reload the page after someone shares a
  // whiteboard or note. Falls back silently if the realtime publication
  // isn't enabled in the target Supabase project (the poll above keeps
  // things working).
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const channel = supabase
      .channel(`notifications:user:${userId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "INSERT",
          schema: "public",
          table: "notification",
          filter: `user_id=eq.${userId}`,
        } as never,
        (payload: { new: NotificationRow }) => {
          const row = payload?.new;
          if (!row || !row.id) return;
          // Skip if we've already seen this id (e.g. the poll race-won, or
          // realtime resent on reconnect).
          const seen = seenIdsRef.current;
          if (seen.has(row.id)) return;
          seen.add(row.id);
          saveSeenIds(seen);

          setItems((prev) => {
            if (prev.some((n) => n.id === row.id)) return prev;
            // Cap to ~30 like the API to keep the dropdown tight.
            return [row, ...prev].slice(0, 30);
          });
          if (!row.is_read) setUnreadCount((c) => c + 1);

          // Skip the toast on the very first session load — fetchNotifications
          // already handles that initial flush. Realtime inserts are by
          // definition fresh, so always toast (subject to the same burst
          // protection: we only fire once per id thanks to the seen set).
          addToast({
            title: row.title,
            description: row.body ?? undefined,
            variant: "info",
            duration: 7000,
          });

          if (typeof window !== "undefined") {
            try {
              window.dispatchEvent(
                new CustomEvent("ai-tools:new-notifications", {
                  detail: { items: [row], types: [row.type] },
                }),
              );
            } catch {
              /* noop */
            }
          }
        },
      )
      .subscribe();

    return () => {
      try {
        void supabase.removeChannel(channel);
      } catch {
        /* noop */
      }
    };
  }, [user, addToast]);

  // Close dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = useCallback(
    async (id: string, isRead: boolean) => {
      const tok = tokenRef.current;
      if (!tok) return;
      setBusyId(id);
      // Optimistic update.
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: isRead } : n)),
      );
      setUnreadCount((c) => Math.max(0, c + (isRead ? -1 : 1)));
      try {
        await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tok}`,
          },
          body: JSON.stringify({ is_read: isRead }),
        });
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    const tok = tokenRef.current;
    if (!tok) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}` },
      });
    } catch {/* noop */}
  }, []);

  const remove = useCallback(async (id: string) => {
    const tok = tokenRef.current;
    if (!tok) return;
    const removed = items.find((n) => n.id === id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (removed && !removed.is_read) {
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    try {
      await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok}` },
      });
    } catch {/* noop */}
  }, [items]);

  if (!user) return null;

  const hasUnread = unreadCount > 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative h-9 w-9"
        aria-label={`Notifications${hasUnread ? ` (${unreadCount} unread)` : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className={cn("h-4 w-4", hasUnread && "text-foreground")} />
        {hasUnread ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--background,white)]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl ring-1 ring-black/5"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Notifications</span>
              {hasUnread ? (
                <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {unreadCount} unread
                </span>
              ) : null}
            </div>
            {hasUnread ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <CheckCheck className="h-3 w-3" /> Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center px-4 py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                <Bell className="h-6 w-6 opacity-40" />
                <p>You're all caught up.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const inner = (
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "mt-1 inline-block h-2 w-2 shrink-0 rounded-full",
                          n.is_read ? "bg-transparent" : "bg-emerald-500",
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm leading-snug",
                            n.is_read
                              ? "text-muted-foreground"
                              : "font-semibold text-foreground",
                          )}
                        >
                          {n.title}
                        </p>
                        {n.body ? (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {n.body}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                          {formatRelativeTime(n.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        {!n.is_read ? (
                          <button
                            type="button"
                            title="Mark read"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void markRead(n.id, true);
                            }}
                            disabled={busyId === n.id}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title="Delete"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void remove(n.id);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );

                  const baseClasses = cn(
                    "group block px-4 py-3 transition-colors",
                    n.is_read ? "bg-background hover:bg-muted/50" : "bg-emerald-500/5 hover:bg-emerald-500/10",
                  );

                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link
                          href={n.link}
                          className={baseClasses}
                          onClick={() => {
                            setOpen(false);
                            if (!n.is_read) void markRead(n.id, true);
                          }}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div
                          className={baseClasses}
                          onClick={() => {
                            if (!n.is_read) void markRead(n.id, true);
                          }}
                        >
                          {inner}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
