import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";

/**
 * AI Video Summariser
 * --------------------
 * Accepts a YouTube or TikTok URL and returns a structured summary:
 * - one-paragraph TL;DR
 * - 5–10 key points
 * - hierarchical outline (sections → bullets) suitable for slides / docs
 *
 * Strategy:
 * - YouTube → fetch captions via `youtube-transcript`, then summarise the
 *   transcript with OpenAI gpt-4o-mini.
 * - TikTok  → no transcript; fall back to oEmbed (title + author) and let
 *   the model produce a metadata-based summary with a clear caveat.
 *
 * Failure modes are surfaced as `{ error, hint }` JSON, never as 500s, so the
 * UI can render an actionable message (e.g. "captions disabled by uploader").
 */

const SOURCE_YOUTUBE = "youtube" as const;
const SOURCE_TIKTOK = "tiktok" as const;
type Source = typeof SOURCE_YOUTUBE | typeof SOURCE_TIKTOK;

interface SummaryResponse {
  source: Source;
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
}

function detectSource(url: string): Source | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("youtube.com") || host === "youtu.be") return SOURCE_YOUTUBE;
    if (
      host === "www.tiktok.com" ||
      host === "tiktok.com" ||
      host === "vm.tiktok.com" ||
      host === "vt.tiktok.com"
    ) {
      return SOURCE_TIKTOK;
    }
    return null;
  } catch {
    return null;
  }
}

function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      const id = parts[parts.length - 1];
      return id && id !== "watch" ? id : null;
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "");
      return id || null;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchYouTubeOembed(url: string) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AI-Tools/1.0)" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
  } catch {
    return null;
  }
}

async function fetchTikTokOembed(url: string) {
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AI-Tools/1.0)" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
  } catch {
    return null;
  }
}

async function fetchYouTubeTranscript(
  videoId: string,
): Promise<{ text: string; language: string | null } | null> {
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    if (!items || items.length === 0) return null;
    const text = items
      .map((it) => it.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return null;
    return { text, language: null };
  } catch {
    return null;
  }
}

interface OpenAiSummary {
  summary: string;
  keyPoints: string[];
  outline: Array<{ section: string; bullets: string[] }>;
}

