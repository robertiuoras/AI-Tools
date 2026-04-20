import { NextRequest, NextResponse } from "next/server";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";
import {
  METRIC_FRAMEWORK,
  BETTING_STAGES,
  parseOdds,
  type BettingAnalysisResult,
  type BettingChatPayload,
  type BettingFixture,
  type BettingMetricScore,
  type BettingStreamEvent,
  type BettingVerdict,
  type ParsedOdds,
} from "@/lib/betting-bot";

/**
 * AI Betting Bot — streaming endpoint
 * -----------------------------------
 * The client posts a natural-language query ("Arsenal over 2.5 goals
 * tomorrow", "LeBron under 24.5 points vs Denver Friday"). We stream the
 * analysis back as SSE so the UI can render a live "AI thinking" log.
 *
 * Flow:
 *   1. Rate limit + input check.
 *   2. Call OpenAI in streaming mode with a structured tag protocol:
 *        STAGE:: <id>
 *        THINK:: <one-sentence research note>
 *      We parse tokens as they arrive and emit per-stage SSE events.
 *   3. The model also emits FIXTURE:: <json> once it resolves teams/date.
 *   4. After the streaming call completes, we run a short non-streaming
 *      json_object call to produce the final structured verdict from the
 *      research transcript. This 2-call design keeps the thinking fluid
 *      while guaranteeing the final payload is valid JSON.
 *   5. Server recomputes edge/Kelly from the odds (provided or estimated)
 *      so the UI never drifts from the math.
 */

const MODEL_STREAM = "gpt-4o-mini";
const MODEL_STRUCT = "gpt-4o-mini";

const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function confidenceBinFor(
  pct: number,
): BettingAnalysisResult["confidenceBin"] {
  if (pct >= 72) return "elite";
  if (pct >= 60) return "high";
  if (pct >= 48) return "moderate";
  return "low";
}

function verdictLabelFor(v: BettingVerdict): string {
  switch (v) {
    case "strong_bet":
      return "Strong bet";
    case "bet":
      return "Bet";
    case "lean":
      return "Lean";
    case "pass":
      return "Pass";
    case "fade":
      return "Fade (other side)";
  }
}

function kellyFraction(fairProb: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const p = clamp(fairProb, 0, 1);
  const q = 1 - p;
  return (b * p - q) / b;
}

function normaliseVerdict(v: unknown): BettingVerdict {
  const s = String(v ?? "").toLowerCase().replace(/[^a-z_]/g, "");
  if (s === "strongbet" || s === "strong_bet") return "strong_bet";
  if (s === "bet") return "bet";
  if (s === "lean") return "lean";
  if (s === "fade") return "fade";
  return "pass";
}

function normaliseMetrics(raw: unknown): BettingMetricScore[] {
  const byKey = new Map<string, BettingMetricScore>();
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const key = typeof o.key === "string" ? o.key.trim() : "";
      if (!key) continue;
      const score = clamp(Number(o.score ?? 0), 0, 10);
      const confidence = clamp(Number(o.confidence ?? 0), 0, 10);
      const direction = ((): BettingMetricScore["direction"] => {
        const d = String(o.direction ?? "").toLowerCase();
        if (d === "for" || d === "against" || d === "neutral") return d;
        if (score >= 6) return "for";
        if (score <= 4) return "against";
        return "neutral";
      })();
      byKey.set(key.toLowerCase(), {
        key,
        score,
        confidence,
        direction,
        reasoning:
          typeof o.reasoning === "string" && o.reasoning.trim()
            ? o.reasoning.trim()
            : "insufficient data",
      });
    }
  }
  return METRIC_FRAMEWORK.map((m) => {
    const hit = byKey.get(m.key.toLowerCase());
    if (hit) return { ...hit, key: m.key };
    return {
      key: m.key,
      score: 5,
      confidence: 0,
      direction: "neutral",
      reasoning: "insufficient data",
    };
  });
}

