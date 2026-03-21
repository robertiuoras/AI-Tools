"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Star, TrendingUp, ThumbsUp, Heart } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { Tool } from "@/lib/supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";

export type ToolCardLayout = "grid" | "list";

interface ToolCardProps {
  tool: Tool;
  index?: number;
  layout?: ToolCardLayout;
}

const categoryColors: Record<string, string> = {
  "AI Agents": "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  "AI Automation": "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  Analytics: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "Code Assistants": "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  "Customer Support": "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  Design: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  Education: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  "Image Generation": "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  Language: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
  Legal: "bg-slate-500/10 text-slate-700 dark:text-slate-400",
  Marketing: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  "Music & Audio": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Other: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
  Productivity: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  Research: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  SaaS: "bg-green-500/10 text-green-700 dark:text-green-400",
  "Video Editing": "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  "Voice & Audio": "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  Writing: "bg-lime-500/10 text-lime-800 dark:text-lime-400",
};

function categoryBadgeClass(category: string) {
  return categoryColors[category] ?? categoryColors.Other;
}

/** Lets long names like "DeepLearning.AI" wrap at dots instead of mid-word. */
function titleWithSoftBreaks(name: string): string {
  return name
    .replace(/\.(?=\S)/g, ".\u200B")
    .replace(/\/(?=\S)/g, "/\u200B");
}

const trafficLabels: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  unknown: "Unknown",
};

