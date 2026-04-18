"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import {
  ExternalLink,
  Star,
  TrendingUp,
  ThumbsDown,
  ThumbsUp,
  Heart,
} from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Tool } from "@/lib/supabase";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { cn } from "@/lib/utils";
import { toolCategoryListForBadges, toolIsAgency } from "@/lib/tool-categories";
import { isToolCreatedToday } from "@/lib/tool-dates";
import { toolCategoryBadgeClass } from "@/lib/tool-category-styles";
import { toolHasDownloadableApp } from "@/lib/tool-flags";

export type ToolCardLayout = "grid" | "list";

interface ToolCardProps {
  tool: Tool;
  index?: number;
  layout?: ToolCardLayout;
}

/**
 * Softer wrap points for product names: camelCase boundaries, then dots/slashes.
 * Helps avoid splits like "DeepLearnin" / "g.AI".
 */
function titleDisplayBreaks(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, "$1\u200B$2")
    .replace(/\.(?=\S)/g, ".\u200B")
    .replace(/\/(?=\S)/g, "/\u200B");
}

const trafficLabels: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  unknown: "Unknown",
};

type VoteSnap = {
  upvoteCount: number;
  downvoteCount: number;
  userUpvoted: boolean;
  userDownvoted: boolean;
};

/** % of voters who upvoted: up / (up + down), e.g. 5 up + 1 down → 83% */
function likePercentage(up: number, down: number): string | null {
  const u = Math.max(0, Math.round(Number(up)));
  const d = Math.max(0, Math.round(Number(down)));
  const total = u + d;
  if (total === 0) return null;
  const pct = Math.round((u / total) * 100);
  return `${pct}%`;
}

const revenueBadgeTone: Record<string, string> = {
  free:
    "border-green-600/50 bg-green-500/15 text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-400",
  freemium:
    "border-blue-600/50 bg-blue-500/15 text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-400",
  paid:
    "border-red-600/50 bg-red-500/15 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400",
  enterprise:
    "border-orange-600/50 bg-orange-500/15 text-orange-800 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-400",
};

function revenueBadgeClassName(revenue: string): string {
  const key = revenue.toLowerCase().trim();
  return revenueBadgeTone[key] ?? "";
}

async function parseVoteResponseBody(res: Response): Promise<{
  message?: string;
  error?: string;
  upvoteCount?: number;
  downvoteCount?: number;
  userUpvoted?: boolean;
  userDownvoted?: boolean;
}> {
  try {
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text) as {
      message?: string;
      error?: string;
      upvoteCount?: number;
      downvoteCount?: number;
      userUpvoted?: boolean;
      userDownvoted?: boolean;
    };
  } catch {
    return {};
  }
}

