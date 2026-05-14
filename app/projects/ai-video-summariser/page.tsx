"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Youtube,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  Download,
  ListTree,
  ListOrdered,
  FileText,
  ExternalLink,
  Wand2,
  Coins,
  MessageCircle,
  Send,
  Database,
  Clock,
  ChevronDown,
  ChevronUp,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type TranscriptKind =
  | "youtube-captions-manual"
  | "youtube-captions-asr"
  | "youtube-whisper"
  | "tiktok-whisper";

interface TranscriptSegment {
  text: string;
  startSec: number;
  endSec: number;
}

interface SummaryResult {
  source: "youtube" | "tiktok";
  videoUrl: string;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  language: string | null;
  hasTranscript: boolean;
  transcriptCharCount: number;
  transcriptSource: {
    kind: TranscriptKind;
    language: string | null;
    charCount: number;
  };
  segments: TranscriptSegment[] | null;
  summary: string;
  chapters: Array<{ title: string; startSec: number; endSec: number; bullets: string[] }>;
  keyPoints: Array<{ point: string; timestampSec: number; quote: string }>;
  importantCommands: string[];
  actionItems: Array<{ text: string; timestampSec: number }>;
  transcriptCoverage: {
    mode: "full" | "excerpted";
    inputCharCount: number;
    analyzedCharCount: number;
  };
  generatedAt: string;
  warnings: string[];
  cost: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputCostUsd: number;
    outputCostUsd: number;
    totalCostUsd: number;
  } | null;
  transcriptCacheHit: boolean;
}

const SAVED_RESULT_KEY = "ai-video-summariser:last-result";

function sourceLabel(source: SummaryResult["source"]): string {
  if (source === "youtube") return "YouTube";
  return "TikTok";
}

function transcriptKindLabel(kind: TranscriptKind): string {
  switch (kind) {
    case "youtube-captions-manual":
      return "YouTube manual captions";
    case "youtube-captions-asr":
      return "YouTube auto-captions";
    case "youtube-whisper":
      return "Whisper (YouTube audio)";
    case "tiktok-whisper":
      return "Whisper (TikTok audio)";
  }
}

/** Format a USD amount that's typically a fraction of a cent. */
function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) {
    // Show 4 significant figures for sub-cent costs (e.g. "$0.000823").
    return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0")}`;
  }
  return `$${value.toFixed(4)}`;
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function youtubeTimestampUrl(videoUrl: string, sec: number): string | null {
  try {
    const u = new URL(videoUrl);
    if (u.hostname.includes("youtube.com") || u.hostname === "youtu.be") {
      u.searchParams.set("t", String(Math.floor(sec)));
      return u.toString();
    }
  } catch { /* ignore */ }
  return null;
}

function buildMarkdown(s: SummaryResult): string {
  const lines: string[] = [];
  lines.push(`# ${s.title ?? "Video summary"}`);
  if (s.author) lines.push(`*by ${s.author}*`);
  lines.push("");
  lines.push(`**Source:** ${sourceLabel(s.source)}  `);
  if (s.videoUrl) lines.push(`**URL:** ${s.videoUrl}  `);
  lines.push(`**Generated:** ${new Date(s.generatedAt).toLocaleString()}  `);
  lines.push(
    `**Transcript:** ${transcriptKindLabel(s.transcriptSource.kind)} • ${
      s.transcriptCoverage.mode === "excerpted"
        ? `${s.transcriptCoverage.analyzedCharCount.toLocaleString()} / ${s.transcriptCoverage.inputCharCount.toLocaleString()} chars analyzed`
        : `${s.transcriptCharCount.toLocaleString()} chars`
    }`,
  );
  if (s.cost) {
    lines.push(
      `**Cost:** ${formatUsd(s.cost.totalCostUsd)} (${s.cost.totalTokens.toLocaleString()} tokens, ${s.cost.model})`,
    );
  }
  lines.push("");
  if (s.warnings.length > 0) {
    lines.push("> " + s.warnings.join("\n> "));
    lines.push("");
  }
  lines.push("## TL;DR");
  lines.push(s.summary || "(no summary returned)");
  lines.push("");
  if (s.chapters.length > 0) {
    lines.push("## Chapters");
    s.chapters.forEach((ch) => {
      lines.push(`### [${formatSec(ch.startSec)}] ${ch.title}`);
      ch.bullets.forEach((b) => lines.push(`- ${b}`));
      lines.push("");
    });
  }
  if (s.keyPoints.length > 0) {
    lines.push("## Key points");
    s.keyPoints.forEach((k) => {
      const ts = k.timestampSec > 0 ? ` [${formatSec(k.timestampSec)}]` : "";
      lines.push(`- ${k.point}${ts}`);
      if (k.quote) lines.push(`  > "${k.quote}"`);
    });
    lines.push("");
  }
  if (s.importantCommands.length > 0) {
    lines.push("## Important commands and useful details");
    s.importantCommands.forEach((k) => lines.push(`- ${k}`));
    lines.push("");
  }
  if (s.actionItems.length > 0) {
    lines.push("## Action items");
    s.actionItems.forEach((a) => {
      const ts = a.timestampSec > 0 ? ` [${formatSec(a.timestampSec)}]` : "";
      lines.push(`- ${a.text}${ts}`);
    });
    lines.push("");
  }
  return lines.join("\n");
}

