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
  detailedNotes: Array<{ section: string; bullets: string[] }>;
  importantCommands: string[];
  actionItems: string[];
  outline: Array<{ section: string; bullets: string[] }>;
  transcriptCoverage: {
    mode: "full" | "excerpted" | "metadata";
    inputCharCount: number;
    analyzedCharCount: number;
  };
  generatedAt: string;
  warnings: string[];
  /** Token usage + USD cost for this single summarisation (gpt-4o-mini). */
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

/**
 * Prices in USD per 1M tokens. Updated for gpt-4o-mini (Aug 2024 pricing).
 * Anything else falls back to a conservative estimate so the UI still shows
 * a number rather than nothing.
 */
const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-2024-08-06": { input: 2.5, output: 10 },
};

function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): SummaryResponse["cost"] {
  const base = model.toLowerCase();
  const key = Object.keys(MODEL_PRICING_PER_MTOK).find((k) =>
    base.startsWith(k),
  );
  const rates = key
    ? MODEL_PRICING_PER_MTOK[key]!
    : { input: 0.5, output: 1.5 };
  const inputCostUsd = (inputTokens / 1_000_000) * rates.input;
  const outputCostUsd = (outputTokens / 1_000_000) * rates.output;
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
  };
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

/**
 * Pull the visible description / caption text from a video page's HTML.
 *
 * This is the "no transcript" fallback most paid summariser tools use too:
 * - TikTok pages embed the caption + hashtags in the SIGI_STATE JSON and meta tags
 * - YouTube watch pages embed shortDescription in ytInitialPlayerResponse
 *
 * The goal is to give the model significantly more material to ground its summary in
 * before falling back to title-only guessing.
 */
async function fetchVideoPageDescription(
  url: string,
): Promise<{ description: string | null; extra: string[] } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        // Use a desktop UA so we get the rich HTML, not a stripped mobile/share variant
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html) return null;

    const extra: string[] = [];
    const pieces: string[] = [];

    const ogDesc = html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    );
    if (ogDesc?.[1]) pieces.push(ogDesc[1]);

    const twDesc = html.match(
      /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i,
    );
    if (twDesc?.[1] && twDesc[1] !== ogDesc?.[1]) pieces.push(twDesc[1]);

    const ytShort = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
    if (ytShort?.[1]) {
      try {
        const decoded = JSON.parse(`"${ytShort[1]}"`) as string;
        if (decoded && decoded.length > (ogDesc?.[1]?.length ?? 0)) {
          pieces.push(decoded);
        }
      } catch {
        // ignore — fall through to other signals
      }
    }

    const ttDesc = html.match(/"desc":"((?:\\.|[^"\\])*)"/);
    if (ttDesc?.[1]) {
      try {
        const decoded = JSON.parse(`"${ttDesc[1]}"`) as string;
        if (decoded) pieces.push(decoded);
      } catch {
        // ignore
      }
    }

    const hashtags = Array.from(html.matchAll(/#([A-Za-z0-9_]{2,30})/g))
      .map((m) => `#${m[1]}`)
      .filter((tag, i, arr) => arr.indexOf(tag) === i)
      .slice(0, 12);
    if (hashtags.length) extra.push(`Hashtags: ${hashtags.join(" ")}`);

    const keywords = html.match(
      /<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i,
    );
    if (keywords?.[1]) extra.push(`Keywords: ${keywords[1]}`);

    const merged = pieces
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .join("\n");

    if (!merged && extra.length === 0) return null;
    return { description: merged || null, extra };
  } catch {
    return null;
  }
}

interface OpenAiSummary {
  summary: string;
  keyPoints: string[];
  detailedNotes: Array<{ section: string; bullets: string[] }>;
  importantCommands: string[];
  actionItems: string[];
  outline: Array<{ section: string; bullets: string[] }>;
}

interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

