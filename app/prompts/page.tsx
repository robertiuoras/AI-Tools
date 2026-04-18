"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import {
  COMMUNITY_PROMPTS,
  PROMPT_CATEGORIES,
  PROMPT_TYPES,
  appendUserPrompt,
  type CommunityPrompt,
  type PromptCategory,
  type PromptType,
  type UserPrompt,
} from "@/lib/prompt-data";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Loader2,
  Plus,
  Search,
  Sparkles,
  User,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ImproveResult = {
  improved: string;
  notes: string[];
  type: PromptType;
  cost: { totalCostUsd: number; totalTokens: number; model: string } | null;
};

function deriveBlurb(p: CommunityPrompt): string {
  if (p.blurb && p.blurb.trim()) return p.blurb.trim();
  const cleaned = p.body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[[^\]]+\]/g, "…")
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  const blurb =
    firstSentence.length > 110
      ? `${firstSentence.slice(0, 107)}…`
      : firstSentence;
  return blurb || "Reusable prompt template.";
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export default function PromptsPage() {
  const { addToast } = useToast();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<PromptCategory | "all">(
    "all",
  );

  // Hero "Turn lazy prompts into great ones"
  const [lazyText, setLazyText] = useState("");
  const [improveType, setImproveType] = useState<PromptType>("Agent");
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [improveResult, setImproveResult] = useState<ImproveResult | null>(null);
  const [improvedCopied, setImprovedCopied] = useState(false);

  // Selected rail prompt → opens detail
  const [openPrompt, setOpenPrompt] = useState<CommunityPrompt | null>(null);
  const [copiedDetailId, setCopiedDetailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = COMMUNITY_PROMPTS;
    if (activeCategory !== "all") {
      list = list.filter((p) => p.category === activeCategory);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.body.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      );
    }
    return list;
  }, [activeCategory, query]);

  const byCategory = useMemo(() => {
    const map = new Map<PromptCategory, CommunityPrompt[]>();
    for (const c of PROMPT_CATEGORIES) map.set(c, []);
    for (const p of filtered) map.get(p.category)!.push(p);
    return map;
  }, [filtered]);

  const copyText = useCallback(
    async (text: string, id: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedDetailId(id);
        setTimeout(
          () => setCopiedDetailId((x) => (x === id ? null : x)),
          1800,
        );
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

  const saveCommunityToMine = useCallback(
    (p: CommunityPrompt) => {
      const entry: UserPrompt = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        category: p.category,
        title: p.title,
        body: p.body,
        createdAt: new Date().toISOString(),
        summary: deriveBlurb(p),
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

  const runImprove = useCallback(async () => {
    if (!lazyText.trim() || improving) return;
    setImproving(true);
    setImproveError(null);
    setImproveResult(null);
    try {
      const res = await fetch("/api/prompts/improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: lazyText, type: improveType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data && (data.error || data.details)) || `Request failed (${res.status})`,
        );
      }
      setImproveResult({
        improved: String(data.improved ?? ""),
        notes: Array.isArray(data.notes) ? data.notes.map(String) : [],
        type: (data.type as PromptType) ?? improveType,
        cost: data.cost
          ? {
              totalCostUsd: Number(data.cost.totalCostUsd ?? 0),
              totalTokens: Number(data.cost.totalTokens ?? 0),
              model: String(data.cost.model ?? "gpt-4o-mini"),
            }
          : null,
      });
    } catch (err) {
      setImproveError(
        err instanceof Error ? err.message : "Something went wrong.",
      );
    } finally {
      setImproving(false);
    }
  }, [improveType, improving, lazyText]);

  const copyImproved = useCallback(async () => {
    if (!improveResult) return;
    try {
      await navigator.clipboard.writeText(improveResult.improved);
      setImprovedCopied(true);
      setTimeout(() => setImprovedCopied(false), 1800);
    } catch {
      /* no-op */
    }
  }, [improveResult]);

  const saveImproved = useCallback(() => {
    if (!improveResult) return;
    const entry: UserPrompt = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      category: "Productivity",
      title: `Improved · ${improveResult.type}`,
      body: improveResult.improved,
      createdAt: new Date().toISOString(),
      type: improveResult.type,
      summary: improveResult.notes[0] ?? "AI-improved prompt",
      tags: ["improved", improveResult.type.toLowerCase()],
    };
    appendUserPrompt(entry);
    addToast({
      variant: "success",
      title: "Saved to My prompts",
      description: "You can refine it further in your library.",
    });
  }, [addToast, improveResult]);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-amber-500/5 via-background to-fuchsia-500/5">
      <div className="container max-w-6xl px-4 py-8 sm:py-10">
        {/* HEADER */}
        <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Prompts
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Your cheat code to AI that just works.
            </p>
          </div>
          <Button
            asChild
            variant="outline"
            className="shrink-0 gap-2 self-start sm:self-auto"
          >
            <Link href="/prompts/my">
              <User className="h-4 w-4" />
              My prompts
            </Link>
          </Button>
        </div>

        {/* HERO — Turn lazy prompts into great ones */}
        <section className="mb-10 overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-amber-500/10 via-background to-fuchsia-500/10 p-5 shadow-sm sm:p-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-fuchsia-600 text-white shadow">
                <Wand2 className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-lg font-semibold leading-tight sm:text-xl">
                  Turn lazy prompts into great ones
                </h2>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  Paste a vague idea — get a structured, ready-to-use prompt.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Type:
              </span>
              <Select
                value={improveType}
                onValueChange={(v) => setImproveType(v as PromptType)}
              >
                <SelectTrigger className="h-9 w-[150px] rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMPT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/80 shadow-sm">
            <textarea
              value={lazyText}
              onChange={(e) => setLazyText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void runImprove();
                }
              }}
              placeholder='e.g. "write me an email to my boss asking for a raise" or "help me plan my week"'
              rows={3}
              className="block w-full resize-none rounded-xl bg-transparent p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Sparkles className="h-3 w-3 text-amber-500" />
                <span>Cmd/Ctrl + Enter to improve</span>
                <span className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">~$0.0001 per call</span>
              </div>
              <Button
                onClick={() => void runImprove()}
                disabled={improving || !lazyText.trim()}
                className="gap-1.5 bg-gradient-to-r from-amber-500 to-fuchsia-600 text-white shadow hover:from-amber-400 hover:to-fuchsia-500 disabled:opacity-50"
                size="sm"
              >
                {improving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Improving…
                  </>
                ) : (
                  <>
                    <Wand2 className="h-3.5 w-3.5" />
                    Improve
                  </>
                )}
              </Button>
            </div>
          </div>

          {improveError && (
            <p className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {improveError}
            </p>
          )}

          {improveResult && (
            <div className="mt-4 rounded-xl border border-border/70 bg-card shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="secondary" className="font-normal">
                    {improveResult.type}
                  </Badge>
                  {improveResult.cost && (
                    <span className="text-muted-foreground">
                      {improveResult.cost.totalTokens.toLocaleString()} tokens ·{" "}
                      <span className="font-medium text-fuchsia-600 dark:text-fuchsia-400">
                        {formatUsd(improveResult.cost.totalCostUsd)}
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyImproved()}
                    className="gap-1.5"
                  >
                    {improvedCopied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveImproved}
                    className="gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Save
                  </Button>
                </div>
              </div>
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-foreground/90">
                {improveResult.improved}
              </pre>
              {improveResult.notes.length > 0 && (
                <div className="border-t border-border/60 px-4 py-3">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    What changed
                  </p>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {improveResult.notes.map((n, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-amber-500">•</span>
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* DISCOVER */}
        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Discover
              </h2>
              <p className="text-sm text-muted-foreground">
                Ready-to-use prompts across every role. Pick one and make it
                yours.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search prompts…"
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Category pills */}
          <div className="mb-6 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <CategoryPill
              label="Recommended"
              active={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
            />
            {PROMPT_CATEGORIES.map((c) => (
              <CategoryPill
                key={c}
                label={c}
                active={activeCategory === c}
                onClick={() => setActiveCategory(c)}
              />
            ))}
          </div>

          {/* Rails */}
          <div className="space-y-8">
            {PROMPT_CATEGORIES.map((cat) => {
              const list = byCategory.get(cat) ?? [];
              if (list.length === 0) return null;
              return (
                <PromptRail
                  key={cat}
                  title={cat}
                  prompts={list}
                  onOpen={(p) => setOpenPrompt(p)}
                />
              );
            })}
            {filtered.length === 0 && (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                No prompts match your search.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Detail sheet */}
      {openPrompt && (
        <PromptDetail
          prompt={openPrompt}
          copied={copiedDetailId === openPrompt.id}
          onCopy={() => void copyText(openPrompt.body, openPrompt.id)}
          onSave={() => saveCommunityToMine(openPrompt)}
          onClose={() => setOpenPrompt(null)}
        />
      )}
    </div>
  );
}

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function PromptRail({
  title,
  prompts,
  onOpen,
}: {
  title: string;
  prompts: CommunityPrompt[];
  onOpen: (p: CommunityPrompt) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-medium text-foreground sm:text-lg">
          {title}
        </h3>
        <span className="text-xs text-muted-foreground">
          {prompts.length} {prompts.length === 1 ? "prompt" : "prompts"}
        </span>
      </div>
      <div className="-mx-1 grid grid-cols-1 gap-3 px-1 pb-3 sm:grid-cols-2 lg:grid-cols-3">
        {prompts.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(p)}
            className="group relative flex min-h-[7rem] flex-col gap-2 rounded-xl border border-border/70 bg-card/80 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold leading-snug text-foreground">
                {p.title}
              </div>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </div>
            <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {deriveBlurb(p)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function PromptDetail({
  prompt,
  copied,
  onCopy,
  onSave,
  onClose,
}: {
  prompt: CommunityPrompt;
  copied: boolean;
  onCopy: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
          <div className="min-w-0 space-y-1">
            <Badge variant="secondary" className="text-xs font-normal">
              {prompt.category}
            </Badge>
            <h3 className="truncate text-lg font-semibold leading-tight">
              {prompt.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed text-foreground/90">
          {prompt.body}
        </pre>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-5 py-3">
          <p className="text-[11px] text-muted-foreground">
            Replace <code className="rounded bg-muted px-1">[PLACEHOLDERS]</code>{" "}
            before sending to your AI.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCopy}
              className="gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Save to mine
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
