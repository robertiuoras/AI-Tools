import { NextRequest, NextResponse } from "next/server";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";
import { readTranscriptCache, type TranscriptSegment } from "@/lib/video-transcript-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  url?: string;
  question?: string;
  history?: ChatMessage[];
}

interface ChatResponse {
  answer: string;
  cost: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
  } | null;
}

const PRICING = { input: 0.15, output: 0.6 };

export async function POST(request: NextRequest) {
  try {
    const limited = enforceApiRateLimit(request, "video_summary_chat");
    if (limited) return limited;

    const body = (await request.json().catch(() => ({}))) as ChatRequest;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];

    if (!url || !question) {
      return NextResponse.json(
        { error: "Both `url` and `question` are required." },
        { status: 400 },
      );
    }

    const cached = await readTranscriptCache(url);
    if (!cached) {
      return NextResponse.json(
        {
          error: "No transcript found for this video.",
          hint:
            "Re-run the summary first — chat needs the cached transcript to answer accurately.",
        },
        { status: 404 },
      );
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key?.startsWith("sk-")) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured." },
        { status: 500 },
      );
    }

    // Build timestamped transcript for grounding — same format as the main route
    const formatTs = (sec: number) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };
    const transcriptText =
      cached.segments && cached.segments.length > 0
        ? (cached.segments as TranscriptSegment[])
            .map((seg) => `[${formatTs(seg.startSec)}] ${seg.text}`)
            .join("\n")
            .slice(0, 80_000)
        : cached.text.slice(0, 80_000);

    const systemPrompt = [
      "You answer questions about a single video using ONLY the transcript below.",
      "If the answer isn't in the transcript, say so plainly — do not guess from the title or your general knowledge.",
      "Quote exact phrases from the transcript when they support the answer.",
      "When relevant, cite the timestamp in [mm:ss] format.",
      "Be concise: 1–4 sentences unless the question explicitly asks for a list.",
      "",
      "TRANSCRIPT:",
      transcriptText,
    ].join("\n");

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...history
        .filter(
          (m): m is ChatMessage =>
            !!m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string",
        )
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: question },
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.2,
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "OpenAI rejected the chat request." },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      model?: string;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!answer) {
      return NextResponse.json(
        { error: "OpenAI returned an empty answer." },
        { status: 502 },
      );
    }

    const usage = data.usage ?? null;
    if (usage) logOpenAIUsage(data.model ?? "gpt-4o-mini", "video_summary_chat", usage);

    const cost = usage
      ? {
          model: data.model ?? "gpt-4o-mini",
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          totalCostUsd:
            (usage.prompt_tokens / 1_000_000) * PRICING.input +
            (usage.completion_tokens / 1_000_000) * PRICING.output,
        }
      : null;

    const payload: ChatResponse = { answer, cost };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Server error during chat.", details: message },
      { status: 500 },
    );
  }
}