function buildTranscriptContext(
  transcript: string | null,
  budget: number,
): {
  text: string;
  mode: SummaryResponse["transcriptCoverage"]["mode"];
  inputCharCount: number;
  analyzedCharCount: number;
} {
  if (!transcript) {
    return { text: "", mode: "metadata", inputCharCount: 0, analyzedCharCount: 0 };
  }

  if (transcript.length <= budget) {
    return {
      text: transcript,
      mode: "full",
      inputCharCount: transcript.length,
      analyzedCharCount: transcript.length,
    };
  }

  const firstSize = Math.floor(budget * 0.4);
  const middleSize = Math.floor(budget * 0.35);
  const finalSize = budget - firstSize - middleSize;
  const middleStart = Math.max(
    firstSize,
    Math.floor(transcript.length / 2 - middleSize / 2),
  );
  const finalStart = Math.max(middleStart + middleSize, transcript.length - finalSize);
  const sections = [
    `[Beginning excerpt]\n${transcript.slice(0, firstSize)}`,
    `[Middle excerpt]\n${transcript.slice(middleStart, middleStart + middleSize)}`,
    `[Final excerpt]\n${transcript.slice(finalStart)}`,
  ];
  const text = sections.join("\n\n[... transcript excerpted for length ...]\n\n");

  return {
    text,
    mode: "excerpted",
    inputCharCount: transcript.length,
    analyzedCharCount: firstSize + middleSize + finalSize,
  };
}

