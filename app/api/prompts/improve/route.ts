import { NextRequest, NextResponse } from "next/server";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";
import { PROMPT_TYPES, isPromptType, type PromptType } from "@/lib/prompt-data";

/**
 * POST /api/prompts/improve
 * --------------------------
 * Body: { body: string, type?: PromptType, model?: "basic" | "thinking" }
 *
 * Returns:
 *   {
 *     improved: string,        // the rewritten, structured prompt
 *     notes: string[],         // optional bullet-list of what changed/why
 *     type: PromptType,
 *     cost: { ... } | null
 *   }
 *
 * "Turn lazy prompts into great ones" — takes a vague paste and rewrites it
 * with role, context, output spec, and constraints.
 */

interface ImproveResponse {
  improved: string;
  notes: string[];
  type: PromptType;
  cost: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
  } | null;
}

const MODEL_BASIC = "gpt-4o-mini";
// Pricing per 1M tokens (gpt-4o-mini)
const RATE_INPUT = 0.15;
const RATE_OUTPUT = 0.6;

function pickType(s: string): PromptType {
  return isPromptType(s) ? s : "Other";
}

export async function POST(request: NextRequest) {
  try {
    const limited = enforceApiRateLimit(request, "prompts_improve");
    if (limited) return limited;

    const body = (await request.json().catch(() => ({}))) as {
      body?: string;
      type?: string;
    };
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json(
        { error: "Paste a prompt before improving it." },
        { status: 400 },
      );
    }
    const wantedType = pickType(typeof body.type === "string" ? body.type : "");

    const TRIMMED = text.length > 12000 ? text.slice(0, 12000) : text;

    const key = process.env.OPENAI_API_KEY;
    if (!key?.startsWith("sk-")) {
      return NextResponse.json(
        {
          error:
            "AI improvement is unavailable: OPENAI_API_KEY is not configured on the server.",
        },
        { status: 503 },
      );
    }

    const systemPrompt = [
      "You are a senior prompt engineer.",
      "The user will paste a 'lazy' prompt. Rewrite it into a high-quality, structured prompt that any modern AI model (ChatGPT, Claude, Gemini) can follow precisely.",
      "Return ONLY a JSON object — no markdown, no preamble.",
      "Schema:",
      '  "improved": string  // the rewritten prompt, ready to paste into an AI tool',
      '  "notes": string[]   // 2–4 short bullets describing what you improved (e.g. "Added concrete output format", "Specified target audience")',
      "Rules for the improved prompt:",
      `- Tailor the structure to the requested intent type: "${wantedType}".`,
      "- Include a clear ROLE for the AI (1 line).",
      "- State the GOAL in one sentence.",
      "- Include CONTEXT placeholders in [BRACKETS] for things the user must fill in (audience, tone, constraints, examples).",
      "- Specify the OUTPUT FORMAT explicitly (sections, bullets, JSON, length, etc.).",
      "- Add CONSTRAINTS / quality bar where useful.",
      "- Keep it concise (no fluff). Use markdown headings only when they aid scanning.",
      "- Never invent specifics the user didn't provide — leave [PLACEHOLDERS] instead.",
      "- Do not wrap the prompt in code fences in the output.",
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL_BASIC,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Improve this lazy prompt (intent: ${wantedType}):\n\n"""\n${TRIMMED}\n"""`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 900,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error: "OpenAI request failed.",
          status: res.status,
          details: errText.slice(0, 500),
        },
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

    const modelUsed = data.model ?? MODEL_BASIC;
    if (data.usage) logOpenAIUsage(modelUsed, "prompts_improve", data.usage);

    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ""));
    } catch {
      parsed = null;
    }

    const improved =
      typeof parsed?.improved === "string" && parsed.improved.trim().length > 0
        ? parsed.improved.trim()
        : "";
    if (!improved) {
      return NextResponse.json(
        { error: "AI returned no usable result. Please try again." },
        { status: 502 },
      );
    }

    const notes = Array.isArray(parsed?.notes)
      ? (parsed!.notes as unknown[])
          .map((t) => String(t).trim())
          .filter((t) => t.length > 0 && t.length <= 240)
          .slice(0, 6)
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

    const payload: ImproveResponse = {
      improved,
      notes,
      type: wantedType,
      cost,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Server error while improving prompt.", details: message },
      { status: 500 },
    );
  }
}
