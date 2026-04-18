"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  PROMPT_CATEGORIES,
  PROMPT_TYPES,
  loadUserPrompts,
  saveUserPrompts,
  type PromptCategory,
  type PromptType,
  type UserPrompt,
  isPromptCategory,
  isPromptType,
} from "@/lib/prompt-data";
import {
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  Wand2,
  Copy,
  Check,
  ChevronDown,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PROMPT_BOX_PLACEHOLDERS = [
  "Paste your favourite Claude system prompt…",
  "Drop that one ChatGPT jailbreak you keep losing…",
  "Save the agent prompt that actually works in Cursor…",
  "Paste your research assistant prompt — we'll tag it for you.",
  "Copy a prompt from Reddit, paste it here, save it forever.",
];

interface AnalyzeResult {
  title: string;
  summary: string;
  category: PromptCategory;
  type: PromptType;
  tags: string[];
  cost: { totalCostUsd: number } | null;
}

export function UserPromptsPanel() {
  const { addToast } = useToast();

  const [userPrompts, setUserPrompts] = useState<UserPrompt[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | "all">(
    "all",
  );
  const [typeFilter, setTypeFilter] = useState<PromptType | "all">("all");
  const [search, setSearch] = useState("");

  // Paste box / analyser state
  const [body, setBody] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [draft, setDraft] = useState<AnalyzeResult | null>(null);
  const [tagsInput, setTagsInput] = useState("");

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const placeholder = useMemo(
    () =>
      PROMPT_BOX_PLACEHOLDERS[
        Math.floor(Math.random() * PROMPT_BOX_PLACEHOLDERS.length)
      ],
    [],
  );

  // Hydrate from localStorage once.
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return userPrompts.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter)
        return false;
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      if (q) {
        const hay = `${p.title} ${p.body} ${(p.tags ?? []).join(" ")} ${p.summary ?? ""}`
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [userPrompts, categoryFilter, typeFilter, search]);

  // Counts for the type chips.
  const typeCounts = useMemo(() => {
    const map = new Map<PromptType | "all", number>();
    map.set("all", userPrompts.length);
    for (const t of PROMPT_TYPES) map.set(t, 0);
    for (const p of userPrompts) {
      if (p.type) map.set(p.type, (map.get(p.type) ?? 0) + 1);
    }
    return map;
  }, [userPrompts]);

  const analyseAndPreview = useCallback(async () => {
    const text = body.trim();
    if (!text) {
      addToast({
        variant: "warning",
        title: "Paste a prompt first",
        description: "Drop your prompt into the box, then we'll analyse it.",
      });
      return;
    }
    setAnalyzing(true);
    setDraft(null);
    try {
      const res = await fetch("/api/prompts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = (await res.json().catch(() => null)) as
        | (AnalyzeResult & { error?: undefined })
        | { error: string }
        | null;
      if (!res.ok || !data || "error" in data) {
        addToast({
          variant: "error",
          title: "Couldn't analyse",
          description:
            (data && "error" in data && data.error) ||
            "Try saving it manually below.",
        });
        // Even on failure, give the user a draft they can edit + save.
        setDraft({
          title: text.slice(0, 60).split("\n")[0] || "Untitled prompt",
          summary: "",
          category: "Productivity",
          type: "Other",
          tags: [],
          cost: null,
        });
        setTagsInput("");
        return;
      }
      setDraft(data);
      setTagsInput((data.tags ?? []).join(", "));
    } catch (err) {
      addToast({
        variant: "error",
        title: "Network error",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setAnalyzing(false);
    }
  }, [body, addToast]);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
    const entry: UserPrompt = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      category: draft.category,
      title: draft.title.trim() || "Untitled prompt",
      body: body.trim(),
      summary: draft.summary || undefined,
      type: draft.type,
      tags: tags.length > 0 ? tags : undefined,
      createdAt: new Date().toISOString(),
    };
    persist((prev) => [entry, ...prev]);
    setBody("");
    setDraft(null);
    setTagsInput("");
    addToast({
      variant: "success",
      title: "Saved",
      description: "Tagged and added to your library.",
    });
  }, [draft, tagsInput, body, persist, addToast]);

  const removeUser = useCallback(
    (id: string) => {
      persist((prev) => prev.filter((p) => p.id !== id));
    },
    [persist],
  );

  const copyPrompt = useCallback(
    async (id: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId((x) => (x === id ? null : x)), 1500);
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

  const ctaDisabled = body.trim().length === 0 || analyzing;

  return (
    <div className="space-y-8">
      {/* Hero paste box */}
      <PasteBox
        body={body}
        onBodyChange={setBody}
        placeholder={placeholder}
        onAnalyse={analyseAndPreview}
        analyzing={analyzing}
        disabled={ctaDisabled}
        hasDraft={Boolean(draft)}
      />

      {/* Analysis result — shown only after we have a draft to save */}
      {draft && (
        <DraftCard
          draft={draft}
          tagsInput={tagsInput}
          setDraft={setDraft}
          setTagsInput={setTagsInput}
          onSave={saveDraft}
          onCancel={() => setDraft(null)}
        />
      )}

      {/* Library header + filters */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Your library
            </h2>
            <p className="text-xs text-muted-foreground">
              {hydrated
                ? `${userPrompts.length} ${userPrompts.length === 1 ? "prompt" : "prompts"} · stored in this browser`
                : "Loading…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-8 w-44 text-sm"
            />
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                if (v === "all") setTypeFilter("all");
                else if (isPromptType(v)) setTypeFilter(v);
              }}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  All types ({typeCounts.get("all") ?? 0})
                </SelectItem>
                {PROMPT_TYPES.map((t) => {
                  const c = typeCounts.get(t) ?? 0;
                  return (
                    <SelectItem key={t} value={t} disabled={c === 0}>
                      {t} ({c})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            active={categoryFilter === "all"}
            onClick={() => setCategoryFilter("all")}
          >
            All
          </FilterChip>
          {PROMPT_CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              active={categoryFilter === c}
              onClick={() => setCategoryFilter(c)}
            >
              {c}
            </FilterChip>
          ))}
        </div>

        {!hydrated ? null : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-4 py-12 text-center">
            <Sparkles className="mx-auto mb-2 h-5 w-5 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {userPrompts.length === 0
                ? "Your prompt library is empty — paste your first prompt above."
                : "Nothing matches these filters."}
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {filtered.map((p) => (
              <PromptListItem
                key={p.id}
                prompt={p}
                copied={copiedId === p.id}
                onCopy={() => void copyPrompt(p.id, p.body)}
                onDelete={() => removeUser(p.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function PasteBox({
  body,
  onBodyChange,
  placeholder,
  onAnalyse,
  analyzing,
  disabled,
  hasDraft,
}: {
  body: string;
  onBodyChange: (s: string) => void;
  placeholder: string;
  onAnalyse: () => void;
  analyzing: boolean;
  disabled: boolean;
  hasDraft: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow the textarea up to a sensible cap so a long paste doesn't
  // jump the page around.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
  }, [body]);

  return (
    <div
      className={cn(
        "relative rounded-2xl border border-border/60 bg-card/70 p-1 shadow-sm transition-all",
        "focus-within:border-violet-500/40 focus-within:shadow-violet-500/10",
        hasDraft && "opacity-70",
      )}
    >
      <div className="rounded-xl bg-gradient-to-br from-violet-500/[0.04] via-transparent to-fuchsia-500/[0.04] p-4">
        <textarea
          ref={ref}
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
          className={cn(
            "w-full resize-none border-0 bg-transparent px-1 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none",
            "min-h-[120px] max-h-[360px] overflow-y-auto",
          )}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !disabled) {
              e.preventDefault();
              onAnalyse();
            }
          }}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground/70">
            {body.length === 0
              ? "Paste a prompt — we'll auto-tag it."
              : `${body.length.toLocaleString()} chars · ${
                  body.trim().split(/\s+/).length
                } words`}
          </p>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={onAnalyse}
            className="gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analysing…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" />
                Analyse & save
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  tagsInput,
  setDraft,
  setTagsInput,
  onSave,
  onCancel,
}: {
  draft: AnalyzeResult;
  tagsInput: string;
  setDraft: (d: AnalyzeResult) => void;
  setTagsInput: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.03] p-4 shadow-md">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
          <Sparkles className="h-3 w-3" />
          AI suggested
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground"
          onClick={onCancel}
          title="Discard"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="draft-title" className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Title
          </Label>
          <Input
            id="draft-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="h-9 text-sm font-medium"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Type
          </Label>
          <Select
            value={draft.type}
            onValueChange={(v) =>
              isPromptType(v) && setDraft({ ...draft, type: v })
            }
          >
            <SelectTrigger className="h-9 w-[130px] text-sm">
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
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Category
          </Label>
          <Select
            value={draft.category}
            onValueChange={(v) =>
              isPromptCategory(v) && setDraft({ ...draft, category: v })
            }
          >
            <SelectTrigger className="h-9 w-[140px] text-sm">
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
      </div>

      {draft.summary && (
        <p className="mt-3 text-sm italic text-muted-foreground">
          “{draft.summary}”
        </p>
      )}

      <div className="mt-3 space-y-1.5">
        <Label htmlFor="draft-tags" className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Tags <span className="font-normal normal-case">(comma-separated)</span>
        </Label>
        <Input
          id="draft-tags"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="e.g. cursor, code-review, refactor"
          className="h-8 text-sm"
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground/80">
          {draft.cost
            ? `Analysed for ~$${draft.cost.totalCostUsd.toFixed(5).replace(/0+$/, "0")}`
            : "Free analysis"}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="text-muted-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            className="gap-1.5 bg-violet-600 text-white hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" />
            Save to library
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PromptListItem({
  prompt,
  copied,
  onCopy,
  onDelete,
}: {
  prompt: UserPrompt;
  copied: boolean;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = prompt.body.length > 240 && !expanded
    ? `${prompt.body.slice(0, 240)}…`
    : prompt.body;

  return (
    <li className="group flex flex-col rounded-xl border border-border/50 bg-card/70 p-3 transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {prompt.title}
          </h3>
          {prompt.summary && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {prompt.summary}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onCopy}
            title="Copy"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {prompt.type && (
          <Badge
            variant="outline"
            className="border-violet-500/30 bg-violet-500/8 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300"
          >
            {prompt.type}
          </Badge>
        )}
        <Badge
          variant="secondary"
          className="px-1.5 py-0 text-[10px] font-medium"
        >
          {prompt.category}
        </Badge>
        {prompt.tags?.map((t) => (
          <span
            key={t}
            className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            #{t}
          </span>
        ))}
      </div>

      <pre
        className={cn(
          "mt-2 cursor-pointer overflow-hidden whitespace-pre-wrap break-words rounded-md bg-muted/30 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/80",
          !expanded && "line-clamp-4",
        )}
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Click to collapse" : "Click to expand"}
      >
        {preview}
      </pre>

      {prompt.body.length > 240 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 self-start text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
          />
          {expanded ? "Show less" : "Show full prompt"}
        </button>
      )}
    </li>
  );
}
