"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Newspaper, RefreshCw } from "lucide-react";

interface NewsItem {
  content: string;
  timestamp: string;
  links?: LinkPreview[];
}

interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image?: string;
  siteName?: string;
}

const REFRESH_MS = 60_000;

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/news", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const json = (await res.json()) as NewsItem[] | { error?: string };
      if (!Array.isArray(json)) {
        throw new Error(json.error ?? "Invalid response from /api/news");
      }
      setItems(json);
      lastFetchRef.current = Date.now();
      setLastUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // Auto-refresh while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load(true);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Refresh when the tab becomes visible again.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        const stale = Date.now() - lastFetchRef.current > 30_000;
        if (stale) void load(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  return (
    <main className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_40%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-24 top-24 -z-10 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl dark:bg-violet-400/10" />
      <div className="pointer-events-none absolute -left-24 bottom-0 -z-10 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl dark:bg-fuchsia-400/10" />

      <div className="container mx-auto max-w-4xl px-4 py-10 md:py-14">
        <header className="mb-8 md:mb-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
            <Newspaper className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            Daily AI News
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                Daily AI News
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
                Updated automatically from Discord.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing || loading}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load(false)} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border/70 rounded-2xl border border-border/70 bg-card/60 shadow-sm backdrop-blur">
            {items.map((item, index) => (
              <NewsItemCard
                key={`${item.timestamp}-${index}`}
                item={item}
                isLatest={index === 0}
              />
            ))}
          </ul>
        )}

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          Auto-refreshes every 60s · last updated{" "}
          {lastUpdatedAt ? formatShortTime(new Date(lastUpdatedAt)) : "—"}
        </p>
      </div>
    </main>
  );
}

function NewsItemCard({ item, isLatest }: { item: NewsItem; isLatest: boolean }) {
  const ts = safeDate(item.timestamp);

  return (
    <li className="p-4 md:p-6">
      <article
        className={`relative rounded-xl border p-4 transition-colors md:p-5 ${
          isLatest
            ? "border-violet-500/50 bg-violet-500/[0.04]"
            : "border-border/70 bg-background/80"
        }`}
      >
        {isLatest ? (
          <span className="absolute right-4 top-4 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Latest
          </span>
        ) : null}

        <p className="mb-3 pr-16 text-base font-bold text-foreground md:text-lg">
          <time dateTime={item.timestamp}>
            {ts ? formatHumanTimestamp(ts) : "Date unavailable"}
          </time>
        </p>

        <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground/95 md:text-base">
          {item.content}
        </p>

        {item.links && item.links.length > 0 ? (
          <div className="mt-4 space-y-3">
            {item.links.map((link) => (
              <LinkPreviewCard key={link.url} link={link} />
            ))}
          </div>
        ) : null}
      </article>
    </li>
  );
}

function LinkPreviewCard({ link }: { link: LinkPreview }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm transition-colors hover:bg-muted/40"
    >
      {link.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={link.image}
          alt={link.title}
          className="h-44 w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {link.siteName || "Link preview"}
        </p>
        <h3 className="mt-1 text-base font-semibold leading-snug text-foreground md:text-lg">
          {link.title}
        </h3>
        {link.description ? (
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
            {link.description}
          </p>
        ) : null}
      </div>
    </a>
  );
}

function LoadingSkeleton() {
  return (
    <div className="divide-y divide-border/70 rounded-2xl border border-border/70 bg-card/60">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="p-4 md:p-6">
          <div className="skeleton-card-enter rounded-xl border border-border/70 bg-background/80 p-4 md:p-5">
            <div className="mb-3 h-3 w-36 rounded skeleton-wave" style={{ ["--i" as string]: i }} />
            <div className="space-y-2">
              <div className="h-4 w-full rounded skeleton-wave" style={{ ["--i" as string]: i }} />
              <div className="h-4 w-11/12 rounded skeleton-wave" style={{ ["--i" as string]: i }} />
              <div className="h-4 w-3/4 rounded skeleton-wave" style={{ ["--i" as string]: i }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border/80 bg-card/50 px-6 py-14 text-center">
      <h2 className="text-lg font-semibold text-foreground">No news yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        There are no items in your feed right now. New updates will appear here
        automatically as soon as they are added.
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-destructive/35 bg-destructive/5 p-5 text-sm">
      <p className="font-semibold text-destructive">Couldn't load news right now.</p>
      <p className="mt-1 text-destructive/80">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
      >
        Try again now
      </button>
    </div>
  );
}

function safeDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatHumanTimestamp(date: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfInput = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const msPerDay = 86_400_000;
  const dayDiff = Math.floor(
    (startOfToday.getTime() - startOfInput.getTime()) / msPerDay,
  );

  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const fullDate = date.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (dayDiff === 0) return `Today at ${time}`;
  if (dayDiff > 0 && dayDiff < 7) {
    const dayName = date.toLocaleDateString([], { weekday: "long" });
    return `${dayName}, ${time}`;
  }
  return `${fullDate} at ${time}`;
}

function formatShortTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
