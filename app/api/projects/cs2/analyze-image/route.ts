import { NextRequest, NextResponse } from "next/server";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";

/**
 * CS2 skin / listing screenshot analyser.
 *
 * Takes a screenshot of a CSFloat / Steam Market listing (or just the skin)
 * and asks gpt-4o-mini to extract a structured assessment:
 *   - skin name + condition + float (best-effort from text in the image)
 *   - observed price + price-history trend (if a graph is visible)
 *   - "good buy" verdict (1–5 ranking) + reasoning
 *
 * The model is told to be conservative — if a field isn't visible, return null
 * rather than hallucinate a number.
 */

interface AnalyzeResponse {
  skin: {
    name: string | null;
    wear: string | null;
    float: number | null;
    pattern: number | null;
    stickers: string[];
  };
  listing: {
    askPriceUsd: number | null;
    medianPriceUsd: number | null;
    trend: "up" | "down" | "flat" | "volatile" | null;
    trendNotes: string | null;
  };
  verdict: {
    rating: number; // 1 (avoid) – 5 (strong buy)
    label: "Avoid" | "Risky" | "Fair" | "Good" | "Great";
    rationale: string;
    redFlags: string[];
    greenFlags: string[];
  };
  cost: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  } | null;
}

const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6 },
};

function computeCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): AnalyzeResponse["cost"] {
  const base = model.toLowerCase();
  const key = Object.keys(PRICE_PER_MTOK).find((k) => base.startsWith(k));
  const rates = key ? PRICE_PER_MTOK[key]! : { input: 0.15, output: 0.6 };
  return {
    model,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalCostUsd:
      (promptTokens / 1_000_000) * rates.input +
      (completionTokens / 1_000_000) * rates.output,
  };
}

function ratingLabel(r: number): AnalyzeResponse["verdict"]["label"] {
  if (r <= 1) return "Avoid";
  if (r === 2) return "Risky";
  if (r === 3) return "Fair";
  if (r === 4) return "Good";
  return "Great";
}

export async function POST(request: NextRequest) {
  try {
    const limited = enforceApiRateLimit(request, "cs2_image");
    if (limited) return limited;
    const key = process.env.OPENAI_API_KEY;
    if (!key?.startsWith("sk-")) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured on the server." },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      imageBase64?: string;
      mimeType?: string;
      hint?: string;
    };
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
    const mimeType = (body.mimeType ?? "image/png").toString();
    if (!imageBase64) {
      return NextResponse.json(
        { error: "Provide imageBase64 (data-URL payload, no data: prefix)." },
        { status: 400 },
      );
    }
    const cleanedB64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    if (cleanedB64.length > 6_500_000) {
      return NextResponse.json(
        { error: "Image too large (max ~5MB after base64)." },
        { status: 413 },
      );
    }
    const dataUrl = `data:${mimeType};base64,${cleanedB64}`;

    const systemPrompt = [
      "You are a CS2 skin trading analyst.",
      "Given a screenshot of a CSFloat or Steam Market listing (or just a skin inspect view), extract structured data and rate the buy.",
      "Be CONSERVATIVE: if a value isn't clearly visible, return null. Never hallucinate float values, prices, or sticker names.",
      "Respond with a single JSON object, no markdown.",
      "Schema:",
      "{",
      '  "skin": { "name": string|null, "wear": string|null, "float": number|null, "pattern": number|null, "stickers": string[] },',
      '  "listing": { "askPriceUsd": number|null, "medianPriceUsd": number|null, "trend": "up"|"down"|"flat"|"volatile"|null, "trendNotes": string|null },',
      '  "verdict": { "rating": 1|2|3|4|5, "rationale": string, "redFlags": string[], "greenFlags": string[] }',
      "}",
      "Rating rubric (1–5):",
      "  1 Avoid: clearly overpriced vs trend, ugly float for the wear, bad stickers.",
      "  2 Risky: above median or downward trend.",
      "  3 Fair: at median, flat trend.",
      "  4 Good: below median, low float, neutral stickers, flat/up trend.",
      "  5 Great: well below median, low float for wear, valuable stickers, upward trend.",
    ].join("\n");

    const userPrompt = body.hint?.toString().slice(0, 600) ||
      "Analyse this CS2 listing screenshot.";

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
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 800,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `OpenAI vision call failed (${res.status})`, details: text.slice(0, 400) },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      model?: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      choices?: Array<{ message?: { content?: string } }>;
    };
    const model = data.model ?? "gpt-4o-mini";
    const usage = data.usage ?? null;
    if (usage) logOpenAIUsage(model, "cs2_image", usage);
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      return NextResponse.json(
        { error: "Empty response from model." },
        { status: 502 },
      );
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Model returned invalid JSON.", raw: raw.slice(0, 400) },
        { status: 502 },
      );
    }

    const skin = (parsed.skin ?? {}) as Record<string, unknown>;
    const listing = (parsed.listing ?? {}) as Record<string, unknown>;
    const verdict = (parsed.verdict ?? {}) as Record<string, unknown>;
    const stickersArr = Array.isArray(skin.stickers) ? skin.stickers.map(String) : [];
    const redFlags = Array.isArray(verdict.redFlags) ? verdict.redFlags.map(String) : [];
    const greenFlags = Array.isArray(verdict.greenFlags) ? verdict.greenFlags.map(String) : [];
    const ratingRaw = Number(verdict.rating);
    const rating = Number.isFinite(ratingRaw)
      ? Math.min(5, Math.max(1, Math.round(ratingRaw)))
      : 3;

    const payload: AnalyzeResponse = {
      skin: {
        name: typeof skin.name === "string" ? skin.name : null,
        wear: typeof skin.wear === "string" ? skin.wear : null,
        float: typeof skin.float === "number" ? skin.float : null,
        pattern: typeof skin.pattern === "number" ? skin.pattern : null,
        stickers: stickersArr,
      },
      listing: {
        askPriceUsd: typeof listing.askPriceUsd === "number" ? listing.askPriceUsd : null,
        medianPriceUsd: typeof listing.medianPriceUsd === "number" ? listing.medianPriceUsd : null,
        trend: ["up", "down", "flat", "volatile"].includes(String(listing.trend))
          ? (listing.trend as AnalyzeResponse["listing"]["trend"])
          : null,
        trendNotes: typeof listing.trendNotes === "string" ? listing.trendNotes : null,
      },
      verdict: {
        rating,
        label: ratingLabel(rating),
        rationale:
          typeof verdict.rationale === "string"
            ? verdict.rationale
            : "No rationale provided.",
        redFlags,
        greenFlags,
      },
      cost: usage ? computeCost(model, usage.prompt_tokens, usage.completion_tokens) : null,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Server error while analysing image.", details: message },
      { status: 500 },
    );
  }
}