export function ToolCard({
  tool,
  index = 0,
  layout = "grid",
}: ToolCardProps) {
  const { user, accessToken } = useAuthSession();
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const [upvoteCount, setUpvoteCount] = useState(tool.upvoteCount ?? 0);
  const [downvoteCount, setDownvoteCount] = useState(tool.downvoteCount ?? 0);
  const [userUpvoted, setUserUpvoted] = useState(!!tool.userUpvoted);
  const [userDownvoted, setUserDownvoted] = useState(!!tool.userDownvoted);
  const [voteBusy, setVoteBusy] = useState(false);
  const [userFavorited, setUserFavorited] = useState(tool.userFavorited || false);
  const [favoriting, setFavoriting] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  useEffect(() => {
    if (!accessToken || !tool.id) return;
    const loadFavoriteStatus = async () => {
      try {
        const response = await fetch(`/api/tools/${tool.id}/favorite`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
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
    void loadFavoriteStatus();
  }, [accessToken, tool.id]);

  useEffect(() => {
    setUpvoteCount(tool.upvoteCount ?? 0);
    setDownvoteCount(tool.downvoteCount ?? 0);
    setUserUpvoted(!!tool.userUpvoted);
    setUserDownvoted(!!tool.userDownvoted);
  }, [
    tool.id,
    tool.upvoteCount,
    tool.downvoteCount,
    tool.userUpvoted,
    tool.userDownvoted,
  ]);

  const applyVoteSnap = (data: VoteSnap) => {
    setUpvoteCount(data.upvoteCount);
    setDownvoteCount(data.downvoteCount);
    setUserUpvoted(data.userUpvoted);
    setUserDownvoted(data.userDownvoted);
  };

  const handleUpvote = async () => {
    if (!user) {
      alert("Please log in to vote on tools");
      return;
    }
    const prev: VoteSnap = {
      upvoteCount,
      downvoteCount,
      userUpvoted,
      userDownvoted,
    };
    if (userUpvoted) {
      setUpvoteCount((c) => Math.max(0, c - 1));
      setUserUpvoted(false);
    } else {
      setUpvoteCount((c) => c + 1);
      setUserUpvoted(true);
      if (userDownvoted) {
        setDownvoteCount((c) => Math.max(0, c - 1));
        setUserDownvoted(false);
      }
    }
    setVoteBusy(true);
    try {
      const token = accessTokenRef.current;
      const res = await fetch(`/api/tools/${tool.id}/upvote`, {
        method: prev.userUpvoted ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await parseVoteResponseBody(res);
      if (!res.ok) {
        throw new Error(
          data.message ||
            data.error ||
            (res.status === 401
              ? "Please log in to vote"
              : prev.userUpvoted
                ? "Failed to remove upvote"
                : "Failed to upvote"),
        );
      }
      applyVoteSnap(data as VoteSnap);
    } catch (error: unknown) {
      applyVoteSnap(prev);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to upvote. Please try again.",
      );
    } finally {
      setVoteBusy(false);
    }
  };

  const handleDownvote = async () => {
    if (!user) {
      alert("Please log in to vote on tools");
      return;
    }
    const prev: VoteSnap = {
      upvoteCount,
      downvoteCount,
      userUpvoted,
      userDownvoted,
    };
    if (userDownvoted) {
      setDownvoteCount((c) => Math.max(0, c - 1));
      setUserDownvoted(false);
    } else {
      setDownvoteCount((c) => c + 1);
      setUserDownvoted(true);
      if (userUpvoted) {
        setUpvoteCount((c) => Math.max(0, c - 1));
        setUserUpvoted(false);
      }
    }
    setVoteBusy(true);
    try {
      const token = accessTokenRef.current;
      const res = await fetch(`/api/tools/${tool.id}/downvote`, {
        method: prev.userDownvoted ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await parseVoteResponseBody(res);
      if (!res.ok) {
        throw new Error(
          data.message ||
            data.error ||
            (res.status === 401
              ? "Please log in to vote"
              : prev.userDownvoted
                ? "Failed to remove downvote"
                : "Failed to downvote"),
        );
      }
      applyVoteSnap(data as VoteSnap);
    } catch (error: unknown) {
      applyVoteSnap(prev);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to downvote. Please try again.",
      );
    } finally {
      setVoteBusy(false);
    }
  };

  const likePctLabel = likePercentage(upvoteCount, downvoteCount);

  const handleFavorite = async () => {
    if (!user) {
      alert("Please log in to favorite tools");
      return;
    }

    setFavoriting(true);
    try {
      const token = accessTokenRef.current;

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

  /** Full text from API/DB — never substring-truncate; preview uses line-clamp only. */
  const fullDescription = String(tool.description ?? "").trim();
  const needsExpandToggle = fullDescription.length > 100;

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

  const trafficVisitsRow = (
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
    </>
  );

  const revenueBadge = tool.revenue ? (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 text-[14px] font-medium capitalize leading-tight",
        revenueBadgeClassName(tool.revenue),
      )}
    >
      {tool.revenue}
    </Badge>
  ) : null;

  const isAgencyTool = toolIsAgency(tool);
  const toolCategories = toolCategoryListForBadges(tool);
  const isNewToday = isToolCreatedToday(tool.createdAt);
  const hasDownloadableApp = toolHasDownloadableApp(tool);

  const ribbonClass =
    "pointer-events-none rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow-sm sm:text-[10px]";

  const cardRibbons =
    isNewToday || hasDownloadableApp ? (
      <div className="absolute left-0 top-0 z-20 flex max-w-[min(100%,16rem)] flex-row flex-wrap gap-1 p-1.5">
        {isNewToday ? (
          <div className={cn(ribbonClass, "bg-gradient-to-r from-emerald-500 to-teal-500")} aria-hidden>
            New
          </div>
        ) : null}
        {hasDownloadableApp ? (
          <div className={cn(ribbonClass, "bg-gradient-to-r from-teal-600 to-emerald-600")} aria-hidden>
            App
          </div>
        ) : null}
      </div>
    ) : null;

  const agencyBanner = isAgencyTool ? (
    <div
      className="w-full rounded-t-lg bg-gradient-to-r from-orange-600 via-amber-500 to-orange-500 px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm"
      role="note"
    >
      Agency
    </div>
  ) : null;

  if (layout === "list") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: index * 0.02 }}
        className="group/tool relative rounded-lg transition-shadow duration-300 hover:shadow-[0_18px_40px_-22px_rgba(99,102,241,0.55)] dark:hover:shadow-[0_18px_50px_-22px_rgba(129,140,248,0.6)]"
      >
        <Card className="tool-trace relative overflow-hidden border-border/50 transition-colors group-hover/tool:border-transparent">
          {agencyBanner}
          {cardRibbons}
          <CardContent className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-3 sm:flex-row sm:items-start">
              {logoBlock}
              <div className="min-w-0 w-full flex-1 text-center sm:text-left">
                <div className="flex min-w-0 w-full flex-col gap-1.5">
                  <h3
                    className="min-w-0 max-w-full text-balance text-base font-semibold leading-tight text-foreground [overflow-wrap:anywhere] [word-break:normal]"
                    title={tool.name}
                  >
                    {titleDisplayBreaks(tool.name)}
                  </h3>
                  <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-start">
                    {isAgencyTool ? (
                      <Badge
                        variant="outline"
                        className="border-amber-500/45 bg-amber-500/15 text-[10px] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100"
                      >
                        Agency
                      </Badge>
                    ) : null}
                    {toolCategories.map((cat) => (
                      <Badge
                        key={cat}
                        variant="outline"
                        className={cn(
                          "max-w-[min(100%,12rem)] shrink-0 truncate text-xs leading-tight",
                          toolCategoryBadgeClass(cat),
                        )}
                        title={cat}
                      >
                        {cat}
                      </Badge>
                    ))}
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-center text-sm text-muted-foreground [overflow-wrap:anywhere] sm:text-left">
                  {tool.description}
                </p>
              </div>
            </div>

            <div className="flex w-full min-w-0 shrink-0 flex-col items-center gap-2 border-t border-border/50 pt-2 sm:border-0 sm:pt-0 md:gap-3">
              <div className="flex w-full flex-col items-center gap-1.5">
                {ratingBlock ? (
                  <div className="flex w-full justify-center">{ratingBlock}</div>
                ) : null}
                <div className="flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {trafficVisitsRow}
                </div>
                {revenueBadge ? (
                  <div className="flex w-full justify-center">{revenueBadge}</div>
                ) : null}
              </div>
              <div className="flex w-full flex-wrap items-center justify-center gap-1 sm:justify-end">
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
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUpvote}
                    disabled={voteBusy || !user}
                    title="Upvote — counts this month"
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
                    <span className="text-sm font-medium tabular-nums">
                      {upvoteCount}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownvote}
                    disabled={voteBusy || !user}
                    title="Downvote — signal low quality (counts this month)"
                    className={cn(
                      "h-9 gap-1 px-2",
                      userDownvoted && "text-destructive",
                    )}
                  >
                    <ThumbsDown
                      className={cn(
                        "h-4 w-4 shrink-0",
                        userDownvoted && "fill-current",
                      )}
                    />
                    <span className="text-sm font-medium tabular-nums">
                      {downvoteCount}
                    </span>
                  </Button>
                  {likePctLabel ? (
                    <span className="w-full text-center text-sm font-medium tabular-nums text-muted-foreground">
                      {likePctLabel}
                    </span>
                  ) : null}
                </div>
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
      className={cn(
        "group/tool relative min-w-0 rounded-lg transition-shadow duration-300",
        "hover:shadow-[0_24px_60px_-24px_rgba(99,102,241,0.55)]",
        "dark:hover:shadow-[0_24px_70px_-24px_rgba(129,140,248,0.6)]",
        descriptionExpanded ? "h-auto min-h-0" : "h-full min-h-0",
      )}
    >
      <Card
        className={cn(
          "tool-trace group relative flex h-full min-h-0 min-w-0 flex-col border-border/50 bg-card transition-colors duration-300 group-hover/tool:border-transparent",
          descriptionExpanded ? "overflow-visible" : "overflow-hidden",
        )}
      >
        {agencyBanner}
        {cardRibbons}
        <CardContent
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col gap-0 px-3.5 pb-4 pt-3.5 sm:px-5 sm:pb-5 sm:pt-5",
            descriptionExpanded ? "overflow-visible" : "overflow-hidden",
          )}
        >
          {/* Symmetric horizontal inset balances the favorite control so logo/title read visually centered */}
          <div className="relative mb-3 min-w-0 px-8 sm:px-9">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFavorite}
              disabled={favoriting || !user}
              className={cn(
                "absolute right-0 top-0 z-10 h-9 w-9 shrink-0 touch-manipulation p-0 sm:h-8 sm:w-8",
                userFavorited && "text-red-500",
              )}
              aria-label="Favorite"
            >
              <Heart
                className={cn("h-4 w-4", userFavorited && "fill-current")}
              />
            </Button>
            <div className="mx-auto flex min-w-0 max-w-full flex-col items-center gap-2.5 text-center sm:gap-2">
              {tool.logoUrl ? (
                <div className="relative h-[3.25rem] w-[3.25rem] shrink-0 overflow-hidden rounded-xl border border-border bg-background sm:h-14 sm:w-14">
                  <Image
                    src={tool.logoUrl}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="(max-width:640px) 52px, 56px"
                    unoptimized
                  />
                </div>
              ) : (
                <div className="flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-xl border border-border bg-gradient-to-br from-primary/20 to-secondary/20 sm:h-14 sm:w-14">
                  <span className="text-xl font-bold text-primary sm:text-2xl">
                    {tool.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <h3
                className="line-clamp-3 w-full max-w-full text-balance text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere] [word-break:normal]"
                title={tool.name}
              >
                {titleDisplayBreaks(tool.name)}
              </h3>
              <div className="flex flex-wrap justify-center gap-1">
                {isAgencyTool ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/45 bg-amber-500/15 text-[10px] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100"
                  >
                    Agency
                  </Badge>
                ) : null}
                {toolCategories.map((cat) => (
                  <Badge
                    key={cat}
                    variant="outline"
                    className={cn(
                      "inline-flex max-w-full shrink-0 items-center justify-center truncate text-xs leading-tight",
                      toolCategoryBadgeClass(cat),
                    )}
                    title={cat}
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div
            className={cn(
              "mb-3 min-w-0 flex-1 text-center",
              descriptionExpanded
                ? "max-h-none overflow-visible"
                : "min-h-0 overflow-hidden",
            )}
          >
            <p
              className={cn(
                "text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]",
                descriptionExpanded && "whitespace-pre-wrap break-words",
                !descriptionExpanded && needsExpandToggle && "line-clamp-4",
              )}
            >
              {fullDescription}
            </p>
            {needsExpandToggle && (
              <button
                type="button"
                onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                className="mt-1.5 inline-block text-xs text-primary hover:underline"
              >
                {descriptionExpanded ? "Show less" : "Show more…"}
              </button>
            )}
          </div>

          <div className="mt-auto flex min-w-0 flex-col gap-2 border-t border-border/40 pt-3">
            <div className="flex w-full flex-wrap items-center justify-center gap-x-1 gap-y-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUpvote}
                disabled={voteBusy || !user}
                title="Upvote — counts this month"
                className={cn(
                  "h-8 shrink-0 gap-1 px-2",
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
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownvote}
                disabled={voteBusy || !user}
                title="Downvote — signal low quality (counts this month)"
                className={cn(
                  "h-8 shrink-0 gap-1 px-2",
                  userDownvoted && "text-destructive",
                )}
              >
                <ThumbsDown
                  className={cn(
                    "h-4 w-4 shrink-0",
                    userDownvoted && "fill-current",
                  )}
                />
                <span className="tabular-nums text-sm font-medium">
                  {downvoteCount}
                </span>
              </Button>
              {likePctLabel ? (
                <span className="w-full text-center text-sm font-medium tabular-nums text-muted-foreground">
                  {likePctLabel}
                </span>
              ) : null}
            </div>
            {ratingBlock ? (
              <div className="flex w-full justify-center">
                {ratingBlock}
              </div>
            ) : null}
            <div className="flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {trafficVisitsRow}
            </div>
            {revenueBadge ? (
              <div className="flex w-full justify-center pt-0.5">
                {revenueBadge}
              </div>
            ) : null}
          </div>
        </CardContent>

        <CardFooter className="mt-0 shrink-0 border-t border-border/50 px-3.5 pb-3.5 pt-3 sm:px-5 sm:pb-4 sm:pt-4">
          <Button
            asChild
            variant="ghost"
            className="h-9 w-full font-medium transition-colors duration-200 group-hover:bg-primary/12 group-hover:text-primary"
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