export function ToolCard({
  tool,
  index = 0,
  layout = "grid",
}: ToolCardProps) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [upvoteCount, setUpvoteCount] = useState(tool.upvoteCount || 0);
  const [userUpvoted, setUserUpvoted] = useState(tool.userUpvoted || false);
  const [upvoting, setUpvoting] = useState(false);
  const [userFavorited, setUserFavorited] = useState(tool.userFavorited || false);
  const [favoriting, setFavoriting] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user && tool.id) {
      const loadFavoriteStatus = async () => {
        try {
          const session = await supabase.auth.getSession();
          const token = (await session).data.session?.access_token;
          const response = await fetch(`/api/tools/${tool.id}/favorite`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (response.ok) {
            const data = await response.json();
            setUserFavorited(data.favorited);
          }
        } catch (error) {
          console.error("Error loading favorite status:", error);
        }
      };
      loadFavoriteStatus();
    }
  }, [user, tool.id]);

  const handleUpvote = async () => {
    if (!user) {
      alert("Please log in to upvote tools");
      return;
    }

    setUpvoting(true);
    try {
      const session = await supabase.auth.getSession();
      const token = (await session).data.session?.access_token;

      const response = await fetch(`/api/tools/${tool.id}/upvote`, {
        method: userUpvoted ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || errorData.error || "Failed to upvote",
        );
      }

      const data = await response.json();
      setUpvoteCount(data.upvoteCount);
      setUserUpvoted(data.userUpvoted);
    } catch (error: unknown) {
      console.error("Error upvoting:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to upvote. Please try again.",
      );
    } finally {
      setUpvoting(false);
    }
  };

  const handleFavorite = async () => {
    if (!user) {
      alert("Please log in to favorite tools");
      return;
    }

    setFavoriting(true);
    try {
      const session = await supabase.auth.getSession();
      const token = (await session).data.session?.access_token;

      const response = await fetch(`/api/tools/${tool.id}/favorite`, {
        method: userFavorited ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || errorData.error || "Failed to favorite",
        );
      }

      const data = await response.json();
      setUserFavorited(data.favorited);
    } catch (error: unknown) {
      console.error("Error favoriting:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to favorite. Please try again.",
      );
    } finally {
      setFavoriting(false);
    }
  };

  const maxDescriptionLength = 120;
  const shouldTruncate = tool.description.length > maxDescriptionLength;
  const displayDescription =
    descriptionExpanded || !shouldTruncate
      ? tool.description
      : tool.description.substring(0, maxDescriptionLength) + "...";

  const formatVisits = (visits?: number | null) => {
    if (!visits) return null;
    if (visits >= 1000000) return `${(visits / 1000000).toFixed(1)}M`;
    if (visits >= 1000) return `${(visits / 1000).toFixed(1)}K`;
    return visits.toString();
  };

  const logoBlock = (
    <>
      {tool.logoUrl ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-background sm:h-10 sm:w-10">
          <Image
            src={tool.logoUrl}
            alt=""
            fill
            className="object-cover"
            sizes="48px"
            unoptimized
          />
        </div>
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-gradient-to-br from-primary/20 to-secondary/20 sm:h-10 sm:w-10">
          <span className="text-lg font-bold text-primary sm:text-base">
            {tool.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
    </>
  );

  const ratingBlock =
    tool.rating != null ? (
      <div
        className="flex shrink-0 items-center gap-1"
        title="Curated 0–5 estimate from listings / analysis (not averaged user reviews)"
      >
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => {
            const rating = tool.rating!;
            const fillAmount = Math.max(0, Math.min(1, rating - (star - 1)));
            const isEmpty = fillAmount < 0.5;
            return (
              <div key={star} className="relative inline-flex h-3.5 w-3.5">
                <Star
                  className={cn(
                    "h-3.5 w-3.5 text-yellow-200 dark:text-yellow-900/30",
                    isEmpty && "fill-transparent",
                  )}
                />
                {!isEmpty && (
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ width: `${fillAmount * 100}%` }}
                  >
                    <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <span className="whitespace-nowrap text-xs font-medium text-foreground sm:text-sm">
          {tool.rating.toFixed(1)}
        </span>
      </div>
    ) : null;

  const metaChips = (
    <>
      {tool.traffic && tool.traffic !== "unknown" && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
          <TrendingUp className="h-3 w-3 shrink-0" />
          {trafficLabels[tool.traffic]}
        </span>
      )}
      {tool.estimatedVisits != null && (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          ~{formatVisits(tool.estimatedVisits)}/mo
        </span>
      )}
      {tool.revenue && (
        <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
          {tool.revenue}
        </Badge>
      )}
    </>
  );

  if (layout === "list") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: index * 0.02 }}
      >
        <Card className="overflow-hidden border-border/50 transition-colors hover:border-primary/40">
          <CardContent className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {logoBlock}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 gap-y-1">
                  <h3
                    className="min-w-0 max-w-full text-balance text-base font-semibold leading-tight text-foreground [overflow-wrap:anywhere] [word-break:normal]"
                    title={tool.name}
                  >
                    {titleWithSoftBreaks(tool.name)}
                  </h3>
                  <Badge
                    variant="outline"
                    className={cn(
                      "max-w-[min(100%,12rem)] shrink-0 truncate text-xs",
                      categoryBadgeClass(tool.category),
                    )}
                    title={tool.category}
                  >
                    {tool.category}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {tool.description}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/50 pt-2 sm:border-0 sm:pt-0 md:gap-3">
              <div className="flex flex-wrap items-center gap-2">{ratingBlock}</div>
              <div className="flex flex-wrap items-center gap-2">{metaChips}</div>
              <div className="ml-auto flex items-center gap-1 sm:ml-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFavorite}
                  disabled={favoriting || !user}
                  className={cn(
                    "h-9 w-9 shrink-0 p-0",
                    userFavorited && "text-red-500",
                  )}
                  aria-label="Favorite"
                >
                  <Heart
                    className={cn(
                      "h-4 w-4",
                      userFavorited && "fill-current",
                    )}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUpvote}
                  disabled={upvoting || !user}
                  title="Community upvotes this calendar month"
                  className={cn(
                    "h-9 gap-1 px-2",
                    userUpvoted && "text-primary",
                  )}
                >
                  <ThumbsUp
                    className={cn(
                      "h-4 w-4 shrink-0",
                      userUpvoted && "fill-current",
                    )}
                  />
                  <span className="text-sm font-medium">{upvoteCount}</span>
                </Button>
                <Button variant="outline" size="sm" className="h-9 shrink-0" asChild>
                  <Link
                    href={tool.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gap-1.5"
                  >
                    <span className="hidden sm:inline">Open</span>
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  /* —— Grid layout —— */
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="h-full min-h-0 min-w-0"
    >
      <Card className="group relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-border/50 bg-card transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 dark:hover:shadow-primary/20">
        <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden p-4 sm:p-5">
          <div className="mb-3 flex min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {tool.logoUrl ? (
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
                  <Image
                    src={tool.logoUrl}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="44px"
                    unoptimized
                  />
                </div>
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-gradient-to-br from-primary/20 to-secondary/20">
                  <span className="text-lg font-bold text-primary">
                    {tool.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3
                  className="mb-1 line-clamp-2 text-pretty text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere] [word-break:normal]"
                  title={tool.name}
                >
                  {titleWithSoftBreaks(tool.name)}
                </h3>
                <Badge
                  variant="outline"
                  className={cn(
                    "mt-0.5 inline-flex max-w-full items-center truncate text-xs",
                    categoryBadgeClass(tool.category),
                  )}
                  title={tool.category}
                >
                  {tool.category}
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFavorite}
              disabled={favoriting || !user}
              className={cn(
                "h-8 w-8 shrink-0 p-0",
                userFavorited && "text-red-500",
              )}
              aria-label="Favorite"
            >
              <Heart
                className={cn("h-4 w-4", userFavorited && "fill-current")}
              />
            </Button>
          </div>

          <div className="mb-3 min-h-0 min-w-0 flex-1 overflow-hidden">
            <p
              className={cn(
                "text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]",
                !descriptionExpanded && "line-clamp-4",
              )}
            >
              {displayDescription}
            </p>
            {shouldTruncate && (
              <button
                type="button"
                onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                className="mt-1 text-xs text-primary hover:underline"
              >
                {descriptionExpanded ? "Show less" : "Show more…"}
              </button>
            )}
          </div>

          <div className="mt-auto flex min-w-0 flex-col gap-2 border-t border-border/40 pt-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUpvote}
                disabled={upvoting || !user}
                title="Community upvotes this calendar month"
                className={cn(
                  "h-8 shrink-0 gap-1.5 px-2",
                  userUpvoted && "text-primary",
                )}
              >
                <ThumbsUp
                  className={cn(
                    "h-4 w-4 shrink-0",
                    userUpvoted && "fill-current",
                  )}
                />
                <span className="tabular-nums text-sm font-medium">
                  {upvoteCount}
                </span>
              </Button>
              {ratingBlock ? (
                <div className="flex min-w-0 items-center border-l border-border/50 pl-3">
                  {ratingBlock}
                </div>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {metaChips}
            </div>
          </div>
        </CardContent>

        <CardFooter className="mt-0 shrink-0 border-t border-border/50 p-3 sm:p-4">
          <Button
            asChild
            variant="ghost"
            className="h-9 w-full group-hover:bg-primary/10"
          >
            <Link
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2"
            >
              View Tool
              <ExternalLink className="h-4 w-4 shrink-0" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