function computeComposite(metrics: BettingMetricScore[]): number {
  let total = 0;
  let weightSum = 0;
  for (const m of metrics) {
    const frame = METRIC_FRAMEWORK.find((f) => f.key === m.key);
    const w = frame?.weight ?? 5;
    const effectiveWeight = w * (0.5 + m.confidence / 20);
    const effectiveScore = m.confidence === 0 ? 5 : m.score;
    total += effectiveScore * effectiveWeight;
    weightSum += effectiveWeight;
  }
  if (weightSum === 0) return 50;
  return clamp((total / weightSum) * 10, 0, 100);
}

function costFor(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): BettingAnalysisResult["cost"] {
  if (!usage) return null;
  const p = MODEL_PRICING_PER_MTOK[model] ?? { input: 0.5, output: 1.5 };
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const totalCostUsd =
    (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    totalCostUsd,
  };
}

/* ── prompts ──────────────────────────────────────────────────────────── */

function buildResearchPrompt(
  query: string,
  userOdds: ParsedOdds | null,
  notes: string,
): string {
  const stageList = BETTING_STAGES.map((s) => `  - ${s.id}: ${s.label}`).join(
    "\n",
  );

  const oddsLine = userOdds
    ? `User-supplied odds: ${userOdds.decimal.toFixed(2)} decimal (${
        userOdds.american > 0 ? "+" : ""
      }${userOdds.american} American) → book implied ${userOdds.impliedPct.toFixed(
        2,
      )}%.`
    : "User did NOT supply odds. Estimate the likely market price (assume Betcha.co.nz NZ sportsbook pricing, which tracks Pinnacle/mainstream markets within ~2% juice) and flag that the user should verify the exact price at betcha.co.nz before placing.";

  return `You are an elite AI sports-betting analyst. The user is describing a bet
conversationally. Your job is to (a) identify the fixture, (b) research
the bet using your sports knowledge, and (c) think out loud in a
structured stream the UI can render live.

STRICT OUTPUT PROTOCOL — EVERY LINE MUST FOLLOW ONE OF THESE SHAPES:

  STAGE:: <stage-id>
  THINK:: <one-sentence research note, concrete and quantitative when possible>
  FIXTURE:: {"homeTeam":"...","awayTeam":"...","competition":"...","kickoffIso":"YYYY-MM-DDTHH:MM:SSZ or null","venue":"... or null"}

No other output. No bullet points, no markdown, no greetings, no JSON other
than the single FIXTURE:: line. Every THINK:: must be one sentence.

STAGES (emit STAGE:: before the first THINK:: of that section, and only use
these IDs, in this order — skip a stage only if it is genuinely irrelevant):
${stageList}

Rules for THINK:: lines:
  - Cite concrete data when you know it: xG, goals per match, last-5 record,
    injury names, referee card averages, H2H splits, home/away totals, etc.
  - When you don't know a number, say "recent form suggests…" or similar —
    NEVER invent a specific stat you aren't confident about.
  - Keep each line short (<= 30 words). Emit 2–4 THINK:: lines per stage.
  - For "odds" stage, reference the pricing information below.

PRICING CONTEXT:
${oddsLine}
The user prefers Betcha.co.nz (New Zealand sportsbook). If you reference a
market price, treat it as indicative — the user will verify on betcha.co.nz.

RESEARCH NOTES FROM USER:
${notes.trim() || "(none — user relied on you to do the research)"}

USER QUERY:
"${query.replace(/"/g, '\\"')}"

Emit FIXTURE:: as soon as you have resolved the teams/date, ideally during
the "fixture" stage. After the last stage (synthesis), stop — do not emit a
summary. The next call will produce the structured final report.`;
}