async function summariseWithOpenAi(args: {
  source: Source;
  title: string | null;
  author: string | null;
  transcript: string | null;
}): Promise<{ data: OpenAiSummary; modelUsed: string } | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.startsWith("sk-")) return null;

  const TRANSCRIPT_CHAR_BUDGET = 28000;
  const transcriptSnippet = (args.transcript ?? "").slice(0, TRANSCRIPT_CHAR_BUDGET);
  const truncated = (args.transcript?.length ?? 0) > TRANSCRIPT_CHAR_BUDGET;

  const systemPrompt = [
    "You are a precise study/notes assistant. Summarise online videos for a busy reader.",
    "You MUST reply with a single JSON object and nothing else (no markdown fences).",
    "Schema:",
    '  "summary": string  (1–3 sentence TL;DR, plain prose, no bullets)',
    '  "keyPoints": string[]  (5–10 standalone takeaways, full sentences, ordered by importance)',
    '  "outline": Array<{ "section": string, "bullets": string[] }>  (3–6 sections, each with 2–6 short bullets — suitable for slides)',
    "Style rules:",
    "- Be specific. Prefer concrete claims, numbers, names, examples from the source.",
    "- Never invent facts that aren't in the source. If something is uncertain, omit it.",
    "- Each key point should make sense without context.",
    "- Section titles should be short Title Case (3–6 words).",
  ].join("\n");

  const userParts: string[] = [
    `Source platform: ${args.source}`,
    args.title ? `Video title: ${args.title}` : "Video title: (unknown)",
    args.author ? `Author/channel: ${args.author}` : "",
  ].filter(Boolean);

  if (transcriptSnippet) {
    userParts.push(
      `Transcript${truncated ? " (truncated to fit context — summarise everything provided, ignore that this is a partial)" : ""}:\n${transcriptSnippet}`,
    );
  } else {
    userParts.push(
      "(no transcript available — produce the most useful summary you can from the title alone, and add to keyPoints a clear caveat that no transcript was available)",
    );
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userParts.join("\n\n") },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1400,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      model?: string;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      choices?: Array<{ message?: { content?: string } }>;
    };
    const modelUsed = data.model ?? "gpt-4o-mini";
    if (data.usage) logOpenAIUsage(modelUsed, "video_summary", data.usage);
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }
    const obj = parsed as Partial<OpenAiSummary>;
    const summary =
      typeof obj.summary === "string" ? obj.summary.trim() : "";
    const keyPoints = Array.isArray(obj.keyPoints)
      ? obj.keyPoints.map((p) => String(p).trim()).filter(Boolean).slice(0, 12)
      : [];
    const outline = Array.isArray(obj.outline)
      ? obj.outline
          .map((s) => ({
            section: String((s as { section?: unknown }).section ?? "").trim(),
            bullets: Array.isArray((s as { bullets?: unknown }).bullets)
              ? ((s as { bullets: unknown[] }).bullets)
                  .map((b) => String(b).trim())
                  .filter(Boolean)
                  .slice(0, 8)
              : [],
          }))
          .filter((s) => s.section && s.bullets.length > 0)
          .slice(0, 8)
      : [];
    if (!summary && keyPoints.length === 0 && outline.length === 0) return null;
    return { data: { summary, keyPoints, outline }, modelUsed };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = enforceApiRateLimit(request, "video_summary");
    if (limited) return limited;

    const body = (await request.json().catch(() => ({}))) as { url?: string };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json(
        { error: "Provide a YouTube or TikTok URL." },
        { status: 400 },
      );
    }

    const source = detectSource(url);
    if (!source) {
      return NextResponse.json(
        {
          error: "Unsupported URL.",
          hint: "Only YouTube and TikTok URLs are supported right now.",
        },
        { status: 400 },
      );
    }

    const warnings: string[] = [];
    let title: string | null = null;
    let author: string | null = null;
    let thumbnailUrl: string | null = null;
    let transcriptText: string | null = null;
    let language: string | null = null;

    if (source === SOURCE_YOUTUBE) {
      const videoId = getYouTubeVideoId(url);
      if (!videoId) {
        return NextResponse.json(
          { error: "Couldn't extract a video id from that YouTube URL." },
          { status: 400 },
        );
      }
      const [meta, transcript] = await Promise.all([
        fetchYouTubeOembed(url),
        fetchYouTubeTranscript(videoId),
      ]);
      title = meta?.title ?? null;
      author = meta?.author_name ?? null;
      thumbnailUrl = meta?.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      if (transcript) {
        transcriptText = transcript.text;
        language = transcript.language;
      } else {
        warnings.push(
          "No captions available for this video — summary is generated from the title only and may be vague.",
        );
      }
    } else {
      const meta = await fetchTikTokOembed(url);
      title = meta?.title ?? null;
      author = meta?.author_name ?? null;
      thumbnailUrl = meta?.thumbnail_url ?? null;
      warnings.push(
        "TikTok summaries use only the post title and author — TikTok does not expose transcripts to third-party apps.",
      );
    }

    const ai = await summariseWithOpenAi({
      source,
      title,
      author,
      transcript: transcriptText,
    });

    if (!ai) {
      return NextResponse.json(
        {
          error: "Couldn't summarise this video.",
          hint:
            "Make sure OPENAI_API_KEY is set on the server. If captions are disabled, the model has very little to work with.",
        },
        { status: 502 },
      );
    }

    const payload: SummaryResponse = {
      source,
      videoUrl: url,
      title,
      author,
      thumbnailUrl,
      language,
      hasTranscript: Boolean(transcriptText),
      transcriptCharCount: transcriptText?.length ?? 0,
      summary: ai.data.summary,
      keyPoints: ai.data.keyPoints,
      outline: ai.data.outline,
      generatedAt: new Date().toISOString(),
      warnings,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Server error while summarising video.", details: message },
      { status: 500 },
    );
  }
}
