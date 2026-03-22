"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import {
  COMMUNITY_PROMPTS,
  PROMPT_CATEGORIES,
  appendUserPrompt,
  type CommunityPrompt,
  type PromptCategory,
  type UserPrompt,
} from "@/lib/prompt-data";
import { PromptTemplateCard } from "@/components/prompts/PromptTemplateCard";
import { BookOpen, Plus, Sparkles, User } from "lucide-react";

export default function PromptsPage() {
  const { addToast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | "all">(
    "all",
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const communityFiltered = useMemo(() => {
    if (categoryFilter === "all") return COMMUNITY_PROMPTS;
    return COMMUNITY_PROMPTS.filter((p) => p.category === categoryFilter);
  }, [categoryFilter]);

  const communityByCategory = useMemo(() => {
    const map = new Map<PromptCategory, CommunityPrompt[]>();
    for (const c of PROMPT_CATEGORIES) map.set(c, []);
    for (const p of communityFiltered) {
      map.get(p.category)!.push(p);
    }
    return map;
  }, [communityFiltered]);

  const copyPrompt = useCallback(
    async (id: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId((x) => (x === id ? null : x)), 2000);
        addToast({
          variant: "success",
          title: "Copied",
          description: "Prompt copied to clipboard.",
        });
      } catch {
        addToast({
          variant: "error",
          title: "Copy failed",
          description: "Could not access the clipboard.",
        });
      }
    },
    [addToast],
  );

  const addFromCommunity = useCallback(
    (p: CommunityPrompt) => {
      const entry: UserPrompt = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        category: p.category,
        title: p.title || "Community prompt",
        body: p.body,
        createdAt: new Date().toISOString(),
      };
      appendUserPrompt(entry);
      addToast({
        variant: "success",
        title: "Saved to My prompts",
        description: "Open My prompts to view or edit your library.",
      });
    },
    [addToast],
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-violet-500/5 via-background to-fuchsia-500/5">
      <div className="container max-w-5xl px-4 py-10">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-center sm:text-left">
            <h1 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
              <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-violet-400 dark:to-fuchsia-400">
                Community prompts
              </span>
            </h1>
            <p className="mx-auto max-w-2xl text-muted-foreground sm:mx-0">
              Curated{" "}
              <Sparkles className="mx-0.5 inline h-4 w-4 text-amber-500" />
              templates by category. Copy or save to your library.
            </p>
          </div>
          <Button
            asChild
            className="shrink-0 gap-2 bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white shadow-md hover:from-fuchsia-500 hover:to-violet-500 sm:mt-1"
          >
            <Link href="/prompts/my">
              <User className="h-4 w-4" />
              My prompts
            </Link>
          </Button>
        </div>

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Category:
            </span>
            <Button
              type="button"
              variant={categoryFilter === "all" ? "default" : "outline"}
              size="sm"
              className="rounded-full"
              onClick={() => setCategoryFilter("all")}
            >
              All
            </Button>
            {PROMPT_CATEGORIES.map((c) => (
              <Button
                key={c}
                type="button"
                variant={categoryFilter === c ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() => setCategoryFilter(c)}
              >
                {c}
              </Button>
            ))}
          </div>
        </div>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            <h2 className="text-xl font-semibold">Browse</h2>
          </div>
          <p className="mb-6 text-sm text-muted-foreground">
            Replace placeholders like{" "}
            <code className="rounded bg-muted px-1">[TOPIC]</code> before sending
            to your AI.
          </p>

          {categoryFilter === "all" ? (
            <div className="space-y-10">
              {PROMPT_CATEGORIES.map((cat) => {
                const list = communityByCategory.get(cat) ?? [];
                if (list.length === 0) return null;
                return (
                  <div key={cat}>
                    <h3 className="mb-4 border-b border-border/60 pb-2 text-lg font-medium text-foreground">
                      {cat}
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {list.map((p) => (
                        <PromptTemplateCard
                          key={p.id}
                          id={`c-${p.id}`}
                          title={p.title}
                          body={p.body}
                          badge={p.category}
                          copiedId={copiedId}
                          onCopy={() => void copyPrompt(`c-${p.id}`, p.body)}
                          extra={
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="gap-1"
                              onClick={() => addFromCommunity(p)}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Save to mine
                            </Button>
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {communityFiltered.map((p) => (
                <PromptTemplateCard
                  key={p.id}
                  id={`c-${p.id}`}
                  title={p.title}
                  body={p.body}
                  badge={p.category}
                  copiedId={copiedId}
                  onCopy={() => void copyPrompt(`c-${p.id}`, p.body)}
                  extra={
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="gap-1"
                      onClick={() => addFromCommunity(p)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Save to mine
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
