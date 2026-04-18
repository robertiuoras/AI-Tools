"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Video } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Eye, CheckCircle2, ExternalLink } from "lucide-react";
import { videoCategoryList } from "@/lib/tool-categories";
import { toolCategoryBadgeClass } from "@/lib/tool-category-styles";

function isVideoRecent(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
}

interface VideoCardProps {
  video: Video;
  index?: number;
  watched?: boolean;
  onToggleWatched?: (videoId: string, watched: boolean) => void;
}

/**
 * Parse a TikTok URL and return the numeric video id if we can find one.
 * Handles canonical `/@user/video/{id}`, the bare `/video/{id}`, and
 * shortlinks `vm.tiktok.com/{slug}` / `vt.tiktok.com/{slug}` (returns null
 * for shortlinks since we can't expand them client-side — those still fall
 * back to the external link card).
 */
function getTikTokVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/video\/(\d+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function getYoutubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);

    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) {
        return `https://www.youtube.com/embed/${v}`;
      }
      // Handle /embed/ID or /shorts/ID
      const parts = u.pathname.split("/").filter(Boolean);
      const id = parts[parts.length - 1];
      if (id) {
        return `https://www.youtube.com/embed/${id}`;
      }
    }

    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace("/", "");
      if (id) {
        return `https://www.youtube.com/embed/${id}`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function formatSubscribers(count: number | null): string | null {
  if (count === null || count === undefined) return null;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

export function VideoCard({
  video,
  index = 0,
  watched = false,
  onToggleWatched,
}: VideoCardProps) {
  const [channelImgError, setChannelImgError] = useState(false);
  const [tiktokPreviewError, setTiktokPreviewError] = useState(false);
  const source = (video as { source?: string }).source ?? "youtube";
  const embedUrl = source === "youtube" ? getYoutubeEmbedUrl(video.url) : null;
  const tiktokVideoId =
    source === "tiktok" ? getTikTokVideoId(video.url) : null;
  const subscriberLabel = formatSubscribers(video.subscriberCount);
  const tagsArray =
    typeof video.tags === "string"
      ? video.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  const categoryLabels = videoCategoryList(video);
  const isNew = isVideoRecent(video.createdAt);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.15) }}
    >
      <Card className="relative overflow-hidden border-border/50 bg-card max-w-2xl mx-auto">
        {isNew && (
          <div className="absolute left-0 top-0 z-10 p-1.5">
            <span className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow-sm">
              New
            </span>
          </div>
        )}
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3 items-start min-w-0">
              <div className="h-10 w-10 rounded-full overflow-hidden border border-border flex-shrink-0 bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                {video.channelThumbnailUrl && !channelImgError ? (
                  <img
                    src={video.channelThumbnailUrl}
                    alt={video.youtuberName || "Channel"}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={() => setChannelImgError(true)}
                  />
                ) : (
                  (video.youtuberName || "?").charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-foreground">
                  {video.title}
                </h3>
                {video.youtuberName && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    {video.youtuberName}
                    {video.verified === true && (
                      <span className="inline-flex items-center rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400" title="Verified">
                        ✓ Verified
                      </span>
                    )}
                    {subscriberLabel && (
                      <span className="text-xs">
                        • {subscriberLabel} {source === "tiktok" ? "followers" : "subscribers"}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-start sm:justify-end items-center">
              {onToggleWatched && (
                <button
                  type="button"
                  onClick={() => onToggleWatched?.(video.id, watched)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-[0.98]",
                    watched
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/50 shadow-sm shadow-emerald-500/10"
                      : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-400/40 hover:bg-rose-500/20 hover:border-rose-500/60 shadow-sm"
                  )}
                >
                  {watched ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Watched
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5 shrink-0" />
                      Mark as watched
                    </>
                  )}
                </button>
              )}
              {categoryLabels.map((cat) => (
                <Badge
                  key={cat}
                  variant="outline"
                  className={cn("text-xs font-medium capitalize", toolCategoryBadgeClass(cat))}
                >
                  {cat}
                </Badge>
              ))}
              {tagsArray.length > 0 && (
                <div className="flex flex-wrap gap-1 max-w-xs justify-end">
                  {tagsArray.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* TikTok: prefer the official embed iframe when we can parse a
              numeric video id from the URL; fall back to the external-link
              card for shortlinks (vm.tiktok.com / vt.tiktok.com) or any URL
              we can't resolve client-side. The embed uses TikTok's portrait
              9:16 aspect to avoid letterboxing. */}
          {source === "tiktok" && tiktokVideoId && (
            <div
              className="relative w-full mx-auto overflow-hidden rounded-xl border border-border/70 bg-black shadow-md"
              style={{ maxWidth: "min(100%, 360px)" }}
            >
              <div
                className="relative w-full"
                style={{ paddingTop: "177.78%" /* 16:9 inverted = portrait */ }}
              >
                <iframe
                  src={`https://www.tiktok.com/embed/v2/${tiktokVideoId}`}
                  title={video.title}
                  className="absolute inset-0 h-full w-full"
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <a
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-sm transition-colors hover:bg-black/80"
                title="Open in TikTok"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                Open
              </a>
            </div>
          )}
          {source === "tiktok" && !tiktokVideoId && (
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex w-full max-w-2xl mx-auto overflow-hidden rounded-xl border border-border/70 bg-gradient-to-br from-zinc-950 via-black to-zinc-950 shadow-md transition-all hover:border-rose-500/45 hover:shadow-lg hover:shadow-rose-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
            >
              <div className="relative min-h-[160px] flex-1 sm:min-h-[180px]">
                {video.channelThumbnailUrl && !tiktokPreviewError ? (
                  <>
                    <img
                      src={video.channelThumbnailUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover opacity-35 transition-opacity group-hover:opacity-45"
                      loading="lazy"
                      decoding="async"
                      onError={() => setTiktokPreviewError(true)}
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/75 to-black/50" />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-rose-950/40 via-black to-cyan-950/30" />
                )}
                <div className="relative flex h-full min-h-[160px] flex-col items-center justify-center gap-3 px-6 py-8 text-center sm:flex-row sm:text-left sm:justify-between sm:px-8">
                  <div className="space-y-1">
                    <Badge
                      variant="outline"
                      className="border-white/25 bg-white/10 text-white backdrop-blur-sm"
                    >
                      TikTok
                    </Badge>
                    <p className="text-sm font-medium text-white">
                      Watch on TikTok
                    </p>
                    <p className="text-xs text-white/65 max-w-[240px] sm:max-w-xs">
                      Shortlink — opens in a new tab.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-lg transition-transform group-hover:scale-[1.02] group-active:scale-[0.98]">
                    <ExternalLink className="h-4 w-4" aria-hidden />
                    Open video
                  </span>
                </div>
              </div>
            </a>
          )}

          {source === "youtube" && embedUrl && (
            <div className="w-full overflow-hidden rounded-lg bg-black max-w-2xl mx-auto">
              <div
                className="relative w-full"
                style={{ paddingTop: "56.25%" }}
              >
                <iframe
                  src={embedUrl}
                  title={video.title}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </div>
          )}

          {video.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {video.description}
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

