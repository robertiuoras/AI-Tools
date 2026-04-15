"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { SearchBar } from "@/components/SearchBar";
import { VideoCard } from "@/components/VideoCard";
import type { Video } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { videoCategoryList } from "@/lib/tool-categories";
import { toolCategoryBadgeClass } from "@/lib/tool-category-styles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Youtube, Users, Film, LayoutGrid, List, Eye, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { CreatorAvatar } from "@/components/CreatorAvatar";
import { motion } from "framer-motion";

type ViewMode = "videos" | "creators";
type LayoutMode = "grid" | "list";
type SortOption = "newest" | "alphabetical" | "subscribers";
type SourceFilter = "all" | "youtube" | "tiktok";

const PAGE_SIZE_GRID = 48;
const PAGE_SIZE_LIST = 16;

function formatSubs(count: number | null): string | null {
  if (count == null) return null;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

/** True if the video was added within the last 7 days */
function isVideoRecent(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
}

function getYouTubeThumbnail(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://img.youtube.com/vi/${v}/mqdefault.jpg`;
      const parts = u.pathname.split("/").filter(Boolean);
      const id = parts[parts.length - 1];
      if (id && id !== "watch") return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "");
      if (id) return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
    }
  } catch {/* */}
  return null;
}

/** Compact grid card — thumbnail click opens video in new tab */
function VideoGridCard({
  video,
  watched,
  onToggleWatched,
}: {
  video: Video;
  watched: boolean;
  onToggleWatched?: (id: string, watched: boolean) => void;
}) {
  const [thumbError, setThumbError] = useState(false);
  const [chanError, setChanError] = useState(false);
  const source = (video as { source?: string }).source ?? "youtube";
  const thumb = source === "youtube" ? getYouTubeThumbnail(video.url) : null;
  const cats = videoCategoryList(video).slice(0, 2);
  const isNew = isVideoRecent(video.createdAt);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/50 bg-card transition-all hover:border-rose-400/50 hover:shadow-lg hover:shadow-rose-500/5"
    >
      {/* Thumbnail */}
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block aspect-video w-full overflow-hidden bg-muted"
      >
        {source === "youtube" && thumb && !thumbError ? (
          <img
            src={thumb}
            alt={video.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            decoding="async"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-rose-950/40 via-zinc-900 to-orange-950/30">
            {source === "tiktok" ? (
              <span className="text-2xl font-bold text-white/60">TikTok</span>
            ) : (
              <Youtube className="h-10 w-10 text-rose-400/60" />
            )}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all group-hover:bg-black/20">
          <ExternalLink className="h-7 w-7 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-90" />
        </div>
        {/* Source badge */}
        <span className={cn(
          "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          source === "tiktok"
            ? "bg-black/70 text-white"
            : "bg-rose-600/90 text-white",
        )}>
          {source === "tiktok" ? "TikTok" : "YT"}
        </span>
        {/* New badge */}
        {isNew && (
          <span className="absolute right-2 top-2 rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow-sm">
            New
          </span>
        )}
        {/* Watched badge */}
        {watched && !isNew && (
          <span className="absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
            <CheckCircle2 className="h-3 w-3" /> Watched
          </span>
        )}
      </a>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {video.title}
        </h3>
        {video.youtuberName && (
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 flex-shrink-0 overflow-hidden rounded-full border border-border bg-muted">
              {(video as { channelThumbnailUrl?: string | null }).channelThumbnailUrl && !chanError ? (
                <img
                  src={(video as { channelThumbnailUrl?: string | null }).channelThumbnailUrl!}
                  alt={video.youtuberName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                  onError={() => setChanError(true)}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[9px] font-bold text-muted-foreground">
                  {video.youtuberName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <span className="truncate text-xs text-muted-foreground">{video.youtuberName}</span>
          </div>
        )}
        {cats.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {cats.map((cat) => (
              <Badge
                key={cat}
                variant="outline"
                className={cn("text-[10px] capitalize font-medium px-1.5 py-0", toolCategoryBadgeClass(cat))}
              >
                {cat}
              </Badge>
            ))}
          </div>
        )}
        {/* Watch toggle */}
        {onToggleWatched && (
          <button
            type="button"
            onClick={() => onToggleWatched(video.id, watched)}
            className={cn(
              "mt-auto inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
              watched
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/50"
                : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-400/40 hover:bg-rose-500/20",
            )}
          >
            {watched ? <CheckCircle2 className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {watched ? "Watched" : "Mark watched"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

/** Skeleton cards for loading state */
function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col overflow-hidden rounded-xl border border-border/40 bg-card">
          <div className="aspect-video w-full animate-pulse bg-muted/60" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-64 animate-pulse rounded-xl border border-border/40 bg-muted/50" />
      ))}
    </div>
  );
}

function VideosPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken: authAccessToken } = useAuthSession();

  const viewMode: ViewMode = searchParams.get("view") === "creators" ? "creators" : "videos";
  const setView = (mode: ViewMode) => {
    router.replace(mode === "creators" ? "/videos?view=creators" : "/videos", { scroll: false });
  };

  // Layout mode — persisted to localStorage
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("grid");
  useEffect(() => {
    const saved = localStorage.getItem("videos:layoutMode");
    if (saved === "list" || saved === "grid") setLayoutMode(saved);
  }, []);
  const setLayout = useCallback((mode: LayoutMode) => {
    setLayoutMode(mode);
    localStorage.setItem("videos:layoutMode", mode);
  }, []);

  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedYoutuber, setSelectedYoutuber] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);

  const pageSize = layoutMode === "grid" ? PAGE_SIZE_GRID : PAGE_SIZE_LIST;

  // Build the URL params for API calls
  const buildParams = useCallback(
    (currentOffset: number) => {
      const params = new URLSearchParams();
      if (selectedCategory) params.append("category", selectedCategory);
      if (selectedYoutuber) params.append("youtuber", selectedYoutuber);
      if (sourceFilter === "youtube" || sourceFilter === "tiktok") params.append("source", sourceFilter);
      const tokens = [...filters, search].map((t) => t.trim()).filter(Boolean);
      if (tokens.length > 0) params.append("search", tokens.join(" "));
      params.append("sort", sort);
      params.append("limit", String(pageSize));
      params.append("offset", String(currentOffset));
      return params.toString();
    },
    [selectedCategory, selectedYoutuber, sourceFilter, filters, search, sort, pageSize],
  );

  // Initial / filter-change fetch (resets list)
  const fetchVideos = useCallback(async () => {
    setLoading(true);
    setOffset(0);
    try {
      const response = await fetch(`/api/videos?${buildParams(0)}`);
      if (!response.ok) { setVideos([]); setTotal(0); return; }
      const data = await response.json() as { videos?: Video[]; total?: number };
      const list = Array.isArray(data) ? data : (data.videos ?? []);
      setVideos(list);
      setTotal(typeof data.total === "number" ? data.total : list.length);
    } catch {
      setVideos([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  // Debounce filter changes
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(fetchVideos, search ? 300 : 0);
    return () => clearTimeout(fetchTimerRef.current);
  }, [fetchVideos]);

  // Load more
  const handleLoadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const nextOffset = offset + pageSize;
    try {
      const response = await fetch(`/api/videos?${buildParams(nextOffset)}`);
      if (!response.ok) return;
      const data = await response.json() as { videos?: Video[]; total?: number };
      const list = Array.isArray(data) ? data : (data.videos ?? []);
      setVideos((prev) => [...prev, ...list]);
      setOffset(nextOffset);
      if (typeof data.total === "number") setTotal(data.total);
    } catch {/* */} finally {
      setLoadingMore(false);
    }
  }, [loadingMore, offset, pageSize, buildParams]);

  // Watched IDs
  useEffect(() => {
    if (!authAccessToken) { setWatchedIds([]); return; }
    fetch("/api/videos/watched", { headers: { Authorization: `Bearer ${authAccessToken}` } })
      .then((r) => r.ok ? r.json() : { watchedIds: [] })
      .then((d: { watchedIds?: string[] }) => setWatchedIds(d.watchedIds || []))
      .catch(() => setWatchedIds([]));
  }, [authAccessToken]);

  const watchedSet = useMemo(() => new Set(watchedIds), [watchedIds]);

  const handleToggleWatched = useCallback(
    async (videoId: string, currentlyWatched: boolean) => {
      if (!authAccessToken) return;
      setWatchedIds((prev) =>
        currentlyWatched ? prev.filter((id) => id !== videoId) : [...prev, videoId]
      );
      try {
        const res = await fetch(`/api/videos/${videoId}/watched`, {
          method: currentlyWatched ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authAccessToken}` },
        });
        if (!res.ok) {
          setWatchedIds((prev) =>
            currentlyWatched ? [...prev, videoId] : prev.filter((id) => id !== videoId)
          );
        }
      } catch {
        setWatchedIds((prev) =>
          currentlyWatched ? [...prev, videoId] : prev.filter((id) => id !== videoId)
        );
      }
    },
    [authAccessToken],
  );

  const creators = useMemo(() => {
    const map = new Map<string, {
      name: string; subscriberCount: number | null; count: number;
      channelThumbnailUrl: string | null; channelVideoCount: number | null;
      youtubeCount: number; tiktokCount: number;
    }>();
    videos.forEach((v) => {
      if (!v.youtuberName) return;
      const key = v.youtuberName;
      const cur = map.get(key);
      const channelThumbnailUrl = (v as { channelThumbnailUrl?: string | null }).channelThumbnailUrl ?? null;
      const channelVideoCount = (v as { channelVideoCount?: number | null }).channelVideoCount ?? null;
      const source = (v as { source?: "youtube" | "tiktok" | null }).source ?? "youtube";
      if (!cur) {
        map.set(key, { name: v.youtuberName, subscriberCount: v.subscriberCount, count: 1,
          channelThumbnailUrl: channelThumbnailUrl || null, channelVideoCount: channelVideoCount ?? null,
          youtubeCount: source === "youtube" ? 1 : 0, tiktokCount: source === "tiktok" ? 1 : 0 });
      } else {
        map.set(key, { ...cur,
          subscriberCount: v.subscriberCount != null && (cur.subscriberCount == null || v.subscriberCount > cur.subscriberCount)
            ? v.subscriberCount : cur.subscriberCount,
          count: cur.count + 1,
          channelThumbnailUrl: channelThumbnailUrl || cur.channelThumbnailUrl,
          channelVideoCount: channelVideoCount != null && (cur.channelVideoCount == null || channelVideoCount > cur.channelVideoCount)
            ? channelVideoCount : cur.channelVideoCount,
          youtubeCount: cur.youtubeCount + (source === "youtube" ? 1 : 0),
          tiktokCount: cur.tiktokCount + (source === "tiktok" ? 1 : 0),
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => (b.subscriberCount ?? 0) - (a.subscriberCount ?? 0));
  }, [videos]);

  const videoFilterCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const v of videos) for (const c of videoCategoryList(v)) if (c?.trim()) seen.add(c.trim());
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [videos]);

  const searchSuggestions = useMemo(() => {
    const titles = videos.map((v) => v.title);
    const cats = videos.flatMap((v) => videoCategoryList(v));
    const creatorNames = creators.map((c) => c.name);
    return Array.from(new Set([...titles, ...cats, ...creatorNames]));
  }, [videos, creators]);

  const addFilter = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (lower === "youtube" || lower === "yt") { setSourceFilter("youtube"); return; }
    if (lower === "tiktok" || lower === "tt") { setSourceFilter("tiktok"); return; }
    setFilters((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  }, []);

  const removeFilter = useCallback((term: string) => {
    setFilters((prev) => prev.filter((f) => f !== term));
  }, []);

  const hasMore = videos.length < total;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border/40 bg-gradient-to-br from-rose-500/10 via-orange-500/10 to-amber-500/10 dark:from-rose-950/30 dark:via-orange-950/20 dark:to-amber-950/20">
        <div className="container mx-auto px-4 py-10 sm:py-14">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-rose-500/10 p-4 dark:bg-rose-500/20">
              <Youtube className="h-10 w-10 text-rose-500 dark:text-rose-400" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              <span className="bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-transparent">
                Curated Videos
              </span>
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
              Hand-picked YouTube and TikTok videos on motivation, money, AI, cars & more.
            </p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-8">
        {/* Videos | Creators toggle */}
        <div className="flex items-center justify-between">
          <div className="inline-flex rounded-xl bg-muted/50 p-1">
            <button type="button" onClick={() => setView("videos")}
              className={cn("rounded-lg px-5 py-2.5 text-sm font-semibold transition-all",
                viewMode === "videos" ? "bg-background text-foreground shadow ring-1 ring-border/50" : "text-muted-foreground hover:text-foreground hover:bg-background/50")}
            >
              <span className={cn(viewMode === "videos" && "bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-transparent")}>Videos</span>
            </button>
            <button type="button" onClick={() => setView("creators")}
              className={cn("rounded-lg px-5 py-2.5 text-sm font-semibold transition-all",
                viewMode === "creators" ? "bg-background text-foreground shadow ring-1 ring-border/50" : "text-muted-foreground hover:text-foreground hover:bg-background/50")}
            >
              <span className={cn(viewMode === "creators" && "bg-gradient-to-r from-emerald-500 to-cyan-500 bg-clip-text text-transparent")}>Creators</span>
            </button>
          </div>

          {/* Grid/List toggle — only in videos mode */}
          {viewMode === "videos" && (
            <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
              <button type="button" title="Grid view" onClick={() => setLayout("grid")}
                className={cn("flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  layoutMode === "grid" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button type="button" title="List view" onClick={() => setLayout("list")}
                className={cn("flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  layoutMode === "list" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Search + filters row */}
        {(viewMode === "videos" || viewMode === "creators") && (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex-1 max-w-xl">
              <SearchBar
                value={search} onChange={setSearch}
                placeholder="Search videos, creators, or categories..."
                suggestions={searchSuggestions}
                onSubmit={(term) => { addFilter(term); setSearch(""); }}
                onSelectSuggestion={(term) => { addFilter(term); setSearch(""); }}
              />
              {filters.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {filters.map((f) => (
                    <button key={f} type="button" onClick={() => removeFilter(f)}
                      className="group inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      <span className="max-w-[140px] truncate">{f}</span>
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground group-hover:bg-rose-500 group-hover:text-white cursor-pointer">×</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
                {(["all", "youtube", "tiktok"] as const).map((src) => (
                  <button key={src} type="button" onClick={() => setSourceFilter(src)}
                    className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      sourceFilter === src ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}
                  >
                    {src === "all" ? "All" : src === "youtube" ? "YouTube" : "TikTok"}
                  </button>
                ))}
              </div>
              <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Sort by" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="alphabetical">A–Z</SelectItem>
                  <SelectItem value="subscribers">Subscribers</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Categories */}
        {(viewMode === "videos" || viewMode === "creators") && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Film className="h-4 w-4" /> Category
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant={selectedCategory === null ? "default" : "outline"}
                className={cn("cursor-pointer transition-all", selectedCategory === null && "bg-gradient-to-r from-rose-500/80 to-orange-500/80 hover:opacity-90")}
                onClick={() => setSelectedCategory(null)}
              >All</Badge>
              {videoFilterCategories.map((cat) => (
                <Badge key={cat} variant={selectedCategory === cat ? "default" : "outline"}
                  className={cn("cursor-pointer transition-all text-xs font-medium capitalize",
                    selectedCategory === cat ? "bg-gradient-to-r from-rose-500/80 to-orange-500/80 hover:opacity-90 border-transparent" : toolCategoryBadgeClass(cat))}
                  onClick={() => setSelectedCategory((prev) => (prev === cat ? null : cat))}
                >{cat}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Creators horizontal strip */}
        {viewMode === "videos" && creators.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-rose-500" /> Creators
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              <button type="button" onClick={() => setSelectedYoutuber(null)}
                className={cn("flex-shrink-0 rounded-xl border-2 px-4 py-3 text-left transition-all",
                  selectedYoutuber === null ? "border-rose-500 bg-rose-500/10 text-foreground" : "border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground")}
              >
                <span className="font-medium">All creators</span>
              </button>
              {creators.map((c) => {
                const primarySource = c.tiktokCount > c.youtubeCount ? "tiktok" : "youtube";
                const subsLabel = formatSubs(c.subscriberCount);
                return (
                  <button key={c.name} type="button" onClick={() => setSelectedYoutuber((prev) => (prev === c.name ? null : c.name))}
                    className={cn("flex-shrink-0 rounded-xl border-2 px-4 py-3 text-left min-w-[140px] transition-all",
                      selectedYoutuber === c.name ? "border-rose-500 bg-rose-500/10 text-foreground" : "border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground")}
                  >
                    <div className="flex items-center gap-3">
                      <CreatorAvatar name={c.name} src={c.channelThumbnailUrl} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{c.name}</p>
                        {subsLabel && (
                          <p className="text-xs text-muted-foreground">
                            {subsLabel} {primarySource === "tiktok" ? "followers" : "subscribers"} · {(c.channelVideoCount ?? c.count).toLocaleString()} video{(c.channelVideoCount ?? c.count) !== 1 ? "s" : ""}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5">
                            {primarySource === "tiktok" ? "TikTok creator" : "YouTube creator"}
                          </span>
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Full Creators view */}
        {viewMode === "creators" && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Users className="h-6 w-6 text-rose-500" /> All Creators
            </h2>
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/50" />)}
              </div>
            ) : creators.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Users className="h-14 w-14 text-muted-foreground/50 mb-4" />
                <p className="text-lg text-muted-foreground">No creators yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {creators.map((c) => {
                  const primarySource = c.tiktokCount > c.youtubeCount ? "tiktok" : "youtube";
                  const subsLabel = formatSubs(c.subscriberCount);
                  return (
                    <button key={c.name} type="button"
                      onClick={() => { setSelectedYoutuber(c.name); setView("videos"); }}
                      className="rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-rose-500/50 hover:bg-muted/30"
                    >
                      <div className="flex items-center gap-4">
                        <CreatorAvatar name={c.name} src={c.channelThumbnailUrl} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold truncate">{c.name}</p>
                          {subsLabel && <p className="text-sm text-muted-foreground">{subsLabel} {primarySource === "tiktok" ? "followers" : "subscribers"}</p>}
                          <p className="text-xs text-muted-foreground mt-0.5">{(c.channelVideoCount ?? c.count).toLocaleString()} video{(c.channelVideoCount ?? c.count) !== 1 ? "s" : ""}</p>
                          <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5">
                              {primarySource === "tiktok" ? "TikTok creator" : "YouTube creator"}
                            </span>
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Video results */}
        {viewMode === "videos" && (
          <>
            {loading ? (
              layoutMode === "grid" ? <GridSkeleton count={12} /> : <ListSkeleton count={4} />
            ) : videos.length === 0 ? null : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {videos.length}{total > videos.length ? ` of ${total}` : ""} video{total !== 1 ? "s" : ""}
                  </p>
                </div>

                {layoutMode === "grid" ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6">
                    {videos.map((video) => (
                      <VideoGridCard
                        key={video.id}
                        video={video}
                        watched={watchedSet.has(video.id)}
                        onToggleWatched={authAccessToken ? handleToggleWatched : undefined}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {videos.map((video, index) => (
                      <VideoCard
                        key={video.id}
                        video={video}
                        index={index}
                        watched={watchedSet.has(video.id)}
                        onToggleWatched={handleToggleWatched}
                      />
                    ))}
                  </div>
                )}

                {/* Load more */}
                {hasMore && (
                  <div className="flex justify-center pt-4">
                    <button
                      type="button"
                      onClick={() => void handleLoadMore()}
                      disabled={loadingMore}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:border-rose-400/50 hover:text-foreground disabled:opacity-50"
                    >
                      {loadingMore ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
                      ) : (
                        `Load more (${total - videos.length} remaining)`
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function VideosPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-16 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-rose-500 border-t-transparent" />
      </div>
    }>
      <VideosPageContent />
    </Suspense>
  );
}
