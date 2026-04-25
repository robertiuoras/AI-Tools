import { NextRequest, NextResponse } from "next/server";
import Innertube, { UniversalCache } from "youtubei.js";
import { YoutubeTranscript } from "youtube-transcript";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * AI Video Summariser
 * --------------------
 * Accepts a YouTube URL, or an uploaded audio/video file, and returns a structured summary:
 * - one-paragraph TL;DR
 * - 5–10 key points
 * - hierarchical outline (sections → bullets) suitable for slides / docs
 *
 * Strategy:
 * - YouTube → fetch captions via `youtube-transcript`; if unavailable, download
 *   the audio stream, transcribe it with OpenAI, then summarise the transcript.
 * - Uploads → transcribe audio/video with OpenAI, then summarise the transcript.
 * - Metadata is used only as context. It never replaces real transcript content.
 *
 * Failure modes are surfaced as `{ error, hint }` JSON, never as 500s, so the
 * UI can render an actionable message (e.g. "captions disabled by uploader").
 */

const SOURCE_YOUTUBE = "youtube" as const;
const SOURCE_TIKTOK = "tiktok" as const;
const SOURCE_UPLOAD = "upload" as const;
type Source = typeof SOURCE_YOUTUBE | typeof SOURCE_TIKTOK | typeof SOURCE_UPLOAD;

interface SummaryResponse {
  source: Source;
  videoUrl: string;
  fileName: string | null;
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

const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_TRANSCRIPTION_BYTES = MAX_UPLOAD_BYTES;
const SUPPORTED_UPLOAD_TYPES = [
  "audio/flac",
  "audio/m4a",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/mpeg",
  "video/ogg",
  "video/quicktime",
  "video/webm",
];

/** iOS HLS: each segment is a full GET; avoids googlevideo 403s on follow-up `range=` / Range requests. */
const YT_HLS_HEADERS: Record<string, string> = {
  "User-Agent":
    "com.google.ios.youtube/19.12.3 (iPhone15,2; U; CPU iOS 16_5 like Mac OS X; en_US)",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.youtube.com/",
  Origin: "https://www.youtube.com",
};

function hlsClenFromMediaUri(uri: string): number {
  const m = uri.match(/sgoap%2Fclen%3D(\d+)/) ?? uri.match(/sgoap\/clen%3D(\d+)/);
  return m?.[1] ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Picks a low-bitrate *audio* rendition from a master m3u8 (InnerTube iOS: `#EXT-X-MEDIA` lines).
 * Prefer the explicit small `itag/233` playlist when present.
 */
function pickAudioMediaPlaylistFromMasterManifest(masterText: string): string | null {
  const lines = masterText.split("\n");
  const mediaRows = lines
    .filter((l) => l.startsWith("#EXT-X-MEDIA:") && l.includes("TYPE=AUDIO") && l.includes("URI="))
    .map((row) => {
      const m = row.match(/URI="([^"]+)"/);
      return m?.[1] ? m[1] : null;
    })
    .filter((u): u is string => Boolean(u));
  if (mediaRows.length === 0) return null;
  const byItag233 = mediaRows.find((u) => u.includes("/itag/233/"));
  if (byItag233) return byItag233;
  return [...mediaRows].sort(
    (a, b) => hlsClenFromMediaUri(a) - hlsClenFromMediaUri(b),
  )[0]!;
}

function listHlsSegmentUrls(playlistText: string): string[] {
  return playlistText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && l.startsWith("https://"));
}

