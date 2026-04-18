import { NextRequest, NextResponse } from "next/server";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";
import {
  PROMPT_CATEGORIES,
  PROMPT_TYPES,
  isPromptCategory,
  isPromptType,
  type PromptCategory,
  type PromptType,
} from "@/lib/prompt-data";

/**
 * POST /api/prompts/analyze
 * --------------------------
 * Body: { body: string }
 *
 * Returns:
 *   {
 *     title: string,        // short, scannable name
 *     summary: string,      // one sentence: what this prompt does
 *     category: PromptCategory,
 *     type: PromptType,
 *     tags: string[],       // 2–5 short tags
 *     cost: { ... }         // OpenAI usage / USD cost for the call
 *   }
 *
 * Designed for the paste-only "save a prompt" flow: the user drops their
 * prompt into a box, we classify it, and they confirm/save.
 */

interface AnalyzeResponse {
  title: string;
  summary: string;
  category: PromptCategory;
  type: PromptType;
  tags: string[];
  cost: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
  } | null;
}

const MODEL = "gpt-4o-mini";
// gpt-4o-mini pricing per 1M tokens
const RATE_INPUT = 0.15;
const RATE_OUTPUT = 0.6;

function fallbackTitle(body: string): string {
  const firstLine = body.trim().split("\n")[0] ?? "";
  const trimmed = firstLine.replace(/^#+\s*/, "").trim();
  if (trimmed.length === 0) return "Untitled prompt";
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

function pickCategory(s: string): PromptCategory {
  return isPromptCategory(s) ? s : "Productivity";
}

function pickType(s: string): PromptType {
  return isPromptType(s) ? s : "Other";
}

export async function POST(request: NextRequest) {
  try {
    const limited = enforceApiRateLimit(request, "prompts_analyze");
    if (limited) return limited;

    const body = (await request.json().catch(() => ({}))) as { body?: string };
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json(
        { error: "Paste a prompt before analysing." },
        { status: 400 },
      );
    }

    // Hard cap input so a giant paste can't blow the token budget.
    const TRIMMED = text.length > 12000 ? text.slice(0, 12000) : text;

    const key = process.env.OPENAI_API_KEY;
    if (!key?.startsWith("sk-")) {
      // Graceful degrade: still return a sensible response so users
      // without OpenAI keys can use the UI as a plain saver.
      const fallback: AnalyzeResponse = {
        title: fallbackTitle(TRIMMED),
        summary: "",
        category: "Productivity",
        type: "Other",
        tags: [],
        cost: null,
      };
      return NextResponse.json(fallback);
    }

    const systemPrompt = [
      "You classify AI prompts for a personal prompt library.",
      "Return ONLY a JSON object — no markdown, no preamble.",
      "Schema:",
      '  "title": string         // 3–7 words, descriptive, Title Case, no trailing punctuation',
      '  "summary": string       // ONE sentence (max ~140 chars) describing what the prompt does',
      `  "category": one of [${PROMPT_CATEGORIES.map((c) => `"${c}"`).join(", ")}]`,
      `  "type": one of [${PROMPT_TYPES.map((t) => `"${t}"`).join(", ")}]`,
      '  "tags": string[]        // 2–5 short lower-case tags (1–3 words each), specific to the prompt',
      "Rules:",
      "- 'category' is the topical domain (Coding, Marketing, Writing…).",
      "- 'type' is the prompt's intent / shape (Agent, Research, Planning, Automation, Analysis, Brainstorm, Roleplay, Coding, Writing, Other).",
      "- Pick the SINGLE best category and type — never multiple.",
      "- Tags should add information beyond category/type (tools, frameworks, techniques, audience).",
      "- Be honest: if the prompt is generic, the tags should be generic.",
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Classify this prompt:\n\n"""\n${TRIMMED}\n"""` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 280,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      // Same graceful degrade — never block the user from saving.
      const fallback: AnalyzeResponse = {
        title: fallbackTitle(TRIMMED),
        summary: "",
        category: "Productivity",
        type: "Other",
        tags: [],
        cost: null,
      };
      return NextResponse.json(fallback);
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

    const modelUsed = data.model ?? MODEL;
    if (data.usage) logOpenAIUsage(modelUsed, "prompts_analyze", data.usage);

    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ""));
    } catch {
      parsed = null;
    }

    const title =
      typeof parsed?.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim().slice(0, 80)
        : fallbackTitle(TRIMMED);

    const summary =
      typeof parsed?.summary === "string"
        ? parsed.summary.trim().slice(0, 200)
        : "";

    const category = pickCategory(
      typeof parsed?.category === "string" ? parsed.category : "",
    );
    const type = pickType(typeof parsed?.type === "string" ? parsed.type : "");

    const tags = Array.isArray(parsed?.tags)
      ? (parsed!.tags as unknown[])
          .map((t) => String(t).trim().toLowerCase())
          .filter((t) => t.length > 0 && t.length <= 30)
          .slice(0, 5)
      : [];

    const cost = data.usage
      ? {
          model: modelUsed,
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          totalCostUsd:
            (data.usage.prompt_tokens / 1_000_000) * RATE_INPUT +
            (data.usage.completion_tokens / 1_000_000) * RATE_OUTPUT,
        }
      : null;

    const payload: AnalyzeResponse = {
      title,
      summary,
      category,
      type,
      tags,
      cost,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Server error while analysing prompt.", details: message },
      { status: 500 },
    );
  }
}
