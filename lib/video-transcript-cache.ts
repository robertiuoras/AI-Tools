import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

export type TranscriptKind =
  | "youtube-captions-manual"
  | "youtube-captions-asr"
  | "youtube-whisper"
  | "tiktok-whisper";

export interface TranscriptSource {
  kind: TranscriptKind;
  language: string | null;
  charCount: number;
}

export interface CachedTranscript {
  text: string;
  source: TranscriptSource;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  description: string | null;
}

export interface CacheWriteInput {
  text: string;
  source: TranscriptSource;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  description: string | null;
}

const MIN_USABLE = 300;

export function hashVideoUrl(url: string): string {
  let normalized = url.trim();
  try {
    const u = new URL(url);
    [
      "feature",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "si",
      "pp",
    ].forEach((p) => u.searchParams.delete(p));
    u.hash = "";
    normalized = u.toString();
  } catch {
    // keep original
  }
  return createHash("sha256").update(normalized).digest("hex");
}

export async function readTranscriptCache(
  url: string,
): Promise<CachedTranscript | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("video_transcripts")
      .select(
        "transcript, transcript_source, title, author, thumbnail_url, description",
      )
      .eq("url_hash", hashVideoUrl(url))
      .maybeSingle();
    if (error || !data) return null;
    const record = data as {
      transcript: unknown;
      transcript_source: unknown;
      title: unknown;
      author: unknown;
      thumbnail_url: unknown;
      description: unknown;
    };
    if (
      typeof record.transcript !== "string" ||
      record.transcript.length < MIN_USABLE
    ) {
      return null;
    }
    const src = record.transcript_source as Partial<TranscriptSource> | null;
    if (!src || typeof src.kind !== "string") return null;
    return {
      text: record.transcript,
      source: {
        kind: src.kind as TranscriptKind,
        language: typeof src.language === "string" ? src.language : null,
        charCount:
          typeof src.charCount === "number"
            ? src.charCount
            : record.transcript.length,
      },
      title: typeof record.title === "string" ? record.title : null,
      author: typeof record.author === "string" ? record.author : null,
      thumbnailUrl:
        typeof record.thumbnail_url === "string" ? record.thumbnail_url : null,
      description:
        typeof record.description === "string" ? record.description : null,
    };
  } catch {
    return null;
  }
}

export async function writeTranscriptCache(
  url: string,
  sourceKind: "youtube" | "tiktok",
  input: CacheWriteInput,
): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await supabaseAdmin.from("video_transcripts").upsert(
      {
        url_hash: hashVideoUrl(url),
        url,
        source: sourceKind,
        transcript: input.text,
        transcript_source: input.source,
        title: input.title,
        author: input.author,
        thumbnail_url: input.thumbnailUrl,
        description: input.description,
      } as never,
      { onConflict: "url_hash" },
    );
  } catch {
    // silent — cache is best-effort
  }
}
