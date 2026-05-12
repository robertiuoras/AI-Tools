import { NextRequest } from "next/server";
import Innertube, { UniversalCache } from "youtubei.js";
import { YoutubeTranscript } from "youtube-transcript";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";
import {
  readTranscriptCache,
  writeTranscriptCache,
  type TranscriptKind,
  type TranscriptSource,
  type TranscriptSegment,
} from "@/lib/video-transcript-cache";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * AI Video Summariser — YouTube + TikTok URL summariser.
 *
 * Pipeline:
 * 1. Detect source (YouTube or TikTok). Other URLs are rejected.
 * 2. Fetch a timestamped transcript:
 *    - YouTube: manual captions → ASR captions (with timestamps) → HLS audio + Whisper (verbose_json).
 *    - TikTok: resolve the share URL to a direct MP4, then Whisper (verbose_json).
 * 3. Reject thin transcripts (<300 chars) and Whisper hallucinations hard.
 * 4. Two parallel OpenAI calls:
 *    a) Streaming prose summary (no title/metadata in prompt — transcript only).
 *    b) Non-streaming grounded JSON: chapters, keyPoints with verbatim quotes, actionItems.
 *       Server-side citation verification drops any key point whose quote isn't in the transcript.
 * 5. Returns SSE: meta → summary_chunk* → structured → done
 *
 * The result tells the UI exactly *which* transcript source was used so silent
 * failures stop being silent.
 */

const SOURCE_YOUTUBE = "youtube" as const;
const SOURCE_TIKTOK = "tiktok" as const;
type Source = typeof SOURCE_YOUTUBE | typeof SOURCE_TIKTOK;

const MIN_USABLE_TRANSCRIPT_CHARS = 300;

interface SummaryResponse {
  source: Source;
  videoUrl: string;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  language: string | null;
  hasTranscript: boolean;
  transcriptCharCount: number;
  transcriptSource: TranscriptSource;
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
  /** Token usage + USD cost for the structured summarisation call (gpt-4o-mini). */
  cost: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputCostUsd: number;
    outputCostUsd: number;
    totalCostUsd: number;
  } | null;
  /** True when the transcript was loaded from the cache instead of re-fetched. */
  transcriptCacheHit: boolean;
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

/** OpenAI Whisper hard upload limit. */
const MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;
/** Refuse TikTok clips this short — almost always non-spoken memes. */
const TIKTOK_MIN_DURATION_SEC = 6;
/** Cap TikTok transcription cost; rejects long-form TikToks. */
const TIKTOK_MAX_DURATION_SEC = 600;

/** iOS HLS: each segment is a full GET; avoids googlevideo 403s on follow-up `range=` / Range requests. */
const YT_HLS_HEADERS: Record<string, string> = {
  "User-Agent":
    "com.google.ios.youtube/19.12.3 (iPhone15,2; U; CPU iOS 16_5 like Mac OS X; en_US)",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.youtube.com/",
  Origin: "https://www.youtube.com",
};

const YT_HLS_FALLBACK_HEADERS: Record<string, string> = {
  Accept: "*/*",
  Referer: "https://www.youtube.com/",
  Origin: "https://www.youtube.com",
};

async function fetchWithRetries(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  attempts = 3,
): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      // Retry only transient classes; return deterministic failures quickly.
      if (res.status !== 429 && res.status < 500) return res;
    } catch {
      // timeout/network/transient errors: retry
    }
  }
  return null;
}

