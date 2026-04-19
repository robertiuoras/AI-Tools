"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Newspaper,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Hash,
  Clock,
  Heart,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NewsAttachment {
  id: string;
  url: string;
  proxyUrl?: string;
  filename: string;
  contentType?: string;
  width?: number;
  height?: number;
  isImage: boolean;
}

interface NewsEmbed {
  title?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  color?: number;
  authorName?: string;
  authorUrl?: string;
  authorIconUrl?: string;
  providerName?: string;
}

interface NewsAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

interface NewsItem {
  id: string;
  channelId: string;
  authorName: string;
  author: NewsAuthor;
  content: string;
  timestamp: string;
  editedTimestamp?: string;
  attachments: NewsAttachment[];
  embeds: NewsEmbed[];
  primaryLink?: string;
  reactionCount: number;
}

interface NewsResponse {
  configured: boolean;
  items: NewsItem[];
  channelName: string | null;
  fetchedAt: number;
  cached: boolean;
  error?: string;
  setupHint?: string;
}

const REFRESH_MS = 60_000;

export default function NewsPage() {
  const [data, setData] = useState<NewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/news", { cache: "no-store" });
      if (!res.ok && res.status !== 502) {
        throw new Error(`Server returned ${res.status}`);
      }
      const json = (await res.json()) as NewsResponse;
      setData(json);
      lastFetchRef.current = Date.now();
      setError(json.configured ? null : null);
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

  const items = data?.items ?? [];
  const channelName = data?.channelName ?? null;

  return (
    <div className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-24 top-24 -z-10 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl dark:bg-violet-400/10" />
      <div className="pointer-events-none absolute -left-24 bottom-0 -z-10 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-3xl dark:bg-fuchsia-400/10" />

      <div className="container mx-auto max-w-4xl px-4 py-10 md:py-14">
        <header className="mb-8 md:mb-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <Newspaper className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            Daily AI news
            {channelName ? (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="inline-flex items-center gap-1 text-foreground/80">
                  <Hash className="h-3 w-3" />
                  {channelName}
                </span>
              </>
            ) : null}
          </div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
                News
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
                Auto-fed from a Discord channel. Posts appear here the moment
                they're shared — no manual posting required.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing || loading}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        {loading ? (
          <LoadingSkeleton />
        ) : !data?.configured ? (
          <SetupBanner hint={data?.setupHint} />
        ) : error ? (
          <ErrorBanner message={error} onRetry={() => void load(false)} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-4">
            {items.map((item) => (
              <NewsItemCard key={item.id} item={item} />
            ))}
          </ul>
        )}

        <p className="mt-10 text-center text-[11px] text-muted-foreground">
          Auto-refreshes every minute · last updated{" "}
          {data?.fetchedAt
            ? new Date(data.fetchedAt).toLocaleTimeString()
            : "—"}
          {data?.cached ? " (cached)" : ""}
        </p>
      </div>
    </div>
  );
}

// ---------- Pieces ----------

