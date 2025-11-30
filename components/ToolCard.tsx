"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Star, TrendingUp, ThumbsUp } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { Tool } from "@/lib/supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface ToolCardProps {
  tool: Tool;
  index?: number;
}

const categoryColors: Record<string, string> = {
  "Video Editing": "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  "AI Automation": "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  SaaS: "bg-green-500/10 text-green-700 dark:text-green-400",
  "Image Generation": "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  "Code Assistants": "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  Writing: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  Productivity: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  Design: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  Marketing: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  Analytics: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  Other: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
};

const trafficLabels: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  unknown: "Unknown",
};

export function ToolCard({ tool, index = 0 }: ToolCardProps) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [upvoteCount, setUpvoteCount] = useState(tool.upvoteCount || 0);
  const [userUpvoted, setUserUpvoted] = useState(tool.userUpvoted || false);
  const [upvoting, setUpvoting] = useState(false);

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
          errorData.message || errorData.error || "Failed to upvote"
        );
      }

      const data = await response.json();
      setUpvoteCount(data.upvoteCount);
      setUserUpvoted(data.userUpvoted);
    } catch (error: any) {
      console.error("Error upvoting:", error);
      alert(error.message || "Failed to upvote. Please try again.");
    } finally {
      setUpvoting(false);
    }
  };

  const formatVisits = (visits?: number | null) => {
    if (!visits) return null;
    if (visits >= 1000000) return `${(visits / 1000000).toFixed(1)}M`;
    if (visits >= 1000) return `${(visits / 1000).toFixed(1)}K`;
    return visits.toString();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Card className="group relative h-full overflow-hidden border-border/50 bg-card transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 dark:hover:shadow-primary/20">
        <CardContent className="p-6">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-3">
              {tool.logoUrl ? (
                <div className="relative h-12 w-12 overflow-hidden rounded-lg border border-border bg-background">
                  <Image
                    src={tool.logoUrl}
                    alt={tool.name}
                    fill
                    className="object-cover"
                    sizes="48px"
                  />
                </div>
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-gradient-to-br from-primary/20 to-secondary/20">
                  <span className="text-xl font-bold text-primary">
                    {tool.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex-1">
                <h3 className="font-semibold text-lg leading-tight text-foreground">
                  {tool.name}
                </h3>
                <Badge
                  variant="outline"
                  className={`mt-1 text-xs ${
                    categoryColors[tool.category] || categoryColors.Other
                  }`}
                >
                  {tool.category}
                </Badge>
              </div>
            </div>
          </div>

          <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
            {tool.description}
          </p>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUpvote}
              disabled={upvoting || !user}
              className={`h-8 gap-1.5 ${userUpvoted ? "text-primary" : ""}`}
            >
              <ThumbsUp
                className={`h-4 w-4 ${userUpvoted ? "fill-current" : ""}`}
              />
              <span className="text-sm font-medium">{upvoteCount}</span>
            </Button>
            {tool.rating && (
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => {
                    // Show filled star if rating is >= star value
                    const filled = tool.rating! >= star;
                    return (
                      <Star
                        key={star}
                        className={`h-3.5 w-3.5 transition-colors ${
                          filled
                            ? "fill-yellow-400 text-yellow-400"
                            : "fill-transparent text-yellow-200 dark:text-yellow-900"
                        }`}
                      />
                    );
                  })}
                </div>
                <span className="text-sm font-medium text-foreground">
                  {tool.rating.toFixed(1)}
                </span>
              </div>
            )}
            {tool.traffic && tool.traffic !== "unknown" && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>{trafficLabels[tool.traffic]}</span>
              </div>
            )}
            {tool.estimatedVisits && (
              <div className="text-sm text-muted-foreground">
                ~{formatVisits(tool.estimatedVisits)} visits/mo
              </div>
            )}
            {tool.revenue && (
              <Badge variant="outline" className="text-xs capitalize">
                {tool.revenue}
              </Badge>
            )}
          </div>
        </CardContent>

        <CardFooter className="border-t border-border/50 p-4 pt-0">
          <Button
            asChild
            variant="ghost"
            className="w-full group-hover:bg-primary/10"
          >
            <Link
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2"
            >
              View Tool
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