function hlsClenFromMediaUri(uri: string): number {
  const m = uri.match(/sgoap%2Fclen%3D(\d+)/) ?? uri.match(/sgoap\/clen%3D(\d+)/);
  return m?.[1] ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Picks a low-bitrate *audio* rendition from a master m3u8 (InnerTube iOS: `#EXT-X-MEDIA` lines).
 * Prefer the explicit small `itag/233` playlist when present.
 */
function pickAudioMediaPlaylistsFromMasterManifest(masterText: string): string[] {
  const lines = masterText.split("\n");
  const mediaRows = lines
    .filter((l) => l.startsWith("#EXT-X-MEDIA:") && l.includes("TYPE=AUDIO") && l.includes("URI="))
    .map((row) => {
      const m = row.match(/URI="([^"]+)"/);
      return m?.[1] ? m[1] : null;
    })
    .filter((u): u is string => Boolean(u));
  if (mediaRows.length === 0) return [];
  const byItag233 = mediaRows.find((u) => u.includes("/itag/233/"));
  const sorted = [...mediaRows].sort(
    (a, b) => hlsClenFromMediaUri(a) - hlsClenFromMediaUri(b),
  );
  if (!byItag233) return sorted;
  return [byItag233, ...sorted.filter((u) => u !== byItag233)];
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
  // Two request profiles: iOS app-like headers first, then a neutral fallback.
  const headerProfiles = [YT_HLS_HEADERS, YT_HLS_FALLBACK_HEADERS];
  let res0: Response | null = null;
  for (const h of headerProfiles) {
    res0 = await fetchWithRetries(
      initialPlaylistUrl,
      { method: "GET", headers: { ...h } },
      30000,
      3,
    );
    if (res0?.ok) break;
  }
  if (!res0?.ok) return null;
  const playlist = await res0.text();
  const segments = listHlsSegmentUrls(playlist);
  if (segments.length === 0) return null;

  const out: Uint8Array[] = [];
  let n = 0;
  for (const seg of segments) {
    if (n >= maxBytes) return null;
    let r: Response | null = null;
    for (const h of headerProfiles) {
      r = await fetchWithRetries(
        seg,
        { method: "GET", headers: { ...h } },
        120000,
        3,
      );
      if (r?.ok) break;
    }
    if (!r?.ok) return null;
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

type YouTubeCaptionResult =
  | { text: string; segments: TranscriptSegment[]; language: string | null; kind: "manual" | "asr" }
  | null;

/**
 * Fetch YouTube captions, preferring manual over ASR. The `kind` lets the caller
 * decide whether to fall back to Whisper even when *something* came back —
 * very short ASR captions often aren't worth feeding to the summariser.
 */
async function fetchYouTubeTranscript(
  videoId: string,
  title: string | null,
): Promise<YouTubeCaptionResult> {
  // First try `youtube-transcript`; it doesn't tell us manual vs ASR, so only
  // accept it when the result is substantively longer than the title (a common
  // failure mode: it returns the auto-translated title alone).
  // Items have `offset` (ms) and `duration` (ms) — preserve them as segments.
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    if (items && items.length > 0) {
      const segs: TranscriptSegment[] = items
        .map((it) => {
          const startSec = (it.offset ?? 0) / 1000;
          const endSec = startSec + (it.duration ?? 0) / 1000;
          return { text: it.text.replace(/\s+/g, " ").trim(), startSec, endSec };
        })
        .filter((s) => s.text.length > 0);
      const text = segs.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
      if (text && !looksLikeTitleEcho(text, title)) {
        return { text, segments: segs, language: null, kind: "asr" };
      }
    }
  } catch {
    // fall through to InnerTube
  }

  try {
    const innertube = await getInnertube();
    const info = await innertube.getInfo(videoId, { client: "WEB" });
    const tracks = info.captions?.caption_tracks ?? [];
    if (tracks.length === 0) return null;

    const orderedTracks = [
      ...tracks.filter((t) => t.kind !== "asr" && typeof t.base_url === "string"),
      ...tracks.filter((t) => t.kind === "asr" && typeof t.base_url === "string"),
    ];

    for (const track of orderedTracks) {
      const baseUrl = track.base_url;
      if (!baseUrl) continue;
      const captionRes = await fetchWithRetries(
        baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}&fmt=srv3`,
        { method: "GET", headers: { ...YT_HLS_FALLBACK_HEADERS } },
        20000,
        3,
      );
      if (!captionRes?.ok) continue;
      const xml = await captionRes.text();
      if (!xml) continue;

      const decodeHtml = (s: string): string =>
        s
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

      // Parse srv3 XML: <text start="12.345" dur="2.5">...</text>
      const segs: TranscriptSegment[] = Array.from(
        xml.matchAll(/<text\s[^>]*start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g),
      )
        .map((m) => ({
          text: decodeHtml(m[3] ?? "").replace(/\s+/g, " ").trim(),
          startSec: parseFloat(m[1] ?? "0"),
          endSec: parseFloat(m[1] ?? "0") + parseFloat(m[2] ?? "0"),
        }))
        .filter((s) => s.text.length > 0);

      // Fallback: no timestamp attrs present, just extract text
      const text =
        segs.length > 0
          ? segs.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim()
          : Array.from(xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g))
              .map((m) => decodeHtml(m[1] ?? "").replace(/\s+/g, " ").trim())
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();

      if (!text || looksLikeTitleEcho(text, title)) continue;

      // If we couldn't get timestamps, create a single segment covering the whole text
      const segments: TranscriptSegment[] =
        segs.length > 0
          ? segs
          : [{ text, startSec: 0, endSec: 0 }];

      return {
        text,
        segments,
        language: track.language_code ?? null,
        kind: track.kind === "asr" ? "asr" : "manual",
      };
    }
    return null;
  } catch {
    return null;
  }
}

const WHISPER_FILLER = [
  /^\[music\]$/i,
  /^♪+\s*$/,
  /^thanks for watching/i,
  /^please subscribe/i,
  /^like and subscribe/i,
  /^\[applause\]$/i,
  /^\[laughter\]$/i,
  /^\[silence\]$/i,
  /^\[inaudible\]$/i,
];

/**
 * Detect Whisper hallucinations: looping segments, near-empty unique-word ratio,
 * or transcripts dominated by filler phrases (music, "thanks for watching", etc.).
 * Returns true when the output should be rejected rather than summarised.
 */
function looksLikeWhisperHallucination(segments: TranscriptSegment[]): boolean {
  if (segments.length === 0) return false;

  // Consecutive duplicate segments (Whisper's classic repetition bug)
  let consecDupes = 0;
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1].text.trim().toLowerCase();
    const curr = segments[i].text.trim().toLowerCase();
    if (prev && prev === curr) {
      consecDupes++;
      if (consecDupes >= 2) return true; // 3 identical in a row
    } else {
      consecDupes = 0;
    }
  }

  // Heavy vocabulary repetition (unique words / total words < 0.25)
  const allWords = segments.flatMap((s) =>
    s.text.toLowerCase().split(/\s+/).filter(Boolean),
  );
  if (allWords.length > 30) {
    const uniqueRatio = new Set(allWords).size / allWords.length;
    if (uniqueRatio < 0.25) return true;
  }

  // Filler dominance (>60% of segments are music/non-speech markers)
  const fillerCount = segments.filter((s) =>
    WHISPER_FILLER.some((p) => p.test(s.text.trim())),
  ).length;
  if (segments.length > 0 && fillerCount / segments.length > 0.6) return true;

  return false;
}

/**
 * Return true when a "transcript" is really just the title repeated — a common
 * failure mode for short videos where YouTube returns the title as a single ASR cue.
 */
function looksLikeTitleEcho(text: string, title: string | null): boolean {
  if (!title) return false;
  const t = text.replace(/\s+/g, " ").trim().toLowerCase();
  const ti = title.replace(/\s+/g, " ").trim().toLowerCase();
  if (!t || !ti) return false;
  if (t.length < 200 && (t === ti || t.includes(ti) || ti.includes(t))) {
    return true;
  }
  return false;
}

/**
 * Send an audio/video buffer to OpenAI Whisper for transcription.
 * Uses whisper-1 with verbose_json to get per-segment timestamps.
 * Used by both the YouTube HLS fallback and the TikTok direct-MP4 path.
 */
async function transcribeAudioBuffer(
  file: File,
): Promise<{ text: string; segments: TranscriptSegment[]; language: string | null; model: string } | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.startsWith("sk-")) return null;

  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("file", file, file.name || "audio");

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
      segments?: Array<{ start?: number; end?: number; text?: string }>;
    };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) return null;

    const segments: TranscriptSegment[] = Array.isArray(data.segments)
      ? data.segments
          .map((s) => ({
            text: (typeof s.text === "string" ? s.text : "").replace(/\s+/g, " ").trim(),
            startSec: typeof s.start === "number" ? s.start : 0,
            endSec: typeof s.end === "number" ? s.end : 0,
          }))
          .filter((s) => s.text.length > 0)
      : [{ text, startSec: 0, endSec: 0 }];

    return { text, segments, language: typeof data.language === "string" ? data.language : null, model: "whisper-1" };
  } catch {
    return null;
  }
}

interface TikTokMedia {
  mp4Url: string;
  durationSec: number;
  caption: string | null;
  author: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  music: string | null;
}

const TIKTOK_DESKTOP_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Accept-Language": "en-US,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  Referer: "https://www.tiktok.com/",
};

/**
 * Resolve a TikTok share URL to its direct MP4 + metadata.
 *
 * vt.tiktok.com / vm.tiktok.com short links 301-redirect to the real watch URL;
 * Node's fetch follows by default, so we capture the final URL from `res.url`.
 *
 * The MP4 URL and metadata live in a JSON blob inside the page HTML at
 * `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">…</script>`.
 */
async function resolveTikTokMedia(url: string): Promise<TikTokMedia | null> {
  try {
    const res = await fetch(url, {
      headers: TIKTOK_DESKTOP_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html) return null;

    const scriptMatch = html.match(
      /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/,
    );
    if (!scriptMatch?.[1]) return null;

    let data: unknown;
    try {
      data = JSON.parse(scriptMatch[1]);
    } catch {
      return null;
    }

    const itemStruct = findItemStruct(data);
    if (!itemStruct) return null;

    const mp4Url =
      typeof itemStruct.video?.playAddr === "string"
        ? itemStruct.video.playAddr
        : null;
    if (!mp4Url) return null;

    const durationSec =
      typeof itemStruct.video?.duration === "number"
        ? itemStruct.video.duration
        : 0;

    return {
      mp4Url,
      durationSec,
      caption: typeof itemStruct.desc === "string" ? itemStruct.desc : null,
      author:
        typeof itemStruct.author?.uniqueId === "string"
          ? itemStruct.author.uniqueId
          : typeof itemStruct.author?.nickname === "string"
            ? itemStruct.author.nickname
            : null,
      title: typeof itemStruct.desc === "string" ? itemStruct.desc.slice(0, 120) : null,
      thumbnailUrl:
        typeof itemStruct.video?.cover === "string"
          ? itemStruct.video.cover
          : typeof itemStruct.video?.dynamicCover === "string"
            ? itemStruct.video.dynamicCover
            : null,
      music:
        typeof itemStruct.music?.title === "string"
          ? itemStruct.music.title
          : null,
    };
  } catch {
    return null;
  }
}

interface TikTokItemStruct {
  desc?: unknown;
  author?: { uniqueId?: unknown; nickname?: unknown };
  video?: {
    playAddr?: unknown;
    duration?: unknown;
    cover?: unknown;
    dynamicCover?: unknown;
  };
  music?: { title?: unknown };
}

/**
 * The shape under `__UNIVERSAL_DATA_FOR_REHYDRATION__` shifts month-to-month.
 * Walk the tree breadth-first looking for an object that has the shape of an
 * item struct (a `video.playAddr` URL).
 */
function findItemStruct(root: unknown): TikTokItemStruct | null {
  const queue: unknown[] = [root];
  let visited = 0;
  while (queue.length > 0 && visited < 5000) {
    const node = queue.shift();
    visited += 1;
    if (!node || typeof node !== "object") continue;
    const obj = node as Record<string, unknown>;
    const video = obj.video as Record<string, unknown> | undefined;
    if (
      video &&
      typeof video.playAddr === "string" &&
      typeof obj.desc === "string"
    ) {
      return obj as TikTokItemStruct;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") queue.push(v);
    }
  }
  return null;
}

/**
 * Download the MP4 from TikTok's CDN and wrap it in a File so it can be sent
 * to OpenAI transcription. We don't need ffmpeg — Whisper accepts MP4 directly
 * and pricing is per audio minute, not per byte.
 */
async function fetchTikTokAudioForTranscription(
  mp4Url: string,
): Promise<UrlAudioResult> {
  try {
    const res = await fetch(mp4Url, {
      headers: TIKTOK_DESKTOP_HEADERS,
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: "unavailable",
        message: `TikTok refused the video download (${res.status}).`,
      };
    }
    const contentLengthHeader = res.headers.get("content-length");
    if (
      contentLengthHeader &&
      Number(contentLengthHeader) > MAX_TRANSCRIPTION_BYTES
    ) {
      return {
        ok: false,
        reason: "too-large",
        message: `The TikTok video is ${(Number(contentLengthHeader) / 1024 / 1024).toFixed(1)} MB — over the 24 MB transcription limit.`,
      };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      return {
        ok: false,
        reason: "unavailable",
        message: "TikTok returned an empty video body.",
      };
    }
    if (buf.byteLength > MAX_TRANSCRIPTION_BYTES) {
      return {
        ok: false,
        reason: "too-large",
        message: `The TikTok video is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB — over the 24 MB transcription limit.`,
      };
    }
    const file = new File([buf], "tiktok-video.mp4", { type: "video/mp4" });
    return {
      ok: true,
      file,
      formatDescription: "TikTok MP4",
      byteLength: buf.byteLength,
    };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "Couldn't download the TikTok video — try again or use a different URL.",
    };
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
    const masterRes =
      (await fetchWithRetries(
        masterUrl,
        { method: "GET", headers: { ...YT_HLS_HEADERS } },
        25000,
        3,
      )) ??
      (await fetchWithRetries(
        masterUrl,
        { method: "GET", headers: { ...YT_HLS_FALLBACK_HEADERS } },
        25000,
        2,
      ));
    if (!masterRes?.ok) {
      return {
        ok: false,
        reason: "unavailable",
        message: "Could not download YouTube's HLS manifest for this video.",
      };
    }
    const master = await masterRes.text();
    const audioPlaylists = pickAudioMediaPlaylistsFromMasterManifest(master);
    if (audioPlaylists.length === 0) {
      return {
        ok: false,
        reason: "unavailable",
        message: "Could not find an HLS audio playlist in YouTube’s manifest for this video.",
      };
    }
    let lastTooLarge = false;
    for (const audioPlaylist of audioPlaylists) {
      const clen = hlsClenFromMediaUri(audioPlaylist);
      if (clen !== Number.POSITIVE_INFINITY && clen > MAX_TRANSCRIPTION_BYTES) {
        lastTooLarge = true;
        continue;
      }

      const buf = await downloadHlsAudioToBuffer(audioPlaylist, MAX_TRANSCRIPTION_BYTES);
      if (!buf || buf.byteLength === 0) {
        continue;
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
    }

    return {
      ok: false,
      reason: lastTooLarge ? "too-large" : "unavailable",
      message: lastTooLarge
        ? "The HLS audio renditions are larger than the transcription API limit."
        : "Couldn’t download any available HLS audio rendition for this YouTube video.",
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
  chapters: Array<{ title: string; startSec: number; endSec: number; bullets: string[] }>;
  keyPoints: Array<{ point: string; timestampSec: number; quote: string }>;
  importantCommands: string[];
  actionItems: Array<{ text: string; timestampSec: number }>;
}

interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Format seconds as mm:ss for display in the transcript. */
function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Render segments as timestamped lines for the model prompt.
 * For long transcripts, excerpts are taken from beginning/middle/end so
 * timestamps are still meaningful within each excerpt.
 */
function buildTranscriptContext(
  segments: TranscriptSegment[],
  transcriptText: string,
  budget: number,
): {
  text: string;
  mode: SummaryResponse["transcriptCoverage"]["mode"];
  inputCharCount: number;
  analyzedCharCount: number;
} {
  // Build the full timestamped transcript string
  const full = segments.length > 0
    ? segments.map((s) => `[${formatTimestamp(s.startSec)}] ${s.text}`).join("\n")
    : transcriptText;

  if (full.length <= budget) {
    return { text: full, mode: "full", inputCharCount: full.length, analyzedCharCount: full.length };
  }

  const firstSize = Math.floor(budget * 0.4);
  const middleSize = Math.floor(budget * 0.35);
  const finalSize = budget - firstSize - middleSize;
  const middleStart = Math.max(firstSize, Math.floor(full.length / 2 - middleSize / 2));
  const finalStart = Math.max(middleStart + middleSize, full.length - finalSize);
  const text = [
    `[Beginning excerpt]\n${full.slice(0, firstSize)}`,
    `[Middle excerpt]\n${full.slice(middleStart, middleStart + middleSize)}`,
    `[Final excerpt]\n${full.slice(finalStart)}`,
  ].join("\n\n[... transcript excerpted for length ...]\n\n");

  return {
    text,
    mode: "excerpted",
    inputCharCount: full.length,
    analyzedCharCount: firstSize + middleSize + finalSize,
  };
}

function parseSummaryObject(raw: unknown): OpenAiSummary | null {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object") return null;

  const chapters = Array.isArray(obj.chapters)
    ? obj.chapters
        .map((c) => {
          const ch = c as Record<string, unknown>;
          return {
            title: typeof ch.title === "string" ? ch.title.trim() : "",
            startSec: typeof ch.startSec === "number" ? ch.startSec : 0,
            endSec: typeof ch.endSec === "number" ? ch.endSec : 0,
            bullets: Array.isArray(ch.bullets)
              ? (ch.bullets as unknown[]).map((b) => String(b).trim()).filter(Boolean).slice(0, 8)
              : [],
          };
        })
        .filter((c) => c.title && c.bullets.length > 0)
        .slice(0, 10)
    : [];

  const keyPoints = Array.isArray(obj.keyPoints)
    ? obj.keyPoints
        .map((p) => {
          const kp = p as Record<string, unknown>;
          return {
            point: typeof kp.point === "string" ? kp.point.trim() : "",
            timestampSec: typeof kp.timestampSec === "number" ? kp.timestampSec : 0,
            quote: typeof kp.quote === "string" ? kp.quote.trim() : "",
          };
        })
        .filter((kp) => kp.point)
        .slice(0, 15)
    : [];

  const importantCommands = Array.isArray(obj.importantCommands)
    ? (obj.importantCommands as unknown[]).map((p) => String(p).trim()).filter(Boolean).slice(0, 20)
    : [];

  const actionItems = Array.isArray(obj.actionItems)
    ? obj.actionItems
        .map((a) => {
          const ai = a as Record<string, unknown>;
          return {
            text: typeof ai.text === "string" ? ai.text.trim() : "",
            timestampSec: typeof ai.timestampSec === "number" ? ai.timestampSec : 0,
          };
        })
        .filter((a) => a.text)
        .slice(0, 12)
    : [];

  if (chapters.length === 0 && keyPoints.length === 0 && importantCommands.length === 0 && actionItems.length === 0) {
    return null;
  }

  return { chapters, keyPoints, importantCommands, actionItems };
}

/**
 * Server-side citation verification: drop any keyPoint whose quote doesn't
 * appear (fuzzy match) in the actual transcript text. Prevents hallucinated
 * citations from reaching the UI.
 */
function verifyCitations(
  summary: OpenAiSummary,
  transcriptText: string,
): { verified: OpenAiSummary; droppedCount: number } {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const normTranscript = norm(transcriptText);

  const verified: typeof summary.keyPoints = [];
  let droppedCount = 0;

  for (const kp of summary.keyPoints) {
    const quote = norm(kp.quote);
    if (!quote || quote.length < 10) {
      // No quote provided — keep the point but clear the empty quote
      verified.push({ ...kp, quote: "" });
      continue;
    }
    // Check if the quote (or ≥80% of its words) appears in the transcript
    const quoteWords = quote.split(/\s+/).filter(Boolean);
    const windowSize = Math.min(quoteWords.length, 6);
    let found = false;
    for (let i = 0; i <= quoteWords.length - windowSize; i++) {
      const window = quoteWords.slice(i, i + windowSize).join(" ");
      if (normTranscript.includes(window)) {
        found = true;
        break;
      }
    }
    if (found) {
      verified.push(kp);
    } else {
      droppedCount++;
    }
  }

  // Verify chapter timestamps are within transcript bounds
  const maxSec = summary.chapters.length > 0
    ? Math.max(...summary.chapters.map((c) => c.endSec), 0)
    : 0;
  const chapters = summary.chapters.map((c) => ({
    ...c,
    startSec: Math.max(0, c.startSec),
    endSec: maxSec > 0 ? Math.min(c.endSec, maxSec) : c.endSec,
  }));

  return { verified: { ...summary, keyPoints: verified, chapters }, droppedCount };
}

/** Stream the prose summary sentence-by-sentence from OpenAI. */
async function* streamProseSummary(
  transcriptContext: { text: string; mode: string },
  key: string,
): AsyncGenerator<string> {
  const systemPrompt =
    "You are a concise assistant. Write a 3–5 sentence prose summary of the following video transcript. " +
    "Use only information explicitly stated in the transcript. Do not mention the title or channel name unless it appears in the transcript itself. " +
    "Output the summary as plain text only — no headings, no bullet points, no markdown.";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            transcriptContext.mode === "excerpted"
              ? `Transcript (long video, excerpted):\n${transcriptContext.text}`
              : `Transcript:\n${transcriptContext.text}`,
        },
      ],
      max_tokens: 400,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok || !res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      try {
        const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}

/** Generate the structured summary (chapters, keyPoints, actionItems) in one non-streaming call. */
async function generateStructuredSummary(
  transcriptContext: { text: string; mode: string },
  key: string,
): Promise<{ data: OpenAiSummary; usage: OpenAiUsage | null; modelUsed: string } | null> {
  const systemPrompt = [
    "You are a precise notes assistant. Analyse this video transcript and return a JSON object — no markdown fences.",
    "Output only what is explicitly stated in the transcript. Do not use the video title or channel name as sources of fact.",
    "Schema (all fields required):",
    '  "chapters": Array<{ "title": string (3–6 Title Case words), "startSec": number, "endSec": number, "bullets": string[] (2–6 short bullets per chapter) }>',
    '    — 3–8 chapters covering the full transcript timeline. startSec/endSec come from the [mm:ss] timestamps in the transcript.',
    '  "keyPoints": Array<{ "point": string (full sentence), "timestampSec": number, "quote": string (≤15 words verbatim from transcript) }>',
    '    — 6–12 key takeaways. Each quote MUST be a short phrase that actually appears in the transcript.',
    '  "importantCommands": string[]  — commands, code snippets, URLs, tool names, settings, keyboard shortcuts; exact wording; [] if none.',
    '  "actionItems": Array<{ "text": string, "timestampSec": number }>  — practical next steps the viewer should take; [] if informational only.',
    "Rules: Every fact must come from the transcript. If something is unclear, omit it rather than guessing.",
  ].join("\n");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              transcriptContext.mode === "excerpted"
                ? `Transcript (long video, excerpted — timestamps are approximate):\n${transcriptContext.text}`
                : `Transcript:\n${transcriptContext.text}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 3000,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      model?: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      choices?: Array<{ message?: { content?: string } }>;
    };
    const modelUsed = data.model ?? "gpt-4o-mini";
    const usage = data.usage ?? null;
    if (usage) logOpenAIUsage(modelUsed, "video_summary", usage);
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, "").trim();
    let parsed: unknown;
    try { parsed = JSON.parse(cleaned); } catch { return null; }
    const summary = parseSummaryObject(parsed);
    if (!summary) return null;
    return { data: summary, usage, modelUsed };
  } catch {
    return null;
  }
}

interface AcquiredTranscript {
  text: string;
  segments: TranscriptSegment[];
  source: TranscriptSource;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  description: string | null;
  descriptionExtra: string[];
  warnings: string[];
}

type AcquireResult =
  | { ok: true; transcript: AcquiredTranscript; cacheHit: boolean }
  | { ok: false; status: number; error: string; hint?: string };

async function acquireYouTubeTranscript(url: string): Promise<AcquireResult> {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) {
    return {
      ok: false,
      status: 400,
      error: "Couldn't extract a video id from that YouTube URL.",
    };
  }

  const [meta, page] = await Promise.all([
    fetchYouTubeOembed(url),
    fetchVideoPageDescription(`https://www.youtube.com/watch?v=${videoId}`),
  ]);
  const title = meta?.title ?? null;
  const author = meta?.author_name ?? null;
  const thumbnailUrl =
    meta?.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  // Cache hit short-circuits transcription entirely.
  const cached = await readTranscriptCache(url);
  if (cached) {
    return {
      ok: true,
      cacheHit: true,
      transcript: {
        text: cached.text,
        segments: cached.segments ?? [],
        source: cached.source,
        title,
        author,
        thumbnailUrl,
        description: page?.description ?? null,
        descriptionExtra: page?.extra ?? [],
        warnings: [],
      },
    };
  }

  const captionResult = await fetchYouTubeTranscript(videoId, title);
  if (
    captionResult &&
    captionResult.text.length >= MIN_USABLE_TRANSCRIPT_CHARS
  ) {
    const transcript: AcquiredTranscript = {
      text: captionResult.text,
      segments: captionResult.segments,
      source: {
        kind:
          captionResult.kind === "manual"
            ? "youtube-captions-manual"
            : "youtube-captions-asr",
        language: captionResult.language,
        charCount: captionResult.text.length,
      },
      title,
      author,
      thumbnailUrl,
      description: page?.description ?? null,
      descriptionExtra: page?.extra ?? [],
      warnings: [],
    };
    await writeTranscriptCache(url, "youtube", { ...transcript, segments: transcript.segments });
    return { ok: true, cacheHit: false, transcript };
  }

  // Captions missing or too thin — fall back to HLS audio + Whisper (verbose_json for timestamps).
  const audio = await fetchYouTubeAudioForTranscription(videoId);
  if (!audio.ok) {
    return {
      ok: false,
      status: audio.reason === "too-large" ? 413 : 422,
      error: "Couldn't create a transcript for this YouTube URL.",
      hint:
        audio.reason === "too-large"
          ? `${audio.message} Try a shorter video.`
          : `${audio.message} The video may be private, region-locked, or have audio extraction blocked.`,
    };
  }

  const transcription = await transcribeAudioBuffer(audio.file);
  if (!transcription || transcription.text.length < MIN_USABLE_TRANSCRIPT_CHARS) {
    return {
      ok: false,
      status: 422,
      error: "The transcript came back too thin to summarise.",
      hint:
        "The audio was downloaded and sent to OpenAI, but the resulting transcript was empty or under 300 characters. The video may have very little spoken content.",
    };
  }

  if (looksLikeWhisperHallucination(transcription.segments)) {
    return {
      ok: false,
      status: 422,
      error: "The audio doesn't contain enough clear speech to summarise.",
      hint:
        "Whisper detected the audio is dominated by music, silence, or repeated non-verbal sounds. There isn't enough spoken content to generate a reliable summary.",
    };
  }

  const transcript: AcquiredTranscript = {
    text: transcription.text,
    segments: transcription.segments,
    source: {
      kind: "youtube-whisper",
      language: transcription.language,
      charCount: transcription.text.length,
    },
    title,
    author,
    thumbnailUrl,
    description: page?.description ?? null,
    descriptionExtra: page?.extra ?? [],
    warnings: [
      `No usable captions — transcribed ${(audio.byteLength / 1024 / 1024).toFixed(1)} MB of HLS audio with ${transcription.model}.`,
    ],
  };
  await writeTranscriptCache(url, "youtube", { ...transcript, segments: transcript.segments });
  return { ok: true, cacheHit: false, transcript };
}

async function acquireTikTokTranscript(url: string): Promise<AcquireResult> {
  const cached = await readTranscriptCache(url);
  if (cached) {
    // We don't re-resolve metadata on cache hit — the cached transcript already
    // carries everything the summariser needs.
    return {
      ok: true,
      cacheHit: true,
      transcript: {
        text: cached.text,
        segments: cached.segments ?? [],
        source: cached.source,
        title: cached.title,
        author: cached.author,
        thumbnailUrl: cached.thumbnailUrl,
        description: cached.description,
        descriptionExtra: [],
        warnings: [],
      },
    };
  }

  const meta = await resolveTikTokMedia(url);
  if (!meta) {
    return {
      ok: false,
      status: 502,
      error: "Couldn't read this TikTok page.",
      hint:
        "TikTok blocked the request or its page layout changed. Try opening the share URL in your browser to confirm it loads, then retry.",
    };
  }

  if (meta.durationSec > 0 && meta.durationSec < TIKTOK_MIN_DURATION_SEC) {
    return {
      ok: false,
      status: 422,
      error: "This TikTok is too short to summarise.",
      hint: `Videos under ${TIKTOK_MIN_DURATION_SEC} seconds are almost always non-spoken meme clips. Try a longer TikTok.`,
    };
  }
  if (meta.durationSec > TIKTOK_MAX_DURATION_SEC) {
    return {
      ok: false,
      status: 413,
      error: "This TikTok is too long to summarise.",
      hint: `The clip is ${meta.durationSec}s — over the ${TIKTOK_MAX_DURATION_SEC}s cap to keep transcription cost predictable.`,
    };
  }

  const audio = await fetchTikTokAudioForTranscription(meta.mp4Url);
  if (!audio.ok) {
    return {
      ok: false,
      status: audio.reason === "too-large" ? 413 : 422,
      error: "Couldn't fetch the TikTok video for transcription.",
      hint: audio.message,
    };
  }

  const transcription = await transcribeAudioBuffer(audio.file);
  if (!transcription || transcription.text.length < MIN_USABLE_TRANSCRIPT_CHARS) {
    return {
      ok: false,
      status: 422,
      error: "The TikTok transcript came back too thin to summarise.",
      hint:
        meta.music
          ? `The audio is dominated by the track "${meta.music}" with little spoken content.`
          : "The video may be background music or non-verbal — there isn't enough spoken content to summarise.",
    };
  }

  if (looksLikeWhisperHallucination(transcription.segments)) {
    return {
      ok: false,
      status: 422,
      error: "The TikTok audio doesn't contain enough clear speech to summarise.",
      hint:
        meta.music
          ? `The audio is dominated by the track "${meta.music}" — Whisper detected insufficient spoken content.`
          : "Whisper detected the audio is dominated by music or non-verbal sounds.",
    };
  }

  const transcript: AcquiredTranscript = {
    text: transcription.text,
    segments: transcription.segments,
    source: {
      kind: "tiktok-whisper",
      language: transcription.language,
      charCount: transcription.text.length,
    },
    title: meta.title,
    author: meta.author,
    thumbnailUrl: meta.thumbnailUrl,
    description: meta.caption,
    descriptionExtra: meta.music ? [`Background track: ${meta.music}`] : [],
    warnings: [
      `Transcribed TikTok MP4 (${(audio.byteLength / 1024 / 1024).toFixed(1)} MB) with ${transcription.model}.`,
    ],
  };
  await writeTranscriptCache(url, "tiktok", { ...transcript, segments: transcript.segments });
  return { ok: true, cacheHit: false, transcript };
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const limited = enforceApiRateLimit(request, "video_summary");
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { url?: string };
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";

  const sseHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  if (!rawUrl) {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode(sseEvent("error", { error: "Paste a YouTube or TikTok URL to get started." })));
        ctrl.close();
      },
    });
    return new Response(stream, { status: 400, headers: sseHeaders });
  }

  const source = detectSource(rawUrl);
  if (!source) {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode(sseEvent("error", { error: "Unsupported URL.", hint: "Only YouTube and TikTok URLs are supported." })));
        ctrl.close();
      },
    });
    return new Response(stream, { status: 400, headers: sseHeaders });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key?.startsWith("sk-")) {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode(sseEvent("error", { error: "OpenAI API key is not configured on the server." })));
        ctrl.close();
      },
    });
    return new Response(stream, { status: 502, headers: sseHeaders });
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => {
        try { ctrl.enqueue(encoder.encode(sseEvent(event, data))); } catch { /* closed */ }
      };

      try {
        // --- Transcript acquisition (blocking, before streaming starts) ---
        const acquired =
          source === SOURCE_YOUTUBE
            ? await acquireYouTubeTranscript(rawUrl)
            : await acquireTikTokTranscript(rawUrl);

        if (!acquired.ok) {
          send("error", { error: acquired.error, hint: acquired.hint });
          ctrl.close();
          return;
        }

        const t = acquired.transcript;
        const TRANSCRIPT_CHAR_BUDGET = 110000;
        const transcriptContext = buildTranscriptContext(t.segments, t.text, TRANSCRIPT_CHAR_BUDGET);

        // Send video metadata immediately so the UI can show the thumbnail/title
        const warnings: string[] = [...t.warnings];
        if (acquired.cacheHit) {
          warnings.push("Transcript loaded from cache — no transcription cost incurred this run.");
        }
        if (transcriptContext.mode === "excerpted") {
          warnings.push(
            `Very long transcript — analysed ${transcriptContext.analyzedCharCount.toLocaleString()} of ${transcriptContext.inputCharCount.toLocaleString()} characters.`,
          );
        }

        send("meta", {
          source,
          videoUrl: rawUrl,
          title: t.title,
          author: t.author,
          thumbnailUrl: t.thumbnailUrl,
          language: t.source.language,
          hasTranscript: true,
          transcriptCharCount: t.text.length,
          transcriptSource: t.source,
          segments: t.segments.length > 0 ? t.segments : null,
          transcriptCoverage: {
            mode: transcriptContext.mode,
            inputCharCount: transcriptContext.inputCharCount,
            analyzedCharCount: transcriptContext.analyzedCharCount,
          },
          transcriptCacheHit: acquired.cacheHit,
          warnings,
          generatedAt: new Date().toISOString(),
        });

        // --- Two parallel AI calls ---
        const [structuredResult] = await Promise.all([
          generateStructuredSummary(transcriptContext, key),
          // Stream prose summary tokens concurrently
          (async () => {
            let summaryText = "";
            try {
              for await (const token of streamProseSummary(transcriptContext, key)) {
                summaryText += token;
                send("summary_chunk", token);
              }
            } catch {
              // partial summary is fine
            }
            return summaryText;
          })(),
        ]);

        if (!structuredResult) {
          send("error", {
            error: "Couldn't generate the structured summary.",
            hint: "The transcript was usable but the structured summarisation step failed.",
          });
          ctrl.close();
          return;
        }

        const { verified, droppedCount } = verifyCitations(
          structuredResult.data,
          t.text,
        );

        const finalWarnings = [...warnings];
        if (droppedCount > 0) {
          finalWarnings.push(
            `${droppedCount} key point${droppedCount > 1 ? "s" : ""} removed — the quote could not be verified in the transcript.`,
          );
        }

        const cost = structuredResult.usage
          ? computeCost(
              structuredResult.modelUsed,
              structuredResult.usage.prompt_tokens,
              structuredResult.usage.completion_tokens,
            )
          : null;

        send("structured", {
          chapters: verified.chapters,
          keyPoints: verified.keyPoints,
          importantCommands: verified.importantCommands,
          actionItems: verified.actionItems,
          warnings: finalWarnings,
          cost,
        });

        send("done", {});
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        try { ctrl.enqueue(encoder.encode(sseEvent("error", { error: "Server error while summarising video.", details: message }))); } catch { /* closed */ }
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(readable, { headers: sseHeaders });
}