function buildStructuredPrompt(
  query: string,
  transcript: string,
  fixture: BettingFixture | null,
  parsedOdds: ParsedOdds | null,
  notes: string,
): string {
  const rows = METRIC_FRAMEWORK.map(
    (m) => `- "${m.key}" (weight ${m.weight}/100): ${m.description}`,
  ).join("\n");

  const oddsContext = parsedOdds
    ? `User provided odds: ${parsedOdds.decimal.toFixed(2)} decimal (${
        parsedOdds.american > 0 ? "+" : ""
      }${parsedOdds.american} American). Use this as the book price. Do NOT invent a different one.`
    : `User did NOT provide odds. Estimate a realistic market price (Betcha.co.nz-style, ~2% juice). Put your estimated decimal price in "oddsDecimal" and set "oddsSource" = "estimated-market".`;

  return `You wrote the research transcript below while analysing a sports bet.
Now produce the final structured verdict as STRICT JSON.

USER QUERY:
"${query.replace(/"/g, '\\"')}"

USER RESEARCH NOTES:
${notes.trim() || "(none)"}

FIXTURE (already resolved):
${fixture ? JSON.stringify(fixture) : "(not confidently resolved — do your best from the transcript)"}

PRICING CONTEXT:
${oddsContext}

RESEARCH TRANSCRIPT:
${transcript.slice(0, 6000)}

METRIC FRAMEWORK — score each on 0–10 (10 = maximum edge FOR the pick,
5 = neutral, 0 = strongly against). Also score data confidence 0–10 per
metric (how much real data you actually have for it).

${rows}

RULES:
1. Never invent specific stats. If the transcript didn't surface a number,
   say "qualitative read" or "insufficient data" in the reasoning and use
   a confidence ≤ 3 for that metric.
2. fairWinProbabilityPct must be 1–99 and must be internally consistent
   with the 9 metric scores.
3. confidencePct is 0–80 (cap at 80). If > 4 metrics have confidence ≤ 3,
   cap confidencePct at 55.
4. Verdict rules:
   - edge ≥ +4% AND confidence ≥ 65 AND ≤ 2 against-metrics  → "strong_bet"
   - edge ≥ +2% AND confidence ≥ 55                           → "bet"
   - edge ≥ +1% AND confidence ≥ 45                           → "lean"
   - edge between −1% and +1% OR confidence < 45              → "pass"
   - edge ≤ −2% with high-confidence against metrics          → "fade"
5. summary: 2–4 paragraphs separated by \\n\\n. First paragraph = the thesis.
   Second = main risks. Third (optional) = market / price context. Fourth
   (optional) = stake framing.
6. risks: 3–5 distinct scenarios that would make this bet lose.
7. informationGaps: 3–5 concrete things the user should still check
   (e.g. "confirm starter at goal 90 min pre-match", "team news Friday morning").

Return ONLY valid JSON in EXACTLY this shape:
{
  "pickSummary": "... one sentence describing the resolved pick ...",
  "marketNormalized": "Over 2.5 goals | Moneyline | Over 9.5 corners | ...",
  "oddsDecimal": <number or null>,
  "oddsSource": "user" | "estimated-market" | "unknown",
  "fairWinProbabilityPct": <number 1-99>,
  "confidencePct": <number 0-80>,
  "verdict": "strong_bet" | "bet" | "lean" | "pass" | "fade",
  "verdictRationale": "one sentence",
  "summary": "2-4 paragraphs separated by \\n\\n",
  "risks": ["...", "..."],
  "informationGaps": ["...", "..."],
  "metrics": [
    { "key": "Recent form & momentum", "score": 0-10, "confidence": 0-10, "direction": "for|against|neutral", "reasoning": "..." }
    // ...exactly 9 entries in framework order
  ]
}`;
}

/* ── streaming helpers ────────────────────────────────────────────────── */

function encodeSse(obj: BettingStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

/**
 * Parses an OpenAI streaming chat response into token deltas.
 * OpenAI sends `data: {...}` lines; we yield each `choices[0].delta.content`.
 */
async function* openAiTokenStream(
  res: Response,
): AsyncGenerator<string, { usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string }> {
  if (!res.body) return {};
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let lastModel: string | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return { usage: lastUsage, model: lastModel };
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            model?: string;
          };
          if (parsed.model) lastModel = parsed.model;
          if (parsed.usage) lastUsage = parsed.usage;
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) yield chunk;
        } catch {
          /* ignore malformed chunks */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { usage: lastUsage, model: lastModel };
}