async function downloadHlsAudioToBuffer(
  initialPlaylistUrl: string,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const res0 = await fetch(initialPlaylistUrl, {
    method: "GET",
    headers: { ...YT_HLS_HEADERS },
    signal: AbortSignal.timeout(30000),
  });
  if (!res0.ok) return null;
  const playlist = await res0.text();
  const segments = listHlsSegmentUrls(playlist);
  if (segments.length === 0) return null;

  const out: Uint8Array[] = [];
  let n = 0;
  for (const seg of segments) {
    if (n >= maxBytes) return null;
    const r = await fetch(seg, {
      method: "GET",
      headers: { ...YT_HLS_HEADERS },
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return null;
    const part = new Uint8Array(await r.arrayBuffer());
    if (part.byteLength === 0) return null;
    if (n + part.byteLength > maxBytes) return null;
    out.push(part);
    n += part.byteLength;
  }
  return mergeUint8Arrays(out, n);
}

function mergeUint8Arrays(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

type UrlAudioResult =
  | {
      ok: true;
      file: File;
      formatDescription: string;
      byteLength: number;
    }
  | {
      ok: false;
      reason: "too-large" | "unavailable";
      message: string;
    };

let innertubeClient: Awaited<ReturnType<typeof Innertube.create>> | null = null;
async function getInnertube() {
  if (!innertubeClient) {
    innertubeClient = await Innertube.create({
      cache: new UniversalCache(true),
    });
  }
  return innertubeClient;
}

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

async function transcribeUploadedFile(
  file: File,
): Promise<{ text: string; language: string | null; model: string } | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.startsWith("sk-")) return null;

  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("response_format", "json");
  form.append("file", file, file.name || "uploaded-video");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(55000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      text?: string;
      language?: string;
      model?: string;
    };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) return null;
    return {
      text,
      language: typeof data.language === "string" ? data.language : null,
      model: data.model ?? "gpt-4o-mini-transcribe",
    };
  } catch {
    return null;
  }
}

