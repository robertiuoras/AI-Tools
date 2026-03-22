"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import {
  PROMPT_CATEGORIES,
  loadUserPrompts,
  saveUserPrompts,
  type PromptCategory,
  type UserPrompt,
  isPromptCategory,
} from "@/lib/prompt-data";
import { PromptTemplateCard } from "@/components/prompts/PromptTemplateCard";
import { Plus, Trash2, User } from "lucide-react";

const textareaClass =
  "flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function UserPromptsPanel() {
  const { addToast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | "all">(
    "all",
  );
  const [userPrompts, setUserPrompts] = useState<UserPrompt[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newCategory, setNewCategory] = useState<PromptCategory>("Writing");

  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setUserPrompts(loadUserPrompts());
    setHydrated(true);
  }, []);

  const persist = useCallback(
    (updater: UserPrompt[] | ((prev: UserPrompt[]) => UserPrompt[])) => {
      setUserPrompts((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        saveUserPrompts(next);
        return next;
      });
    },
    [],
  );

  const userFiltered = useMemo(() => {
    if (categoryFilter === "all") return userPrompts;
    return userPrompts.filter((p) => p.category === categoryFilter);
  }, [userPrompts, categoryFilter]);

  const userByCategory = useMemo(() => {
    const map = new Map<PromptCategory, UserPrompt[]>();
    for (const c of PROMPT_CATEGORIES) map.set(c, []);
    for (const p of userFiltered) {
      map.get(p.category)!.push(p);
    }
    return map;
  }, [userFiltered]);

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

  const addCustom = useCallback(() => {
    const body = newBody.trim();
    if (!body) {
      addToast({
        variant: "warning",
        title: "Prompt text required",
        description: "Add your prompt body before saving.",
      });
      return;
    }
    const entry: UserPrompt = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      category: newCategory,
      title: newTitle.trim() || "Untitled prompt",
      body,
      createdAt: new Date().toISOString(),
    };
    persist((prev) => [entry, ...prev]);
    setNewTitle("");
    setNewBody("");
    addToast({
      variant: "success",
      title: "Saved",
      description: "Your prompt was added.",
    });
  }, [newBody, newTitle, newCategory, persist, addToast]);

  const removeUser = useCallback(
    (id: string) => {
      persist((prev) => prev.filter((p) => p.id !== id));
      addToast({
        variant: "success",
        title: "Removed",
        description: "Prompt deleted.",
      });
    },
    [persist, addToast],
  );

  return (
    <>
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
          <User className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" />
          <h2 className="text-xl font-semibold">My prompts</h2>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Stored locally in your browser. Clear site data will remove them.
        </p>

        <Card className="mb-8 border-border/60 bg-card/90">
          <CardHeader>
            <CardTitle className="text-lg">Add your own</CardTitle>
            <CardDescription>
              Pick a category, optional title, and paste your prompt template.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={newCategory}
                  onValueChange={(v) =>
                    isPromptCategory(v) && setNewCategory(v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMPT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="my-prompt-title">Title (optional)</Label>
                <Input
                  id="my-prompt-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Weekly retro"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="my-prompt-body">Prompt</Label>
              <textarea
                id="my-prompt-body"
                className={textareaClass}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="Write your prompt here…"
              />
            </div>
            <Button type="button" onClick={addCustom} className="gap-2">
              <Plus className="h-4 w-4" />
              Save prompt
            </Button>
          </CardContent>
        </Card>

        {!hydrated ? null : userFiltered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 py-10 text-center text-sm text-muted-foreground">
            No prompts yet for this filter. Add one above or save a template from
            community prompts.
          </p>
        ) : categoryFilter === "all" ? (
          <div className="space-y-10">
            {PROMPT_CATEGORIES.map((cat) => {
              const list = userByCategory.get(cat) ?? [];
              if (list.length === 0) return null;
              return (
                <div key={cat}>
                  <h3 className="mb-4 border-b border-border/60 pb-2 text-lg font-medium">
                    {cat}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {list.map((p) => (
                      <PromptTemplateCard
                        key={p.id}
                        id={`u-${p.id}`}
                        title={p.title}
                        body={p.body}
                        badge={p.category}
                        copiedId={copiedId}
                        onCopy={() => void copyPrompt(`u-${p.id}`, p.body)}
                        extra={
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => removeUser(p.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
            {userFiltered.map((p) => (
              <PromptTemplateCard
                key={p.id}
                id={`u-${p.id}`}
                title={p.title}
                body={p.body}
                badge={p.category}
                copiedId={copiedId}
                onCopy={() => void copyPrompt(`u-${p.id}`, p.body)}
                extra={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeUser(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
