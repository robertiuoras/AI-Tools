"use client";

import { useState, useCallback } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SummaryResult {
  source: "youtube" | "tiktok";
  videoUrl: string;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  language: string | null;
  hasTranscript: boolean;
  transcriptCharCount: number;
  summary: string;
  keyPoints: string[];
  outline: Array<{ section: string; bullets: string[] }>;
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

function buildMarkdown(s: SummaryResult): string {
  const lines: string[] = [];
  lines.push(`# ${s.title ?? "Video summary"}`);
  if (s.author) lines.push(`*by ${s.author}*`);
  lines.push("");
  lines.push(`**Source:** ${s.source === "youtube" ? "YouTube" : "TikTok"}  `);
  lines.push(`**URL:** ${s.videoUrl}  `);
  lines.push(
    `**Generated:** ${new Date(s.generatedAt).toLocaleString()}  `,
  );
  if (s.hasTranscript) {
    lines.push(`**Transcript:** ${s.transcriptCharCount.toLocaleString()} chars`);
  } else {
    lines.push(`**Transcript:** unavailable (summary from metadata only)`);
  }
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
  lines.push("## Key points");
  s.keyPoints.forEach((k) => lines.push(`- ${k}`));
  lines.push("");
  lines.push("## Outline");
  s.outline.forEach((sec) => {
    lines.push(`### ${sec.section}`);
    sec.bullets.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  });
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
    `${s.source === "youtube" ? "YouTube" : "TikTok"}  •  ${s.videoUrl}`,
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

  writeWrapped("Key points", { size: 14, bold: true, gap: 6 });
  for (const k of s.keyPoints) {
    writeWrapped(`• ${k}`, { size: 11, gap: 2 });
  }
  y += 12;

  writeWrapped("Outline", { size: 14, bold: true, gap: 6 });
  for (const sec of s.outline) {
    writeWrapped(sec.section, { size: 12, bold: true, gap: 4 });
    for (const b of sec.bullets) {
      writeWrapped(`• ${b}`, { size: 11, gap: 2 });
    }
    y += 8;
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

export default function AiVideoSummariserPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(
    null,
  );
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [copied, setCopied] = useState<"md" | null>(null);

  const detected = detectPlatform(url.trim());

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const res = await fetch("/api/projects/video-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });
        const data = (await res.json().catch(() => null)) as
          | (SummaryResult & { error?: undefined })
          | { error: string; hint?: string }
          | null;
        if (!res.ok || !data || "error" in data) {
          setError({
            message:
              (data && "error" in data && data.error) ||
              "Couldn't summarise this video.",
            hint: data && "hint" in data ? data.hint : undefined,
          });
          return;
        }
        setResult(data);
      } catch (err) {
        setError({
          message:
            err instanceof Error ? err.message : "Network error — try again.",
        });
      } finally {
        setLoading(false);
      }
    },
    [url],
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
            Paste a YouTube or TikTok URL. Get a TL;DR, key points and a
            slide-ready outline you can export to Markdown or PDF — like a tiny
            NotebookLM for short videos.
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
            Video URL
          </Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Input
                id="video-url"
                type="url"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=… or https://www.tiktok.com/@user/video/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
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
              disabled={loading || !url.trim()}
              className="gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Summarising…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Summarise
                </>
              )}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground/80">
            <p>
              YouTube uses captions when available. TikTok summarises from
              title + author only (no public transcripts).
            </p>
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 font-medium"
              title="Estimated OpenAI cost per summarisation using gpt-4o-mini ($0.15/M input, $0.60/M output tokens). Most short videos land in this band; very long lectures (>1h) can reach ~$0.01."
            >
              <Coins className="h-3 w-3" />
              Est. cost: ~$0.0003 – $0.005 per video
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
                    {result.source}
                  </span>
                  {result.hasTranscript ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Transcript • {result.transcriptCharCount.toLocaleString()}{" "}
                      chars
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Metadata only
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

            <section className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-md backdrop-blur-sm">
              <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="h-4 w-4 text-violet-500" />
                TL;DR
              </h3>
              <p className="text-base leading-relaxed">{result.summary}</p>
            </section>

            <section className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-md backdrop-blur-sm">
              <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <ListOrdered className="h-4 w-4 text-fuchsia-500" />
                Key points
              </h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed marker:text-muted-foreground/60">
                {result.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ol>
            </section>

            <section className="rounded-2xl border border-border/50 bg-card/90 p-5 shadow-md backdrop-blur-sm">
              <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <ListTree className="h-4 w-4 text-cyan-500" />
                Outline
              </h3>
              <div className="space-y-4">
                {result.outline.map((sec, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-border/40 bg-background/50 p-4"
                  >
                    <h4 className="mb-2 text-sm font-semibold tracking-tight">
                      {sec.section}
                    </h4>
                    <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-muted-foreground/60">
                      {sec.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
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
