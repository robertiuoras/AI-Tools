import { NextRequest, NextResponse } from "next/server";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { logOpenAIUsage } from "@/lib/openai-usage";
import {
  METRIC_FRAMEWORK,
  americanToDecimal,
  americanToImpliedProb,
  parseAmericanOdds,
  type BettingAnalysisPayload,
  type BettingAnalysisResult,
  type BettingMetricScore,
  type BettingVerdict,
} from "@/lib/betting-bot";

/**
 * AI Betting Bot
 * ----------------
 * Given a user's bet (sport, teams, market, odds, and optional context),
 * returns a structured, professional-grade analysis:
 *
 *   - verdict: "bet", "lean", "pass", or "fade"
 *   - confidence (0–100) with a calibrated bin
 *   - edge% (fair probability vs book implied probability)
 *   - Kelly stake recommendations
 *   - 9 weighted metrics scored 0–10 (the same framework pros publish in
 *     premium plays: form, injuries, line value, situational, etc.)
 *   - executive summary + per-metric reasoning + key risks + final verdict
 *
 * Honesty controls:
 *   - The model is explicitly forbidden from inventing numbers. If the user
 *     has not supplied data, it must say "insufficient data" inside the
 *     metric and cap the confidence at 55%.
 *   - We cap stated confidence at 80% — mirroring professional "locks"
 *     discipline where even the strongest models rarely exceed that.
 *   - We recompute edge% and Kelly on the server from the model's fair-prob
 *     so the UI cannot drift from the math the analysis is built on.
 *
 * The route returns `{ analysis, debug }`. 500s are only thrown for missing
 * API keys / total OpenAI failure — validation errors are 400 with a hint.
 */

const MODEL = "gpt-4o-mini";

type Verdict = BettingVerdict;
type MetricScore = BettingMetricScore;
type BettingAnalysisResponse = BettingAnalysisResult;
type BettingAnalysisRequest = BettingAnalysisPayload;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function confidenceBinFor(pct: number): BettingAnalysisResponse["confidenceBin"] {
  if (pct >= 72) return "elite";
  if (pct >= 60) return "high";
  if (pct >= 48) return "moderate";
  return "low";
}

function verdictLabelFor(v: Verdict): string {
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
  const k = (b * p - q) / b;
  return k;
}

function buildPrompt(req: BettingAnalysisRequest, priorEdgePct: number) {
  const rows = METRIC_FRAMEWORK.map(
    (m) => `- "${m.key}" (weight ${m.weight}/100): ${m.description}`,
  ).join("\n");

  return `You are an elite sports-betting analyst. You routinely outperform
professional capper consensus because you refuse to guess, you quantify
uncertainty, and you only claim an edge when the evidence is concrete.

TARGET AUDIENCE: serious recreational bettors, sharps, and DFS-adjacent users
who want transparent reasoning, not hype. Sound like a pro plays memo: concise,
measured, math-forward.

TONE: professional, confident but humble. No emojis, no "LOCK", no capslock,
no exclamation marks. Be blunt when a bet is bad. When data is missing, say so.

USER BET:
- Sport/league: ${req.sport}${req.league ? " — " + req.league : ""}
- Event: ${req.event}
- Market: ${req.market}
- Pick: ${req.pick}
- Odds (American): ${req.oddsAmerican}
- Book implied probability: ${americanToImpliedProb(
    parseAmericanOdds(req.oddsAmerican) ?? 0,
  ).toFixed(2)}%
- Initial prior edge vs book: ${priorEdgePct.toFixed(2)}%

USER-PROVIDED CONTEXT / RESEARCH:
${req.notes?.trim() || "(none — the user did not supply injury reports, splits, or model outputs)"}

ANALYSIS FRAMEWORK — score each of these nine metrics independently.
For each metric return:
  - score (0-10): how favourable it is for the pick (10 = maximum edge FOR, 5 = neutral, 0 = strongly against)
  - confidence (0-10): how much real data you actually have for this metric. If the user gave zero context and you don't have reliable public knowledge, use 1-3 and say "insufficient data".
  - direction: "for" | "against" | "neutral"
  - reasoning: ONE sentence, must reference a concrete fact (stat, player status, line move, trend). NEVER say "it looks good" without a number.

${rows}

STRICT RULES:
1. Never invent numeric stats. If you aren't sure a team's ATS record is 7-3 L10, don't claim it. Use qualitative language grounded in what you actually know, or say "insufficient data".
2. Your fair win probability MUST be internally consistent with your metric scores and must be a number between 1 and 99.
3. Confidence (0-100) reflects BOTH the edge size and the data quality. Cap it at 80. If more than 4 metrics have confidence <= 3, cap it at 55.
4. Verdict decision rules:
   - edge >= +4% AND confidence >= 65 AND <=2 metrics "against"  → "strong_bet"
   - edge >= +2% AND confidence >= 55                             → "bet"
   - edge >= +1% AND confidence >= 45                             → "lean"
   - edge between -1% and +1% OR confidence < 45                  → "pass"
   - edge <= -2% with high-confidence negative metrics            → "fade"
5. Summary must be 2-4 short paragraphs. First paragraph = the thesis. Second paragraph = the main risks. Third paragraph (optional) = market / price context. Last paragraph (optional) = the stake recommendation.
6. risks MUST be 3-5 short, distinct items. Each one is a concrete scenario that would make this bet lose.
7. informationGaps MUST list 3-5 concrete things the user could still research (e.g. "check injury report at 90 min before tipoff", "verify starting goalie", "read weekend practice notes").

Return ONLY valid JSON in EXACTLY this shape:
{
  "fairWinProbabilityPct": number (1-99),
  "confidencePct": number (0-80),
  "verdict": "strong_bet" | "bet" | "lean" | "pass" | "fade",
  "verdictRationale": "one-sentence why",
  "summary": "2-4 paragraphs, \\n\\n separated",
  "risks": ["...", "..."],
  "informationGaps": ["...", "..."],
  "metrics": [
    { "key": "Recent form & momentum", "score": 0-10, "confidence": 0-10, "direction": "for|against|neutral", "reasoning": "..." },
    ...exactly 9 entries in the same order as the framework above
  ]
}`;
}