function parseSummaryObject(raw: unknown): OpenAiSummary | null {
  const obj = raw as Partial<OpenAiSummary>;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const keyPoints = Array.isArray(obj.keyPoints)
    ? obj.keyPoints.map((p) => String(p).trim()).filter(Boolean).slice(0, 15)
    : [];
  const detailedNotes = Array.isArray(obj.detailedNotes)
    ? obj.detailedNotes
        .map((s) => ({
          section: String((s as { section?: unknown }).section ?? "").trim(),
          bullets: Array.isArray((s as { bullets?: unknown }).bullets)
            ? ((s as { bullets: unknown[] }).bullets)
                .map((b) => String(b).trim())
                .filter(Boolean)
                .slice(0, 10)
            : [],
        }))
        .filter((s) => s.section && s.bullets.length > 0)
        .slice(0, 8)
    : [];
  const importantCommands = Array.isArray(obj.importantCommands)
    ? obj.importantCommands
        .map((p) => String(p).trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const actionItems = Array.isArray(obj.actionItems)
    ? obj.actionItems.map((p) => String(p).trim()).filter(Boolean).slice(0, 12)
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

  if (
    !summary &&
    keyPoints.length === 0 &&
    detailedNotes.length === 0 &&
    importantCommands.length === 0 &&
    actionItems.length === 0 &&
    outline.length === 0
  ) {
    return null;
  }

  return {
    summary,
    keyPoints,
    detailedNotes,
    importantCommands,
    actionItems,
    outline,
  };
}

async function summariseWithOpenAi(args: {
  source: Source;
  title: string | null;
  author: string | null;
  transcript: string | null;
  description: string | null;
  extra: string[];
}): Promise<{
  data: OpenAiSummary;
  modelUsed: string;
  usage: OpenAiUsage | null;
  transcriptCoverage: SummaryResponse["transcriptCoverage"];
} | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.startsWith("sk-")) return null;

  const TRANSCRIPT_CHAR_BUDGET = 110000;
  const transcriptContext = buildTranscriptContext(
    args.transcript,
    TRANSCRIPT_CHAR_BUDGET,
  );

  const systemPrompt = [
    "You are a precise study/notes assistant. Summarise online videos for a busy reader who wants every useful detail without fluff.",
    "You MUST reply with a single JSON object and nothing else (no markdown fences).",
    "Schema:",
    '  "summary": string  (2–4 sentence TL;DR, plain prose, no bullets)',
    '  "keyPoints": string[]  (8–15 standalone takeaways, full sentences, ordered by importance)',
    '  "detailedNotes": Array<{ "section": string, "bullets": string[] }>  (4–8 sections covering the actual teaching, claims, examples, numbers, tools, and caveats)',
    '  "importantCommands": string[]  (commands, code, URLs, settings, keyboard shortcuts, formulas, prompts, named tools, or step sequences; exact wording when available; [] if none)',
    '  "actionItems": string[]  (practical next steps the viewer can take; [] if the video is purely informational)',
    '  "outline": Array<{ "section": string, "bullets": string[] }>  (3–6 sections, each with 2–6 short bullets — suitable for slides)',
    "Style rules:",
    "- Be specific. Prefer concrete claims, numbers, names, examples from the source.",
    "- Extract commands and setup steps aggressively; these are more important than generic prose.",
    "- If the speaker lists a process, preserve the order.",
    "- Never invent facts that aren't in the source. If something is uncertain, omit it.",
    "- Each key point should make sense without context.",
    "- Section titles should be short Title Case (3–6 words).",
  ].join("\n");

  const userParts: string[] = [
    `Source platform: ${args.source}`,
    args.title ? `Video title: ${args.title}` : "Video title: (unknown)",
    args.author ? `Author/channel: ${args.author}` : "",
  ].filter(Boolean);

  if (args.description) {
    userParts.push(
      `Author-written description / caption:\n${args.description.slice(0, 4000)}`,
    );
  }
  for (const x of args.extra) userParts.push(x);

  if (transcriptContext.text) {
    userParts.push(
      `Transcript ${
        transcriptContext.mode === "excerpted"
          ? "(long video excerpted across beginning, middle, and end; analyze only the provided excerpts and avoid pretending this is complete)"
          : "(complete)"
      }:\n${transcriptContext.text}`,
    );
  } else if (args.description) {
    userParts.push(
      "(no spoken transcript was available — base the summary on the author's description above; if a fact isn't directly supported by it, omit it. Include in keyPoints a brief note that this summary is built from the description, not the spoken audio.)",
    );
  } else {
    userParts.push(
      "(no transcript or description available — produce the most useful summary you can from the title alone, and add to keyPoints a clear caveat that nothing beyond the title was available)",
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
        max_tokens: 2400,
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
    const usage = data.usage ?? null;
    if (usage) logOpenAIUsage(modelUsed, "video_summary", usage);
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }
    const summary = parseSummaryObject(parsed);
    if (!summary) return null;
    return {
      data: summary,
      modelUsed,
      usage,
      transcriptCoverage: {
        mode: transcriptContext.mode,
        inputCharCount: transcriptContext.inputCharCount,
        analyzedCharCount: transcriptContext.analyzedCharCount,
      },
    };
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
    let descriptionText: string | null = null;
    let descriptionExtra: string[] = [];

    if (source === SOURCE_YOUTUBE) {
      const videoId = getYouTubeVideoId(url);
      if (!videoId) {
        return NextResponse.json(
          { error: "Couldn't extract a video id from that YouTube URL." },
          { status: 400 },
        );
      }
      const [meta, transcript, page] = await Promise.all([
        fetchYouTubeOembed(url),
        fetchYouTubeTranscript(videoId),
        fetchVideoPageDescription(`https://www.youtube.com/watch?v=${videoId}`),
      ]);
      title = meta?.title ?? null;
      author = meta?.author_name ?? null;
      thumbnailUrl = meta?.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      descriptionText = page?.description ?? null;
      descriptionExtra = page?.extra ?? [];
      if (transcript) {
        transcriptText = transcript.text;
        language = transcript.language;
      } else if (descriptionText) {
        warnings.push(
          "No captions available — summary is built from the author's description and metadata, not the spoken audio.",
        );
      } else {
        warnings.push(
          "No captions or description available — summary is generated from the title only and may be vague.",
        );
      }
    } else {
      const [meta, page] = await Promise.all([
        fetchTikTokOembed(url),
        fetchVideoPageDescription(url),
      ]);
      title = meta?.title ?? null;
      author = meta?.author_name ?? null;
      thumbnailUrl = meta?.thumbnail_url ?? null;
      descriptionText = page?.description ?? null;
      descriptionExtra = page?.extra ?? [];
      if (descriptionText) {
        warnings.push(
          "TikTok doesn't expose spoken transcripts — this summary is grounded in the post caption, hashtags, and metadata.",
        );
      } else {
        warnings.push(
          "TikTok summaries use only the post title and author — TikTok does not expose transcripts to third-party apps.",
        );
      }
    }

    const ai = await summariseWithOpenAi({
      source,
      title,
      author,
      transcript: transcriptText,
      description: descriptionText,
      extra: descriptionExtra,
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

    const cost = ai.usage
      ? computeCost(ai.modelUsed, ai.usage.prompt_tokens, ai.usage.completion_tokens)
      : null;

    if (ai.transcriptCoverage.mode === "excerpted") {
      warnings.push(
        `Very long transcript — analyzed ${ai.transcriptCoverage.analyzedCharCount.toLocaleString()} of ${ai.transcriptCoverage.inputCharCount.toLocaleString()} characters across the beginning, middle, and end.`,
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
      detailedNotes: ai.data.detailedNotes,
      importantCommands: ai.data.importantCommands,
      actionItems: ai.data.actionItems,
      outline: ai.data.outline,
      transcriptCoverage: ai.transcriptCoverage,
      generatedAt: new Date().toISOString(),
      warnings,
      cost,
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