async function fetchYouTubeAudioForTranscription(
  videoId: string,
): Promise<UrlAudioResult> {
  try {
    const innertube = await getInnertube();
    // `ANDROID` direct URLs are often limited to a single `range=` / Range window; follow-up
    // requests 403. The `IOS` client exposes a master HLS URL; we fetch the small audio
    // playlist and concatenate segment GETs (each returns 200) into one buffer.
    const info = await innertube.getInfo(videoId, { client: "IOS" });
    const masterUrl = info.streaming_data?.hls_manifest_url;
    if (!masterUrl) {
      return {
        ok: false,
        reason: "unavailable",
        message:
          "YouTube did not return an HLS manifest for this video, so the audio could not be downloaded in segments.",
      };
    }
    const master = await (
      await fetch(masterUrl, {
        method: "GET",
        headers: { ...YT_HLS_HEADERS },
        signal: AbortSignal.timeout(25000),
      })
    ).text();
    const audioPlaylist = pickAudioMediaPlaylistFromMasterManifest(master);
    if (!audioPlaylist) {
      return {
        ok: false,
        reason: "unavailable",
        message: "Could not find an HLS audio playlist in YouTube’s manifest for this video.",
      };
    }

    const clen = hlsClenFromMediaUri(audioPlaylist);
    if (clen !== Number.POSITIVE_INFINITY && clen > MAX_TRANSCRIPTION_BYTES) {
      return {
        ok: false,
        reason: "too-large",
        message:
          "The HLS stream’s reported audio size is larger than the transcription API limit.",
      };
    }

    const buf = await downloadHlsAudioToBuffer(audioPlaylist, MAX_TRANSCRIPTION_BYTES);
    if (!buf) {
      return {
        ok: false,
        reason: "unavailable",
        message: "Couldn’t download the HLS audio segments for this YouTube video.",
      };
    }
    if (buf.byteLength === 0) {
      return {
        ok: false,
        reason: "unavailable",
        message: "Downloaded an empty audio stream from YouTube.",
      };
    }

    // Concatenated HLS media segments (MPEG-TS). Transcription still accepts this as a generic
    // audio container when labeled as mpeg; filename extension helps the API.
    const file = new File([new Uint8Array(buf)], "youtube-audio.mpeg", {
      type: "audio/mpeg",
    });
    return {
      ok: true,
      file,
      formatDescription: "HLS (iOS client) · MPEG-TS audio segments",
      byteLength: file.size,
    };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "Couldn't extract an audio stream from this YouTube URL.",
    };
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
    "You are a precise study/notes assistant. Summarise online videos for a busy reader who wants accurate detail without fluff.",
    "You MUST reply with a single JSON object and nothing else (no markdown fences).",
    "Schema:",
    '  "summary": string  (3–5 concise sentences covering the topic, speaker if known, and main conclusion)',
    '  "keyPoints": string[]  (6–12 standalone takeaways, full sentences, ordered by importance)',
    '  "detailedNotes": Array<{ "section": string, "bullets": string[] }>  (4–7 sections covering the actual teaching, claims, examples, numbers, tools, and caveats)',
    '  "importantCommands": string[]  (commands, code, URLs, settings, keyboard shortcuts, formulas, prompts, named tools, or step sequences; exact wording when available; [] if none)',
    '  "actionItems": string[]  (practical next steps the viewer can take; [] if the video is purely informational)',
    '  "outline": Array<{ "section": string, "bullets": string[] }>  (3–6 sections, each with 2–6 short bullets — suitable for slides)',
    "Style rules:",
    "- Be specific. Prefer concrete claims, numbers, names, examples from the source.",
    "- Extract commands and setup steps aggressively; these are more important than generic prose.",
    "- If the speaker lists a process, preserve the order.",
    "- Include quantitative details such as costs, time windows, message counts, percentages, and named examples.",
    "- Be more brief than a full transcript-derived article: compress repetition, but keep every distinct useful fact.",
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
  } else {
    userParts.push(
      "(no spoken transcript was available — do not summarise metadata as if it were the video content.)",
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

    const contentType = request.headers.get("content-type") ?? "";
    let url = "";
    let uploadedFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (file instanceof File) {
        uploadedFile = file;
      }
      const formUrl = form.get("url");
      url = typeof formUrl === "string" ? formUrl.trim() : "";
    } else {
      const body = (await request.json().catch(() => ({}))) as { url?: string };
      url = typeof body.url === "string" ? body.url.trim() : "";
    }

    if (!url && !uploadedFile) {
      return NextResponse.json(
        { error: "Provide a YouTube URL or upload an audio/video file." },
        { status: 400 },
      );
    }

    let source: Source = SOURCE_UPLOAD;
    if (url) {
      const detectedSource = detectSource(url);
      if (!detectedSource) {
        return NextResponse.json(
          {
            error: "Unsupported URL.",
            hint:
              "Use a YouTube URL, or upload the audio/video file so it can be transcribed first.",
          },
          { status: 400 },
        );
      }
      source = detectedSource;
    }

    if (uploadedFile && uploadedFile.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: "File is too large.",
          hint: "Upload an audio/video file under 24 MB, or compress/trim it first.",
        },
        { status: 413 },
      );
    }

    if (
      uploadedFile &&
      uploadedFile.type &&
      !SUPPORTED_UPLOAD_TYPES.includes(uploadedFile.type)
    ) {
      return NextResponse.json(
        {
          error: "Unsupported file type.",
          hint:
            "Upload a common audio/video file such as MP3, MP4, M4A, WAV, WEBM, MPEG, or MOV.",
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
    let fileName: string | null = uploadedFile?.name || null;

    if (uploadedFile) {
      title = uploadedFile.name || "Uploaded video";
      const transcription = await transcribeUploadedFile(uploadedFile);
      if (!transcription) {
        return NextResponse.json(
          {
            error: "Couldn't transcribe this file.",
            hint:
              "Make sure OPENAI_API_KEY is set and upload a clear audio/video file under 24 MB.",
          },
          { status: 502 },
        );
      }
      transcriptText = transcription.text;
      language = transcription.language;
      warnings.push(
        `Transcribed uploaded file with ${transcription.model}; summary is grounded in the generated transcript.`,
      );
    } else if (source === SOURCE_YOUTUBE) {
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
      } else {
        warnings.push(
          "No captions were available, so the app generated its own transcript from the YouTube audio stream.",
        );
        const audio = await fetchYouTubeAudioForTranscription(videoId);
        if (!audio.ok) {
          return NextResponse.json(
            {
              error: "Couldn't create a transcript for this URL.",
              hint:
                audio.reason === "too-large"
                  ? `${audio.message} Upload a shorter/compressed audio or video file instead.`
                  : `${audio.message} Upload the audio/video file instead so it can be transcribed directly.`,
            },
            { status: audio.reason === "too-large" ? 413 : 422 },
          );
        }
        const transcription = await transcribeUploadedFile(audio.file);
        if (!transcription) {
          return NextResponse.json(
            {
              error: "Couldn't transcribe this video's audio.",
              hint:
                "The audio was extracted, but OpenAI transcription failed. Try again, or upload the audio/video file directly.",
            },
            { status: 502 },
          );
        }
        transcriptText = transcription.text;
        language = transcription.language;
        warnings.push(
          `Transcribed ${audio.formatDescription} (${(audio.byteLength / 1024 / 1024).toFixed(1)} MB) with ${transcription.model}.`,
        );
      }
    } else {
      return NextResponse.json(
        {
          error: "TikTok URLs don't expose real transcripts.",
          hint:
            "Upload the TikTok audio/video file instead so the app can create its own transcript and summarize real spoken content.",
        },
        { status: 422 },
      );
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
      fileName,
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
