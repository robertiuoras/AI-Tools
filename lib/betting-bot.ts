/**
 * Shared constants + types for the AI Betting Bot project.
 * Lives outside /app/api/... so the page component can import without
 * dragging the server route into the client bundle.
 */

export const BETTING_SPORTS = [
  "NFL",
  "NBA",
  "MLB",
  "NHL",
  "NCAAF",
  "NCAAB",
  "MLS",
  "EPL",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Champions League",
  "UFC/MMA",
  "Boxing",
  "ATP Tennis",
  "WTA Tennis",
  "PGA Golf",
  "F1",
  "NASCAR",
  "Cricket",
  "Rugby",
  "CS2 / Esports",
  "LoL / Esports",
  "Dota 2 / Esports",
  "Other",
] as const;

export const BETTING_MARKETS = [
  "Moneyline",
  "Point spread",
  "Over/Under (totals)",
  "Player prop",
  "Team prop",
  "First half / first quarter",
  "Futures",
  "Parlay",
  "Live / in-play",
] as const;

/**
 * The 9 weighted metrics mirror the framework premium sports-betting
 * operations (Bet Labs, Unabated, TeamRankings) publish internally. Weights
 * sum to 100 and drive both the composite score and the radar chart.
 */
export const METRIC_FRAMEWORK: Array<{
  key: string;
  weight: number;
  description: string;
}> = [
  {
    key: "Recent form & momentum",
    weight: 12,
    description:
      "Last 5–10 games: straight-up wins, ATS record, scoring output, opponent quality adjustment.",
  },
  {
    key: "Injuries & lineup health",
    weight: 14,
    description:
      "Confirmed OUT / questionable players, rotation impact, starter minutes baseline.",
  },
  {
    key: "Head-to-head history",
    weight: 8,
    description:
      "Matchup trends over the last 2–3 seasons, including style / pace clashes and coach-vs-coach edges.",
  },
  {
    key: "Home/away & travel",
    weight: 8,
    description:
      "Splits, rest-day advantage, time-zone crossings, back-to-back fatigue, altitude.",
  },
  {
    key: "Power ratings & advanced metrics",
    weight: 16,
    description:
      "EPA/play, ORtg / DRtg, xG, Elo / PER, Massey / KenPom, projected margin vs the line.",
  },
  {
    key: "Line movement & sharp action",
    weight: 14,
    description:
      "Opening vs current line, reverse line movement, steam moves, books that move first, Pinnacle as consensus.",
  },
  {
    key: "Weather & venue",
    weight: 6,
    description:
      "Wind / precipitation for outdoor sports, dome effect, surface, ballpark / stadium factors, court speed.",
  },
  {
    key: "Motivation & situational",
    weight: 10,
    description:
      "Revenge spots, look-ahead, lame duck, playoff seeding locked, pride games, off-field distractions.",
  },
  {
    key: "Market efficiency & price value",
    weight: 12,
    description:
      "Is the offered price materially off the sharpest market (Pinnacle / Circa)? Closing-line value expectation.",
  },
];

export type BettingVerdict =
  | "strong_bet"
  | "bet"
  | "lean"
  | "pass"
  | "fade";

export interface BettingMetricScore {
  key: string;
  score: number;
  confidence: number;
  reasoning: string;
  direction: "for" | "against" | "neutral";
}

export interface BettingAnalysisResult {
  verdict: BettingVerdict;
  verdictLabel: string;
  verdictRationale: string;
  fairWinProbabilityPct: number;
  bookImpliedProbabilityPct: number;
  edgePct: number;
  kelly: {
    fullPct: number;
    halfPct: number;
    quarterPct: number;
    recommendedStakeUsd: number | null;
  };
  confidencePct: number;
  confidenceBin: "low" | "moderate" | "high" | "elite";
  compositeScore: number;
  metrics: BettingMetricScore[];
  summary: string;
  risks: string[];
  informationGaps: string[];
  generatedAt: string;
  cost: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
  } | null;
}

export interface BettingAnalysisPayload {
  sport: string;
  league?: string;
  event: string;
  pick: string;
  market: string;
  oddsAmerican: string | number;
  stakeBankroll?: string | number | null;
  notes?: string;
}

/* ── odds math (pure, used on both server and client) ─────────────────── */

export function americanToDecimal(n: number): number {
  return n >= 100 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}

export function americanToImpliedProb(n: number): number {
  const d = americanToDecimal(n);
  return (1 / d) * 100;
}

export function parseAmericanOdds(value: string | number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 0) return null;
    if (value > 0 && value < 100) return null;
    return value;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^\+/, "");
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0 && n < 100) return null;
  return n;
}