async function downloadPdf(s: SummaryResult): Promise<void> {
  // jsPDF is heavy — only load it on demand to keep the project page light.
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (extra: number) => {
    if (y + extra > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const writeWrapped = (
    text: string,
    opts: { size: number; bold?: boolean; gap?: number },
  ) => {
    doc.setFontSize(opts.size);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    const lineHeight = opts.size * 1.35;
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += opts.gap ?? 6;
  };

  writeWrapped(s.title ?? "Video summary", { size: 22, bold: true, gap: 8 });
  if (s.author) writeWrapped(`by ${s.author}`, { size: 11, gap: 4 });
  writeWrapped(
    [sourceLabel(s.source), s.videoUrl].filter(Boolean).join("  •  "),
    { size: 9, gap: 18 },
  );

  if (s.warnings.length > 0) {
    for (const w of s.warnings) {
      writeWrapped(`⚠ ${w}`, { size: 10, gap: 4 });
    }
    y += 6;
  }

  writeWrapped("TL;DR", { size: 14, bold: true, gap: 6 });
  writeWrapped(s.summary || "(no summary)", { size: 11, gap: 16 });

  if (s.chapters.length > 0) {
    writeWrapped("Chapters", { size: 14, bold: true, gap: 6 });
    for (const ch of s.chapters) {
      writeWrapped(`[${formatSec(ch.startSec)}] ${ch.title}`, { size: 12, bold: true, gap: 4 });
      for (const b of ch.bullets) {
        writeWrapped(`• ${b}`, { size: 11, gap: 2 });
      }
      y += 8;
    }
    y += 12;
  }

  if (s.keyPoints.length > 0) {
    writeWrapped("Key points", { size: 14, bold: true, gap: 6 });
    for (const k of s.keyPoints) {
      const ts = k.timestampSec > 0 ? ` [${formatSec(k.timestampSec)}]` : "";
      writeWrapped(`• ${k.point}${ts}`, { size: 11, gap: 2 });
    }
    y += 12;
  }

  if (s.importantCommands.length > 0) {
    writeWrapped("Important commands and useful details", { size: 14, bold: true, gap: 6 });
    for (const k of s.importantCommands) {
      writeWrapped(`• ${k}`, { size: 11, gap: 2 });
    }
    y += 12;
  }

  if (s.actionItems.length > 0) {
    writeWrapped("Action items", { size: 14, bold: true, gap: 6 });
    for (const a of s.actionItems) {
      const ts = a.timestampSec > 0 ? ` [${formatSec(a.timestampSec)}]` : "";
      writeWrapped(`• ${a.text}${ts}`, { size: 11, gap: 2 });
    }
    y += 12;
  }

  const filename = (s.title ?? "video-summary")
    .replace(/[^\w\d-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  doc.save(`${filename || "video-summary"}.pdf`);
}

function downloadText(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function detectPlatform(url: string): "youtube" | "tiktok" | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (host.endsWith("tiktok.com")) return "tiktok";
    return null;
  } catch {
    return null;
  }
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function AiVideoSummariserPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(
    null,
  );
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [copied, setCopied] = useState<"md" | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [hoveredQuote, setHoveredQuote] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const detected = detectPlatform(url.trim());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SAVED_RESULT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        url?: string;
        result?: SummaryResult;
      };
      if (parsed.result?.generatedAt) {
        setResult(parsed.result);
        setUrl(parsed.url ?? parsed.result.videoUrl ?? "");
      }
    } catch {
      window.localStorage.removeItem(SAVED_RESULT_KEY);
    }
  }, []);

  // Auto-scroll chat to the latest message.
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory.length, chatLoading]);

  const saveResult = useCallback((nextResult: SummaryResult, nextUrl: string) => {
    setResult(nextResult);
    setChatHistory([]);
    setChatError(null);
    try {
      window.localStorage.setItem(
        SAVED_RESULT_KEY,
        JSON.stringify({ url: nextUrl, result: nextResult }),
      );
    } catch {
      // Ignore storage quota/private browsing failures; the live result still renders.
    }
  }, []);

  // saveResult is kept for backward compat with the chat section but onSubmit
  // now builds result incrementally via SSE — supress unused warning:
  void saveResult;

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) return;
      setLoading(true);
      setIsStreaming(false);
      setError(null);
      setResult(null);
      setShowTranscript(false);
      setChatHistory([]);
      setChatError(null);

      try {
        const res = await fetch("/api/projects/video-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });

        if (!res.body) {
          setError({ message: "No response stream from server." });
          return;
        }

        // Handle non-SSE error responses (e.g. rate-limit 429 returns JSON, not SSE)
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok && !contentType.includes("text/event-stream")) {
          let errMsg = `Request failed (${res.status}).`;
          let hint: string | undefined;
          try {
            const data = (await res.json()) as { error?: string; details?: string; retryAfter?: number };
            if (data.error) errMsg = data.error;
            if (data.details) hint = data.details;
            if (res.status === 429 && data.retryAfter) hint = `Try again in ${data.retryAfter}s.`;
          } catch { /* ignore parse errors */ }
          setError({ message: errMsg, hint });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let currentEvent = "";
        let accumulated: Partial<SummaryResult> | null = null;
        let summaryText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              let payload: unknown;
              try { payload = JSON.parse(line.slice(6)); } catch { continue; }

              if (currentEvent === "error") {
                const p = payload as { error?: string; hint?: string };
                setError({ message: p.error ?? "Summarisation failed.", hint: p.hint });
                setLoading(false);
                setIsStreaming(false);
                return;
              }

              if (currentEvent === "meta") {
                const p = payload as Partial<SummaryResult>;
                accumulated = p;
                setLoading(false);
                setIsStreaming(true);
                setResult({
                  source: p.source ?? "youtube",
                  videoUrl: p.videoUrl ?? trimmed,
                  title: p.title ?? null,
                  author: p.author ?? null,
                  thumbnailUrl: p.thumbnailUrl ?? null,
                  language: p.language ?? null,
                  hasTranscript: true,
                  transcriptCharCount: p.transcriptCharCount ?? 0,
                  transcriptSource: p.transcriptSource ?? { kind: "youtube-captions-asr", language: null, charCount: 0 },
                  segments: (p as { segments?: TranscriptSegment[] | null }).segments ?? null,
                  summary: "",
                  chapters: [],
                  keyPoints: [],
                  importantCommands: [],
                  actionItems: [],
                  transcriptCoverage: p.transcriptCoverage ?? { mode: "full", inputCharCount: 0, analyzedCharCount: 0 },
                  generatedAt: p.generatedAt ?? new Date().toISOString(),
                  warnings: p.warnings ?? [],
                  cost: null,
                  transcriptCacheHit: p.transcriptCacheHit ?? false,
                });
              }

              if (currentEvent === "summary_chunk") {
                const token = payload as string;
                summaryText += token;
                setResult((prev) => prev ? { ...prev, summary: summaryText } : null);
              }

              if (currentEvent === "structured") {
                const p = payload as {
                  chapters?: SummaryResult["chapters"];
                  keyPoints?: SummaryResult["keyPoints"];
                  importantCommands?: string[];
                  actionItems?: SummaryResult["actionItems"];
                  warnings?: string[];
                  cost?: SummaryResult["cost"];
                };
                setResult((prev) => {
                  if (!prev) return null;
                  const next: SummaryResult = {
                    ...prev,
                    summary: summaryText,
                    chapters: p.chapters ?? [],
                    keyPoints: p.keyPoints ?? [],
                    importantCommands: p.importantCommands ?? [],
                    actionItems: p.actionItems ?? [],
                    warnings: p.warnings ?? prev.warnings,
                    cost: p.cost ?? null,
                  };
                  // Save to localStorage now that we have the full result
                  try {
                    window.localStorage.setItem(
                      SAVED_RESULT_KEY,
                      JSON.stringify({ url: trimmed, result: next }),
                    );
                  } catch { /* ignore */ }
                  accumulated = next;
                  return next;
                });
              }

              if (currentEvent === "done") {
                setIsStreaming(false);
              }
            }
          }
        }
      } catch (err) {
        setError({ message: err instanceof Error ? err.message : "Network error — try again." });
      } finally {
        setLoading(false);
        setIsStreaming(false);
      }
    },
    [url],
  );

  const onChatSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const question = chatInput.trim();
      if (!question || !result || chatLoading) return;
      setChatError(null);
      setChatLoading(true);
      const next: ChatMessage[] = [
        ...chatHistory,
        { role: "user", content: question },
      ];
      setChatHistory(next);
      setChatInput("");
      try {
        const res = await fetch("/api/projects/video-summary/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: result.videoUrl,
            question,
            history: chatHistory,
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { answer: string }
          | { error: string; hint?: string }
          | null;
        if (!res.ok || !data || "error" in data) {
          setChatError(
            (data && "error" in data && data.error) ||
              "Chat request failed.",
          );
          // Roll back the user message so the input doesn't look stuck.
          setChatHistory(chatHistory);
          return;
        }
        setChatHistory([
          ...next,
          { role: "assistant", content: data.answer },
        ]);
      } catch (err) {
        setChatError(
          err instanceof Error ? err.message : "Network error — try again.",
        );
        setChatHistory(chatHistory);
      } finally {
        setChatLoading(false);
      }
    },
    [chatHistory, chatInput, chatLoading, result],
  );

  const onCopyMarkdown = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildMarkdown(result));
      setCopied("md");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient background — purple/cyan to differentiate from the
          emerald-tinted hedge calculator project. */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_40%_at_50%_-10%,hsl(var(--primary)/0.10),transparent)]" />
      <div className="pointer-events-none absolute -right-40 top-10 -z-10 h-[500px] w-[500px] rounded-full bg-violet-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute -left-40 bottom-10 -z-10 h-[420px] w-[420px] rounded-full bg-cyan-500/8 blur-[110px]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-500/5 blur-[140px]" />

      <div className="container mx-auto max-w-4xl px-4 py-8 md:py-12">
        <Link
          href="/projects"
          className="group mb-8 inline-flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-all hover:border-border hover:bg-card hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Projects
        </Link>

        <header className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/8 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
            <Sparkles className="h-3.5 w-3.5" />
            AI Notebook
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            <span className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 bg-clip-text text-transparent">
              AI Video
            </span>{" "}
            <span>Summariser</span>
          </h1>
          <p className="mt-2 max-w-2xl text-base text-muted-foreground">
            Paste a YouTube or TikTok URL. The app pulls captions when they
            exist and falls back to transcribing the audio with Whisper, so
            every summary is grounded in real spoken content — never just the
            title.
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-xl shadow-black/5 backdrop-blur-sm dark:shadow-black/20"
        >
          <Label
            htmlFor="video-url"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            YouTube or TikTok URL
          </Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Input
                id="video-url"
                type="url"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…  or  https://www.tiktok.com/@user/video/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="pr-24"
              />
              {detected && (
                <span
                  className={cn(
                    "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                    detected === "youtube"
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : "bg-pink-500/10 text-pink-600 dark:text-pink-400",
                  )}
                >
                  {detected === "youtube" ? (
                    <Youtube className="h-3 w-3" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {detected}
                </span>
              )}
            </div>
            <Button
              type="submit"
              disabled={loading || isStreaming || !url.trim()}
              className="gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Fetching transcript…
                </>
              ) : isStreaming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Summarise
                </>
              )}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground/80">
            <p>
              YouTube: captions when available, otherwise auto-transcribed.
              TikTok: always Whisper-transcribed from the audio. Re-running the
              same URL is free (cached transcript).
            </p>
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 font-medium"
              title="gpt-4o-mini for summary, gpt-4o-mini-transcribe for Whisper. Cached re-runs cost only the summary."
            >
              <Coins className="h-3 w-3" />
              Est. cost: ~$0.0005 – $0.04 per video
            </span>
          </div>
        </form>

        {error && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="font-semibold text-red-700 dark:text-red-400">
                {error.message}
              </p>
              {error.hint && (
                <p className="mt-1 text-red-700/80 dark:text-red-300/80">
                  {error.hint}
                </p>
              )}
            </div>
          </div>
        )}

        {result && (
          <article className="mt-8 space-y-6">
            <div className="flex flex-col gap-4 rounded-2xl border border-border/50 bg-card/90 p-5 shadow-xl shadow-black/5 backdrop-blur-sm dark:shadow-black/20 sm:flex-row sm:items-start">
              {result.thumbnailUrl && (
                <a
                  href={result.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative block w-full overflow-hidden rounded-xl border border-border/40 bg-black sm:w-48 sm:shrink-0"
                  style={{ aspectRatio: "16/9" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={result.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                    <ExternalLink className="h-5 w-5" />
                  </span>
                </a>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5 font-semibold uppercase tracking-wider">
                    {sourceLabel(result.source)}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400"
                    title={`Transcript provenance: ${transcriptKindLabel(result.transcriptSource.kind)}${
                      result.transcriptSource.language
                        ? ` • ${result.transcriptSource.language}`
                        : ""
                    } • ${result.transcriptSource.charCount.toLocaleString()} chars`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {transcriptKindLabel(result.transcriptSource.kind)}
                    {result.transcriptCoverage.mode === "excerpted"
                      ? ` • ${result.transcriptCoverage.analyzedCharCount.toLocaleString()} / ${result.transcriptCoverage.inputCharCount.toLocaleString()} chars`
                      : ` • ${result.transcriptCharCount.toLocaleString()} chars`}
                  </span>
                  {result.transcriptCacheHit && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-cyan-500/25 bg-cyan-500/8 px-2 py-0.5 font-medium text-cyan-700 dark:text-cyan-300"
                      title="Transcript was loaded from the cache — no transcription cost incurred."
                    >
                      <Database className="h-3.5 w-3.5" />
                      Cached
                    </span>
                  )}
                  {result.cost && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/8 px-2 py-0.5 font-medium text-violet-700 dark:text-violet-300"
                      title={`gpt-4o-mini • ${result.cost.inputTokens.toLocaleString()} in + ${result.cost.outputTokens.toLocaleString()} out tokens`}
                    >
                      <Coins className="h-3.5 w-3.5" />
                      {formatUsd(result.cost.totalCostUsd)}
                    </span>
                  )}
                </div>
                <h2 className="mt-1 text-xl font-bold tracking-tight">
                  {result.title ?? "Untitled video"}
                </h2>
                {result.author && (
                  <p className="text-sm text-muted-foreground">
                    by {result.author}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={onCopyMarkdown}
                  >
                    {copied === "md" ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy Markdown
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() =>
                      downloadText(
                        `${(result.title ?? "video-summary").slice(0, 60)}.md`,
                        "text/markdown",
                        buildMarkdown(result),
                      )
                    }
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Download .md
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => void downloadPdf(result)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download PDF
                  </Button>
                </div>
              </div>
            </div>

            {result.warnings.length > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <ul className="space-y-1 text-amber-800 dark:text-amber-200">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* TL;DR — streams in token by token */}
            <section className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-md backdrop-blur-sm">
              <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="h-4 w-4 text-violet-500" />
                TL;DR
              </h3>
              <p className="text-base leading-relaxed">
                {result.summary || (isStreaming ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Writing summary…
                  </span>
                ) : null)}
                {isStreaming && result.summary && (
                  <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" />
                )}
              </p>
            </section>

            {/* Chapters — timestamped sections */}
            {result.chapters.length > 0 && (
              <section className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-md backdrop-blur-sm">
                <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  <ListTree className="h-4 w-4 text-cyan-500" />
                  Chapters
                </h3>
                <div className="space-y-3">
                  {result.chapters.map((ch, i) => {
                    const tsUrl = youtubeTimestampUrl(result.videoUrl, ch.startSec);
                    return (
                      <div key={i} className="rounded-xl border border-border/40 bg-background/50 p-4">
                        <div className="mb-2 flex items-center gap-2">
                          {tsUrl ? (
                            <a
                              href={tsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
                            >
                              <Clock className="h-3 w-3" />
                              {formatSec(ch.startSec)}
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-violet-700 dark:text-violet-300">
                              <Clock className="h-3 w-3" />
                              {formatSec(ch.startSec)}
                            </span>
                          )}
                          <h4 className="text-sm font-semibold tracking-tight">{ch.title}</h4>
                        </div>
                        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-muted-foreground/60">
                          {ch.bullets.map((b, j) => <li key={j}>{b}</li>)}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Key points with verified quotes */}
            {result.keyPoints.length > 0 && (
              <section className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-md backdrop-blur-sm">
                <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  <ListOrdered className="h-4 w-4 text-fuchsia-500" />
                  Key points
                </h3>
                <ol className="space-y-3 text-sm leading-relaxed">
                  {result.keyPoints.map((k, i) => {
                    const tsUrl = k.timestampSec > 0 ? youtubeTimestampUrl(result.videoUrl, k.timestampSec) : null;
                    return (
                      <li key={i} className="flex flex-col gap-1">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/10 text-[11px] font-bold text-fuchsia-700 dark:text-fuchsia-300">
                            {i + 1}
                          </span>
                          <span className="flex-1">{k.point}</span>
                          {k.timestampSec > 0 && (
                            tsUrl ? (
                              <a href={tsUrl} target="_blank" rel="noopener noreferrer"
                                className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-mono text-violet-700 hover:bg-violet-500/20 dark:text-violet-300">
                                {formatSec(k.timestampSec)}
                              </a>
                            ) : (
                              <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-mono text-violet-700 dark:text-violet-300">
                                {formatSec(k.timestampSec)}
                              </span>
                            )
                          )}
                        </div>
                        {k.quote && (
                          <div
                            className="ml-7 cursor-pointer"
                            onMouseEnter={() => setHoveredQuote(k.quote)}
                            onMouseLeave={() => setHoveredQuote(null)}
                          >
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] italic transition-colors",
                              hoveredQuote === k.quote
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                                : "border-border/40 bg-muted/40 text-muted-foreground",
                            )}>
                              <Quote className="h-3 w-3 shrink-0" />
                              {k.quote}
                            </span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {result.importantCommands.length > 0 && (
              <section className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-md backdrop-blur-sm">
                <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-4 w-4 text-violet-500" />
                  Commands & useful details
                </h3>
                <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed marker:text-muted-foreground/60">
                  {result.importantCommands.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </section>
            )}

            {result.actionItems.length > 0 && (
              <section className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-md backdrop-blur-sm">
                <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Action items
                </h3>
                <ul className="space-y-2 text-sm leading-relaxed">
                  {result.actionItems.map((a, i) => {
                    const tsUrl = a.timestampSec > 0 ? youtubeTimestampUrl(result.videoUrl, a.timestampSec) : null;
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <span className="flex-1">{a.text}</span>
                        {a.timestampSec > 0 && (
                          tsUrl ? (
                            <a href={tsUrl} target="_blank" rel="noopener noreferrer"
                              className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-mono text-violet-700 hover:bg-violet-500/20 dark:text-violet-300">
                              {formatSec(a.timestampSec)}
                            </a>
                          ) : (
                            <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-mono text-violet-700 dark:text-violet-300">
                              {formatSec(a.timestampSec)}
                            </span>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Full transcript panel — collapsible verification surface */}
            {result.segments && result.segments.length > 0 && (
              <section className="rounded-2xl border border-border/50 bg-card/90 shadow-md backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => setShowTranscript((v) => !v)}
                  className="flex w-full items-center justify-between p-5 text-left"
                >
                  <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    <FileText className="h-4 w-4 text-cyan-500" />
                    Full Transcript
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal normal-case tracking-normal">
                      {result.segments.length} segments
                    </span>
                  </span>
                  {showTranscript ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                {showTranscript && (
                  <div className="border-t border-border/40 p-5 pt-4">
                    <div className="max-h-96 overflow-y-auto rounded-xl border border-border/40 bg-background/50 p-4">
                      <div className="space-y-2 text-sm leading-relaxed">
                        {result.segments.map((seg, i) => {
                          const tsUrl = youtubeTimestampUrl(result.videoUrl, seg.startSec);
                          return (
                            <div key={i} className="flex gap-2">
                              {tsUrl ? (
                                <a
                                  href={tsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 font-mono text-[10px] text-violet-600 hover:underline dark:text-violet-400"
                                >
                                  {formatSec(seg.startSec)}
                                </a>
                              ) : (
                                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                                  {formatSec(seg.startSec)}
                                </span>
                              )}
                              <span className="text-muted-foreground">{seg.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-md backdrop-blur-sm">
              <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <MessageCircle className="h-4 w-4 text-fuchsia-500" />
                Ask a question about this video
              </h3>
              <div
                ref={chatScrollRef}
                className={cn(
                  "max-h-72 overflow-y-auto rounded-xl border border-border/40 bg-background/50 p-3",
                  chatHistory.length === 0 && !chatLoading && "hidden",
                )}
              >
                <ul className="space-y-3 text-sm">
                  {chatHistory.map((m, i) => (
                    <li
                      key={i}
                      className={cn(
                        "rounded-lg px-3 py-2 leading-relaxed",
                        m.role === "user"
                          ? "ml-8 bg-violet-500/10 text-foreground"
                          : "mr-8 bg-muted/60 text-foreground",
                      )}
                    >
                      <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {m.role === "user" ? "You" : "Answer"}
                      </span>
                      {m.content}
                    </li>
                  ))}
                  {chatLoading && (
                    <li className="mr-8 inline-flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Thinking…
                    </li>
                  )}
                </ul>
              </div>
              <form
                onSubmit={onChatSubmit}
                className="mt-3 flex flex-col gap-2 sm:flex-row"
              >
                <Input
                  type="text"
                  placeholder="e.g. what tools does the speaker recommend?"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={chatLoading}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  disabled={chatLoading || !chatInput.trim()}
                  className="gap-1.5"
                  variant="outline"
                >
                  <Send className="h-3.5 w-3.5" />
                  Ask
                </Button>
              </form>
              {chatError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {chatError}
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground/70">
                Answers come from the cached transcript only — the model is
                instructed to refuse anything not in the video.
              </p>
            </section>

            <p className="text-center text-xs text-muted-foreground/60">
              Generated by{" "}
              <span className="font-medium">
                {result.cost?.model ?? "gpt-4o-mini"}
              </span>{" "}
              at {new Date(result.generatedAt).toLocaleString()}
              {result.cost && (
                <>
                  {" "}
                  • {result.cost.totalTokens.toLocaleString()} tokens •{" "}
                  <span className="font-medium text-violet-700 dark:text-violet-300">
                    {formatUsd(result.cost.totalCostUsd)}
                  </span>
                </>
              )}
              . Always double-check important facts against the source.
            </p>
          </article>
        )}

        {!result && !error && !loading && (
          <p className="mt-8 text-center text-xs text-muted-foreground/60">
            PowerPoint and Excel exports are on the roadmap — Markdown is
            already perfect for pasting into Notion, Google Docs, or your
            Notes.
          </p>
        )}
      </div>
    </div>
  );
}