function normaliseMetrics(raw: unknown): MetricScore[] {
  const byKey = new Map<string, MetricScore>();
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const key = typeof o.key === "string" ? o.key.trim() : "";
      if (!key) continue;
      const score = clamp(Number(o.score ?? 0), 0, 10);
      const confidence = clamp(Number(o.confidence ?? 0), 0, 10);
      const direction = ((): MetricScore["direction"] => {
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

  // Emit metrics in the fixed framework order so the UI can lay them out
  // deterministically. Any metric the model omitted becomes a placeholder at
  // 5/0 ("neutral / no data").
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

function computeComposite(metrics: MetricScore[]): number {
  let total = 0;
  let weightSum = 0;
  for (const m of metrics) {
    const frame = METRIC_FRAMEWORK.find((f) => f.key === m.key);
    const w = frame?.weight ?? 5;
    // Weight the metric by both its framework importance and the data
    // confidence the model reported. A metric with confidence 0 contributes
    // half of its framework weight (keeps neutrals from dominating) but its
    // score is pinned to 5 (neutral).
    const effectiveWeight = w * (0.5 + m.confidence / 20); // 0.5w – 1.0w
    const effectiveScore = m.confidence === 0 ? 5 : m.score;
    total += effectiveScore * effectiveWeight;
    weightSum += effectiveWeight;
  }
  if (weightSum === 0) return 50;
  // score is 0–10; scale to 0–100.
  return clamp((total / weightSum) * 10, 0, 100);
}

function normaliseVerdict(v: unknown): Verdict {
  const s = String(v ?? "").toLowerCase();
  if (s === "strong_bet" || s === "strong bet" || s === "strongbet") return "strong_bet";
  if (s === "bet") return "bet";
  if (s === "lean") return "lean";
  if (s === "fade") return "fade";
  return "pass";
}

const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function costFor(
  usage:
    | { prompt_tokens?: number; completion_tokens?: number }
    | undefined,
): BettingAnalysisResponse["cost"] {
  if (!usage) return null;
  const p = MODEL_PRICING_PER_MTOK[MODEL] ?? { input: 0.5, output: 1.5 };
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const totalCostUsd =
    (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return {
    model: MODEL,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    totalCostUsd,
  };
}

export async function POST(request: NextRequest) {
  const limited = enforceApiRateLimit(request, "ai_betting_bot");
  if (limited) return limited;

  const apiKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: BettingAnalysisRequest;
  try {
    body = (await request.json()) as BettingAnalysisRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sport = String(body.sport ?? "").trim();
  const event = String(body.event ?? "").trim();
  const pick = String(body.pick ?? "").trim();
  const market = String(body.market ?? "").trim();
  const oddsInput = body.oddsAmerican;

  if (!sport || !event || !pick || !market) {
    return NextResponse.json(
      {
        error: "Missing required fields.",
        hint: "Provide sport, event, pick, market, and oddsAmerican.",
      },
      { status: 400 },
    );
  }

  const american = parseAmericanOdds(oddsInput);
  if (american === null) {
    return NextResponse.json(
      {
        error: "Invalid American odds.",
        hint: "Use values like -110 or +180. 0 and values between ±1 and ±99 are not valid.",
      },
      { status: 400 },
    );
  }

  const decimal = americanToDecimal(american);
  const bookImpliedProbabilityPct = (1 / decimal) * 100;

  // Give the prompt a zero-info prior so the model knows whether the listed
  // price is even in the ballpark of "fair".
  const priorEdgePct = 0;

  const prompt = buildPrompt(
    { ...body, sport, event, pick, market, oddsAmerican: american },
    priorEdgePct,
  );

  let usedUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let content: Record<string, unknown>;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a professional sports-betting analyst. Always return valid JSON. Never invent specific stats; when you do not know a number, say 'insufficient data'. Cap your claimed confidence at 80/100.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.25,
        response_format: { type: "json_object" },
        max_tokens: 1600,
      }),
      signal: AbortSignal.timeout(40_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        {
          error: "OpenAI request failed.",
          status: res.status,
          details: text.slice(0, 2000),
        },
        { status: res.status },
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    usedUsage = data.usage;
    if (data.usage && data.model) {
      logOpenAIUsage(data.model, "ai_betting_bot", {
        prompt_tokens: data.usage.prompt_tokens ?? 0,
        completion_tokens: data.usage.completion_tokens ?? 0,
        total_tokens:
          (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0),
      });
    }

    const raw = data.choices?.[0]?.message?.content ?? "";
    try {
      content = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "The model returned non-JSON output. Try again." },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: "OpenAI call failed.",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  const metrics = normaliseMetrics(content.metrics);
  const compositeScore = computeComposite(metrics);

  const modelFairPct = clamp(
    Number((content as { fairWinProbabilityPct?: number }).fairWinProbabilityPct ?? 0),
    1,
    99,
  );
  const edgePct = modelFairPct - bookImpliedProbabilityPct;

  const fullKelly = kellyFraction(modelFairPct / 100, decimal);
  const halfKelly = fullKelly * 0.5;
  const quarterKelly = fullKelly * 0.25;

  const bankroll =
    body.stakeBankroll === null ||
    body.stakeBankroll === undefined ||
    body.stakeBankroll === ""
      ? null
      : Number(body.stakeBankroll);
  const recommendedStakeUsd =
    bankroll !== null && Number.isFinite(bankroll) && bankroll > 0
      ? Math.max(0, halfKelly * bankroll)
      : null;

  const rawConfidence = clamp(
    Number((content as { confidencePct?: number }).confidencePct ?? 0),
    0,
    80,
  );
  // Secondary cap: when the user gave no notes AND the model claims high
  // confidence, back it off so we aren't selling false precision.
  const hasUserNotes = !!(body.notes && body.notes.trim().length >= 40);
  const confidencePct = hasUserNotes
    ? rawConfidence
    : Math.min(rawConfidence, 60);

  const verdict = normaliseVerdict(content.verdict);

  const response: BettingAnalysisResponse = {
    verdict,
    verdictLabel: verdictLabelFor(verdict),
    verdictRationale:
      typeof content.verdictRationale === "string"
        ? content.verdictRationale
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
      typeof content.summary === "string" && content.summary.trim()
        ? content.summary.trim()
        : "No narrative summary returned.",
    risks: Array.isArray(content.risks)
      ? content.risks
          .map((r) => (typeof r === "string" ? r.trim() : ""))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    informationGaps: Array.isArray(content.informationGaps)
      ? content.informationGaps
          .map((r) => (typeof r === "string" ? r.trim() : ""))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    generatedAt: new Date().toISOString(),
    cost: costFor(usedUsage),
  };

  return NextResponse.json(response);
}