function NewsItemCard({ item }: { item: NewsItem }) {
  const ts = new Date(item.timestamp);
  const rel = formatRelativeTime(ts);
  const accent =
    item.embeds.find((e) => typeof e.color === "number" && e.color !== 0)
      ?.color ?? null;
  const accentCss =
    accent != null ? `#${accent.toString(16).padStart(6, "0")}` : null;

  return (
    <li>
      <article
        className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur-sm transition-all hover:border-violet-500/40 hover:shadow-md hover:shadow-violet-500/10 md:p-5"
      >
        {accentCss ? (
          <span
            className="pointer-events-none absolute left-0 top-0 h-full w-1"
            style={{ backgroundColor: accentCss }}
            aria-hidden
          />
        ) : null}

        <header className="mb-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.author.avatarUrl}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-full ring-2 ring-background"
            referrerPolicy="no-referrer"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {item.author.displayName}
              </span>
              <span className="text-[11px] text-muted-foreground">
                @{item.author.username}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              <time dateTime={item.timestamp} title={ts.toLocaleString()}>
                {rel}
              </time>
              {item.editedTimestamp ? (
                <span className="opacity-60">· edited</span>
              ) : null}
              {item.reactionCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-pink-500/80">
                  <Heart className="h-3 w-3 fill-current" />
                  {item.reactionCount}
                </span>
              ) : null}
            </div>
          </div>
        </header>

        {item.content ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none break-words text-[13.5px] leading-relaxed text-foreground/90"
            dangerouslySetInnerHTML={{ __html: renderDiscordMarkdown(item.content) }}
          />
        ) : null}

        {item.embeds.length > 0 ? (
          <div className="mt-3 space-y-2">
            {item.embeds.slice(0, 3).map((e, idx) => (
              <EmbedCard key={idx} embed={e} />
            ))}
          </div>
        ) : null}

        {item.attachments.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {item.attachments.slice(0, 6).map((a) => (
              <AttachmentTile key={a.id} att={a} />
            ))}
          </div>
        ) : null}

        {item.primaryLink && !item.embeds.some((e) => e.url === item.primaryLink) ? (
          <a
            href={item.primaryLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-violet-600 hover:underline dark:text-violet-400"
          >
            Open link
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </article>
    </li>
  );
}

function EmbedCard({ embed }: { embed: NewsEmbed }) {
  const accent =
    embed.color != null ? `#${embed.color.toString(16).padStart(6, "0")}` : undefined;
  const inner = (
    <div
      className="flex gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
    >
      {embed.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={embed.thumbnailUrl}
          alt=""
          className="h-16 w-16 shrink-0 rounded-md object-cover"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-1">
        {embed.providerName ? (
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {embed.providerName}
          </div>
        ) : null}
        {embed.title ? (
          <div className="text-sm font-semibold text-foreground">
            {embed.title}
          </div>
        ) : null}
        {embed.description ? (
          <p className="line-clamp-3 text-[12px] text-muted-foreground">
            {embed.description}
          </p>
        ) : null}
        {embed.imageUrl && !embed.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={embed.imageUrl}
            alt=""
            className="mt-2 max-h-72 w-full rounded-md object-cover"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </div>
    </div>
  );
  if (embed.url) {
    return (
      <a
        href={embed.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block transition-transform hover:-translate-y-0.5"
      >
        {inner}
      </a>
    );
  }
  return inner;
}

function AttachmentTile({ att }: { att: NewsAttachment }) {
  if (att.isImage) {
    return (
      <a
        href={att.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative block overflow-hidden rounded-lg border border-border/60 bg-muted/30"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={att.proxyUrl ?? att.url}
          alt={att.filename}
          className="aspect-video w-full object-cover transition-transform group-hover:scale-105"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </a>
    );
  }
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground hover:bg-muted"
    >
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{att.filename}</span>
    </a>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-border/70 bg-card/60 p-5"
        >
          <div className="mb-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 rounded bg-muted" />
              <div className="h-2 w-20 rounded bg-muted/70" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-5/6 rounded bg-muted/70" />
            <div className="h-3 w-3/4 rounded bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10">
        <Sparkles className="h-6 w-6 text-violet-500" />
      </div>
      <h2 className="text-lg font-semibold">Nothing to read… yet.</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Once your Discord news channel has its first post, it'll appear here
        within a minute.
      </p>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 text-sm">
      <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4" />
        Couldn't load news right now
      </div>
      <p className="text-amber-700/80 dark:text-amber-200/80">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-medium text-amber-800 hover:bg-amber-500/20 dark:text-amber-200"
      >
        <RefreshCw className="h-3 w-3" />
        Try again
      </button>
    </div>
  );
}

function SetupBanner({ hint }: { hint?: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/70 p-6 text-sm shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-foreground">
        <Settings className="h-4 w-4 text-violet-500" />
        <span className="font-semibold">News feed isn't connected yet.</span>
      </div>
      <p className="mb-4 text-muted-foreground">
        {hint ??
          "Set DISCORD_BOT_TOKEN and DISCORD_NEWS_CHANNEL_ID in your environment, then reload."}
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-[13px] text-foreground/85">
        <li>
          Create an app + bot at{" "}
          <a
            className="text-violet-500 underline-offset-2 hover:underline"
            href="https://discord.com/developers/applications"
            target="_blank"
            rel="noopener noreferrer"
          >
            discord.com/developers
          </a>{" "}
          and copy its bot token.
        </li>
        <li>
          Invite the bot to your server with{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11.5px]">
            View Channel
          </code>{" "}
          permission for your news channel.
        </li>
        <li>
          In Discord, enable Developer Mode (Settings → Advanced), right-click
          the channel and choose <em>Copy Channel ID</em>.
        </li>
        <li>
          Add to your environment:
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted/60 p-3 text-[12px] leading-relaxed">
{`DISCORD_BOT_TOKEN=...
DISCORD_NEWS_CHANNEL_ID=123456789012345678
# optional
DISCORD_NEWS_LIMIT=30
DISCORD_NEWS_CACHE_MS=60000`}
          </pre>
        </li>
        <li>
          Redeploy. Posts in that channel now stream into{" "}
          <Link href="/news" className="text-violet-500 underline-offset-2 hover:underline">
            /news
          </Link>{" "}
          automatically.
        </li>
      </ol>
    </div>
  );
}

// ---------- Helpers ----------

function formatRelativeTime(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000; // seconds
  if (diff < 60) return "just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} min${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (diff < 86400 * 7) {
    const days = Math.floor(diff / 86400);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

/**
 * Lightweight Discord-flavoured markdown → HTML. Escapes everything
 * first so we never inject raw HTML from a Discord message; then
 * upgrades safe inline patterns: links, bold, italic, code, code blocks,
 * and Discord-specific @mentions/#channels (we just neutralize them so
 * the page reads cleanly).
 */
function renderDiscordMarkdown(input: string): string {
  let out = escapeHtml(input);

  // Code blocks ```lang\n...```  (keep before inline `code`)
  out = out.replace(/```(?:[a-zA-Z0-9_-]+\n)?([\s\S]*?)```/g, (_m, code) => {
    return `<pre class="rounded-md bg-muted/70 p-3 text-[12.5px] overflow-x-auto"><code>${code}</code></pre>`;
  });

  // Inline code `...`
  out = out.replace(/`([^`\n]+)`/g, (_m, c) => {
    return `<code class="rounded bg-muted/70 px-1 py-0.5 text-[12.5px]">${c}</code>`;
  });

  // Auto-links — match HTTPS-only to avoid grabbing odd patterns.
  out = out.replace(
    /(https?:\/\/[^\s<]+)/g,
    (m) =>
      `<a href="${m}" target="_blank" rel="noopener noreferrer" class="text-violet-600 underline-offset-2 hover:underline dark:text-violet-400">${m}</a>`,
  );

  // Bold **...**
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Italic *...* or _..._
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<em>$1</em>");
  // Strikethrough ~~...~~
  out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  // Discord mentions/channels — strip to just the id-less marker.
  out = out.replace(/&lt;@!?(\d+)&gt;/g, "<span class=\"text-violet-500\">@user</span>");
  out = out.replace(/&lt;#(\d+)&gt;/g, "<span class=\"text-violet-500\">#channel</span>");
  out = out.replace(/&lt;@&amp;(\d+)&gt;/g, "<span class=\"text-violet-500\">@role</span>");
  // Custom emoji <:name:id> → :name:
  out = out.replace(/&lt;a?:([a-zA-Z0-9_]+):\d+&gt;/g, ":$1:");

  // Newlines
  out = out.replace(/\n/g, "<br />");

  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
