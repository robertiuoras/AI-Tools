"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Video } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Eye, CheckCircle2 } from "lucide-react";

interface VideoCardProps {
  video: Video;
  index?: number;
  watched?: boolean;
  onToggleWatched?: (videoId: string, watched: boolean) => void;
}

const CATEGORY_EMOJI: Record<string, string> = {
  Motivational: "🚀",
  Cars: "🏎️",
  Money: "💰",
  AI: "🤖",
  Other: "📌",
};

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

/** TikTok: extract video id from @user/video/ID or return embed URL; short links (vm/vt) return null */
function getTikTokEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host !== "www.tiktok.com" && host !== "tiktok.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const videoIdx = parts.indexOf("video");
    if (videoIdx >= 0 && parts[videoIdx + 1]) {
      const id = parts[videoIdx + 1];
      return `https://www.tiktok.com/embed/v2/${id}`;
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
  const source = (video as { source?: string }).source ?? "youtube";
  const [showEmbed, setShowEmbed] = useState(source !== "tiktok");
  const embedUrl = source === "youtube" ? getYoutubeEmbedUrl(video.url) : null;
  const subscriberLabel = formatSubscribers(video.subscriberCount);
  const tagsArray =
    typeof video.tags === "string"
      ? video.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  const categoryEmoji = CATEGORY_EMOJI[video.category] ?? "";

  // Load TikTok embed script on demand when showing a TikTok embed
  useEffect(() => {
    if (source !== "tiktok" || !showEmbed) return;
    if (typeof window === "undefined") return;

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.tiktok.com/embed.js"]'
    );
    if (existing) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.tiktok.com/embed.js";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      // keep script so multiple cards reuse it; no cleanup
    };
  }, [source, showEmbed]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.15) }}
    >
      <Card className="overflow-hidden border-border/50 bg-card max-w-2xl mx-auto">
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
              <Badge variant="outline" className="text-xs">
                {categoryEmoji && <span className="mr-1">{categoryEmoji}</span>}
                {video.category}
              </Badge>
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

          {source === "tiktok" && !showEmbed && (
            <button
              type="button"
              onClick={() => setShowEmbed(true)}
              className="w-full max-w-2xl mx-auto overflow-hidden rounded-lg border border-border/70 bg-gradient-to-br from-zinc-900 via-black to-zinc-900 text-left shadow-sm transition-colors hover:border-rose-500/60"
            >
              <div className="relative w-full" style={{ paddingTop: "177.78%" }}>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white border border-white/20">
                    TikTok · Click to play
                  </span>
                </div>
              </div>
            </button>
          )}

          {showEmbed && source === "tiktok" && (
            <div className="w-full overflow-hidden rounded-lg bg-background max-w-2xl mx-auto">
              <div className="relative w-full" style={{ paddingTop: "177.78%" }}>
                <blockquote
                  className="tiktok-embed absolute inset-0"
                  cite={video.url}
                  data-video-id={undefined}
                  style={{ maxWidth: 605, minWidth: 325, margin: 0 }}
                >
                  <section>
                    <a href={video.url} target="_blank" rel="noopener noreferrer">
                      {video.title}
                    </a>
                  </section>
                </blockquote>
              </div>
            </div>
          )}

          {showEmbed && source === "youtube" && embedUrl && (
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

          {source === "tiktok" && !showEmbed && !embedUrl && (
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-lg border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground hover:underline"
            >
              Watch on TikTok →
            </a>
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

