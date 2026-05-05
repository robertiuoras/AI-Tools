"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type QuickFilter = "all" | "today" | "week" | "withLinks";

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

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

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const now = Date.now();
    return items.filter((item) => {
      const itemDate = safeDate(item.timestamp);

      if (quickFilter === "today") {
        if (!itemDate) return false;
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        if (itemDate.getTime() < startOfToday.getTime()) return false;
      }

      if (quickFilter === "week") {
        if (!itemDate) return false;
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (now - itemDate.getTime() > sevenDaysMs) return false;
      }

      if (quickFilter === "withLinks" && (!item.links || item.links.length === 0)) {
        return false;
      }

      if (!query) return true;

      const inContent = item.content.toLowerCase().includes(query);
      const inLinks = (item.links ?? []).some(
        (link) =>
          link.title.toLowerCase().includes(query) ||
          link.description.toLowerCase().includes(query) ||
          (link.siteName ?? "").toLowerCase().includes(query),
      );

      return inContent || inLinks;
    });
  }, [items, quickFilter, searchQuery]);

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

          <div className="mt-5 space-y-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search news, topics, companies, or link titles..."
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap gap-2">
              <FilterButton
                active={quickFilter === "all"}
                onClick={() => setQuickFilter("all")}
                label="All"
              />
              <FilterButton
                active={quickFilter === "today"}
                onClick={() => setQuickFilter("today")}
                label="Today"
              />
              <FilterButton
                active={quickFilter === "week"}
                onClick={() => setQuickFilter("week")}
                label="Last 7 days"
              />
              <FilterButton
                active={quickFilter === "withLinks"}
                onClick={() => setQuickFilter("withLinks")}
                label="Has links"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Showing {filteredItems.length} of {items.length} items
            </p>
          </div>
        </header>

        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load(false)} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : filteredItems.length === 0 ? (
          <NoMatchesState onClear={() => {
            setSearchQuery("");
            setQuickFilter("all");
          }} />
        ) : (
          <ul className="divide-y divide-border/70 rounded-2xl border border-border/70 bg-card/60 shadow-sm backdrop-blur">
            {filteredItems.map((item, index) => (
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

        <div
          className="break-words text-[15px] leading-7 text-foreground/95 md:text-base [&_a]:text-violet-600 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-violet-500 dark:[&_a]:text-violet-400 dark:hover:[&_a]:text-violet-300 [&_strong]:font-semibold"
          dangerouslySetInnerHTML={{ __html: renderNewsMarkdown(item.content) }}
        />

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

function FilterButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
        active
          ? "border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
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

function NoMatchesState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/80 bg-card/50 px-6 py-14 text-center">
      <h2 className="text-lg font-semibold text-foreground">No matching news found</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Try a different keyword or clear filters to see all recent items.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
      >
        Clear filters
      </button>
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
      <p className="font-semibold text-destructive">Couldn&apos;t load news right now.</p>
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
  const day = date.getDate();
  const dayWithOrdinal = `${day}${getOrdinalSuffix(day)}`;
  const month = date.toLocaleDateString([], { month: "long" });
  const weekday = date.toLocaleDateString([], { weekday: "long" });
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dayWithOrdinal} ${month}, ${weekday} at ${time}`;
}

function formatShortTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  const last = day % 10;
  if (last === 1) return "st";
  if (last === 2) return "nd";
  if (last === 3) return "rd";
  return "th";
}

function renderNewsMarkdown(input: string): string {
  const strippedHeadings = input
    .split("\n")
    .map((line) => line.replace(/^\s*#{1,6}\s+/, ""))
    .join("\n");
  let out = escapeHtml(strippedHeadings);

  // Markdown links [text](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, text: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );

  // Bare links
  out = out.replace(
    /(?<!["'=])(https?:\/\/[^\s<>"']+)/g,
    (url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
  );

  // Bold and italics
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<em>$1</em>");

  // Line breaks
  out = out.replace(/\n/g, "<br />");
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