/* ── route handler ────────────────────────────────────────────────────── */

export async function POST(request: NextRequest) {
  const limited = enforceApiRateLimit(request, "ai_betting_bot");
  if (limited) return limited;

  const apiKey =
    process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: BettingChatPayload;
  try {
    body = (await request.json()) as BettingChatPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = String(body.query ?? "").trim();
  if (query.length < 3) {
    return NextResponse.json(
      {
        error: "Please describe the bet in plain English.",
        hint: "e.g. 'Arsenal over 2.5 goals vs Chelsea tomorrow'.",
      },
      { status: 400 },
    );
  }
  const notes = String(body.notes ?? "").trim();
  const parsedOdds = body.odds != null && String(body.odds).trim() !== ""
    ? parseOdds(body.odds)
    : null;

  const bankroll =
    body.bankroll === null ||
    body.bankroll === undefined ||
    body.bankroll === ""
      ? null
      : Number(body.bankroll);

  const researchPrompt = buildResearchPrompt(query, parsedOdds, notes);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: BettingStreamEvent) => controller.enqueue(encodeSse(ev));

      // Emit initial stage so the UI gets something immediately.
      send({
        type: "stage",
        stage: "parse",
        label: BETTING_STAGES[0]!.label,
        status: "running",
      });

      let transcript = "";
      let currentStage = "parse";
      let fixture: BettingFixture | null = null;
      let streamUsage:
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined;
      let streamModel: string | undefined;

      // ── Call A: streaming research ────────────────────────────────
      try {
        const res = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: MODEL_STREAM,
              stream: true,
              stream_options: { include_usage: true },
              temperature: 0.4,
              max_tokens: 1400,
              messages: [
                {
                  role: "system",
                  content:
                    "You are a professional sports-betting analyst. You emit research transcripts in the STAGE::/THINK::/FIXTURE:: protocol only. Never add markdown, bullets, or commentary outside the protocol.",
                },
                { role: "user", content: researchPrompt },
              ],
            }),
            signal: AbortSignal.timeout(60_000),
          },
        );

        if (!res.ok) {
          const text = await res.text();
          send({
            type: "error",
            message: `OpenAI stream failed (${res.status}): ${text.slice(0, 300)}`,
          });
          controller.close();
          return;
        }

        let pending = "";
        const gen = openAiTokenStream(res);
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            const meta = value as
              | { usage?: typeof streamUsage; model?: string }
              | undefined;
            if (meta?.usage) streamUsage = meta.usage;
            if (meta?.model) streamModel = meta.model;
            break;
          }
          transcript += value;
          pending += value;
          let nl: number;
          while ((nl = pending.indexOf("\n")) !== -1) {
            const rawLine = pending.slice(0, nl);
            pending = pending.slice(nl + 1);
            handleProtocolLine(rawLine);
          }
        }
        // Flush trailing buffered line (rare — streams usually terminate with \n).
        if (pending.trim()) handleProtocolLine(pending);

        // Mark the last live stage as done.
        send({
          type: "stage",
          stage: currentStage,
          label:
            BETTING_STAGES.find((s) => s.id === currentStage)?.label ??
            currentStage,
          status: "done",
        });

        function handleProtocolLine(raw: string) {
          const line = raw.trim();
          if (!line) return;

          if (line.startsWith("STAGE::")) {
            const next = line.slice("STAGE::".length).trim().toLowerCase();
            if (!next || next === currentStage) return;
            // Close previous stage.
            send({
              type: "stage",
              stage: currentStage,
              label:
                BETTING_STAGES.find((s) => s.id === currentStage)?.label ??
                currentStage,
              status: "done",
            });
            currentStage = next;
            send({
              type: "stage",
              stage: next,
              label:
                BETTING_STAGES.find((s) => s.id === next)?.label ??
                next.charAt(0).toUpperCase() + next.slice(1),
              status: "running",
            });
            return;
          }

          if (line.startsWith("THINK::")) {
            const text = line.slice("THINK::".length).trim();
            if (text) send({ type: "thought", stage: currentStage, text });
            return;
          }

          if (line.startsWith("FIXTURE::")) {
            const jsonPart = line.slice("FIXTURE::".length).trim();
            try {
              const raw = JSON.parse(jsonPart) as Partial<BettingFixture>;
              fixture = {
                homeTeam: String(raw.homeTeam ?? "").trim(),
                awayTeam: String(raw.awayTeam ?? "").trim(),
                competition: String(raw.competition ?? "").trim(),
                kickoffIso:
                  typeof raw.kickoffIso === "string" && raw.kickoffIso.trim()
                    ? raw.kickoffIso.trim()
                    : null,
                venue:
                  typeof raw.venue === "string" && raw.venue.trim()
                    ? raw.venue.trim()
                    : null,
              };
              if (fixture.homeTeam && fixture.awayTeam) {
                send({ type: "fixture", fixture });
              }
            } catch {
              /* ignore malformed FIXTURE line */
            }
            return;
          }
          // Otherwise: free-form token noise (e.g. a stray period); ignore.
        }
      } catch (e) {
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
        controller.close();
        return;
      }

      // Log token usage from Call A.
      if (streamUsage && streamModel) {
        logOpenAIUsage(streamModel, "ai_betting_bot_research", {
          prompt_tokens: streamUsage.prompt_tokens ?? 0,
          completion_tokens: streamUsage.completion_tokens ?? 0,
          total_tokens:
            (streamUsage.prompt_tokens ?? 0) +
            (streamUsage.completion_tokens ?? 0),
        });
      }

      // ── Call B: structured final ──────────────────────────────────
      send({
        type: "stage",
        stage: "synthesis",
        label: "Scoring and finalising",
        status: "running",
      });

      const structuredPrompt = buildStructuredPrompt(
        query,
        transcript,
        fixture,
        parsedOdds,
        notes,
      );

      let finalContent: Record<string, unknown>;
      let structUsage:
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined;

      try {
        const res = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: MODEL_STRUCT,
              temperature: 0.2,
              response_format: { type: "json_object" },
              max_tokens: 1600,
              messages: [
                {
                  role: "system",
                  content:
                    "You are a professional sports-betting analyst. Always return valid JSON. Never invent specific numeric stats; when unsure, say 'insufficient data' and drop confidence. Cap claimed confidence at 80/100.",
                },
                { role: "user", content: structuredPrompt },
              ],
            }),
            signal: AbortSignal.timeout(40_000),
          },
        );
        if (!res.ok) {
          const text = await res.text();
          send({
            type: "error",
            message: `Structured call failed (${res.status}): ${text.slice(0, 300)}`,
          });
          controller.close();
          return;
        }
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          model?: string;
        };
        structUsage = data.usage;
        if (data.usage && data.model) {
          logOpenAIUsage(data.model, "ai_betting_bot_structured", {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens:
              (data.usage.prompt_tokens ?? 0) +
              (data.usage.completion_tokens ?? 0),
          });
        }
        const raw = data.choices?.[0]?.message?.content ?? "{}";
        finalContent = JSON.parse(raw) as Record<string, unknown>;
      } catch (e) {
        send({
          type: "error",
          message:
            "Could not structure the final report: " +
            (e instanceof Error ? e.message : String(e)),
        });
        controller.close();
        return;
      }

      // ── Server-side math ──────────────────────────────────────────
      const metrics = normaliseMetrics(finalContent.metrics);
      const compositeScore = computeComposite(metrics);
      const modelFairPct = clamp(
        Number(
          (finalContent as { fairWinProbabilityPct?: number })
            .fairWinProbabilityPct ?? 50,
        ),
        1,
        99,
      );

      let oddsUsed: ParsedOdds | null = parsedOdds;
      let oddsSource: BettingAnalysisResult["oddsSource"] = parsedOdds
        ? "user"
        : "unknown";

      if (!oddsUsed) {
        const modelOdds = (finalContent as { oddsDecimal?: number }).oddsDecimal;
        if (typeof modelOdds === "number" && modelOdds > 1.01) {
          oddsUsed = parseOdds(modelOdds);
          oddsSource = "estimated-market";
        }
        const declaredSource = String(
          (finalContent as { oddsSource?: string }).oddsSource ?? "",
        ).toLowerCase();
        if (declaredSource === "estimated-market") oddsSource = "estimated-market";
      }

      const bookImpliedProbabilityPct = oddsUsed ? oddsUsed.impliedPct : 50;
      const decimal = oddsUsed ? oddsUsed.decimal : 2;
      const edgePct = modelFairPct - bookImpliedProbabilityPct;

      const fullKelly = kellyFraction(modelFairPct / 100, decimal);
      const halfKelly = fullKelly * 0.5;
      const quarterKelly = fullKelly * 0.25;

      const recommendedStakeUsd =
        bankroll !== null && Number.isFinite(bankroll) && bankroll > 0
          ? Math.max(0, halfKelly * bankroll)
          : null;

      const rawConfidence = clamp(
        Number(
          (finalContent as { confidencePct?: number }).confidencePct ?? 0,
        ),
        0,
        80,
      );
      const hasUserNotes = notes.length >= 40;
      const confidencePct = hasUserNotes
        ? rawConfidence
        : Math.min(rawConfidence, 65);

      const verdict = normaliseVerdict(finalContent.verdict);

      const result: BettingAnalysisResult = {
        fixture,
        pickSummary:
          typeof finalContent.pickSummary === "string"
            ? finalContent.pickSummary.trim()
            : query,
        marketNormalized:
          typeof finalContent.marketNormalized === "string"
            ? finalContent.marketNormalized.trim()
            : "Unspecified market",
        oddsUsed,
        oddsSource,
        verdict,
        verdictLabel: verdictLabelFor(verdict),
        verdictRationale:
          typeof finalContent.verdictRationale === "string"
            ? finalContent.verdictRationale
            : "",
        fairWinProbabilityPct: Number(modelFairPct.toFixed(2)),
        bookImpliedProbabilityPct: Number(bookImpliedProbabilityPct.toFixed(2)),
        edgePct: Number(edgePct.toFixed(2)),
        kelly: {
          fullPct: Number((fullKelly * 100).toFixed(2)),
          halfPct: Number((halfKelly * 100).toFixed(2)),
          quarterPct: Number((quarterKelly * 100).toFixed(2)),
          recommendedStakeUsd:
            recommendedStakeUsd === null
              ? null
              : Number(recommendedStakeUsd.toFixed(2)),
        },
        confidencePct: Number(confidencePct.toFixed(1)),
        confidenceBin: confidenceBinFor(confidencePct),
        compositeScore: Number(compositeScore.toFixed(1)),
        metrics,
        summary:
          typeof finalContent.summary === "string" &&
          finalContent.summary.trim()
            ? finalContent.summary.trim()
            : "No narrative summary returned.",
        risks: Array.isArray(finalContent.risks)
          ? finalContent.risks
              .map((r: unknown) => (typeof r === "string" ? r.trim() : ""))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        informationGaps: Array.isArray(finalContent.informationGaps)
          ? finalContent.informationGaps
              .map((r: unknown) => (typeof r === "string" ? r.trim() : ""))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        generatedAt: new Date().toISOString(),
        cost: costFor(MODEL_STRUCT, combineUsage(streamUsage, structUsage)),
      };

      send({
        type: "stage",
        stage: "synthesis",
        label: "Scoring and finalising",
        status: "done",
      });
      send({ type: "final", result });
      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function combineUsage(
  a: { prompt_tokens?: number; completion_tokens?: number } | undefined,
  b: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): { prompt_tokens?: number; completion_tokens?: number } | undefined {
  if (!a && !b) return undefined;
  return {
    prompt_tokens: (a?.prompt_tokens ?? 0) + (b?.prompt_tokens ?? 0),
    completion_tokens:
      (a?.completion_tokens ?? 0) + (b?.completion_tokens ?? 0),
  };
}
