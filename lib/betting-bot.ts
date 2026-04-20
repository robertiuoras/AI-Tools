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

/**
 * Markets the bot recognises. Since the bot now accepts a free-text query,
 * this list mostly serves the system prompt and anyone debugging — the model
 * itself normalises whatever the user wrote.
 */
export const BETTING_MARKETS = [
  "Moneyline",
  "Point spread / handicap",
  "Over/Under goals",
  "Over/Under points",
  "Over/Under corners",
  "Over/Under cards",
  "Both teams to score",
  "Asian handicap",
  "Draw no bet",
  "Double chance",
  "Correct score",
  "Anytime / first goalscorer",
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

export interface BettingFixture {
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffIso: string | null;
  venue: string | null;
}

/** Bundle of real, third-party-sourced context the UI renders alongside the
 *  analysis. `null` here means "we couldn't fetch — treat the analysis as
 *  qualitative". */
export interface BettingRealDataPlayer {
  name: string;
  position: string | null;
  status: string;
  detail: string;
  headshot: string | null;
}

export interface BettingRealDataTeam {
  id: string;
  displayName: string;
  abbreviation: string;
  logo: string | null;
  record: string | null;
  last10Streak: string;
  pointsForAvg: number | null;
  pointsAgainstAvg: number | null;
  wins10: number;
  losses10: number;
  /** Home wins + losses inside last-10 window, when determinable. */
  homeWins10: number;
  homeLosses10: number;
  awayWins10: number;
  awayLosses10: number;
  /** Days of rest between this team's last completed game and kickoff. */
  restDays: number | null;
  /** Straight-up margin trend (signed, positive = winning by). */
  marginAvg: number | null;
  injuries: BettingRealDataPlayer[];
  recentGames: Array<{
    date: string;
    opponentName: string;
    opponentAbbr: string;
    opponentLogo: string | null;
    homeAway: "home" | "away";
    teamScore: number | null;
    oppScore: number | null;
    result: "W" | "L" | "T" | null;
  }>;
  /** Generic sport-agnostic style stats (key/label/value). Filled when ESPN
   *  exposes team statistics for the sport (NBA/NFL/NHL/EPL all tend to). */
  style: Array<{ key: string; label: string; value: string }>;
}

/** A single head-to-head meeting. */
export interface BettingHeadToHeadGame {
  date: string;                   // ISO
  season: string | null;          // e.g. "2024-25" if ESPN provides it
  homeTeam: string;               // *this* matchup's home team (name)
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  winner: "home" | "away" | "tie" | null;
  venue: string | null;
}

/** One sportsbook's prices. All odds in DECIMAL format (1.91, 2.50, …). */
export interface BettingBookOdds {
  /** Canonical id, e.g. "ladbrokes_au", "neds", "tab", "espn-bet". */
  key: string;
  provider: string;               // pretty name: "Ladbrokes", "Neds", "TAB NZ"
  region: "au" | "nz" | "us" | "uk" | "eu" | "unknown";
  /** True when this book is Entain-family (Ladbrokes/Neds/Betcha/Coral/TAB NZ). */
  entainFamily: boolean;
  moneylineHome: number | null;   // decimal
  moneylineAway: number | null;   // decimal
  draw: number | null;            // decimal, for soccer-style 3-way markets
  spreadPoint: number | null;     // home handicap (negative = favored)
  spreadHomeOdds: number | null;
  spreadAwayOdds: number | null;
  total: number | null;
  overOdds: number | null;
  underOdds: number | null;
  lastUpdateIso: string | null;
}

export interface BettingRealData {
  source: "espn" | "none";
  sportLabel: string | null;
  homeTeam: BettingRealDataTeam | null;
  awayTeam: BettingRealDataTeam | null;
  /** Legacy single-book block from the scoreboard event (kept for backwards
   *  compat — prefer `books[]` going forward). */
  marketOdds: {
    provider: string | null;
    spread: number | null;
    overUnder: number | null;
    homeMoneyline: number | null;
    awayMoneyline: number | null;
  } | null;
  /** Multi-book board. First entries are Entain (Betcha-equivalent) when
   *  available; then ESPN pickcenter (US books) as a fallback/sanity check. */
  books: BettingBookOdds[];
  /** Last N head-to-head meetings, most-recent first. */
  headToHead: BettingHeadToHeadGame[];
}

export interface BettingAnalysisResult {
  fixture: BettingFixture | null;
  pickSummary: string;
  marketNormalized: string;
  oddsUsed: ParsedOdds | null;
  oddsSource: "user" | "estimated-market" | "unknown";
  verdict: BettingVerdict;
  verdictLabel: string;
  verdictRationale: string;
  fairWinProbabilityPct: number;
  bookImpliedProbabilityPct: number | null;
  edgePct: number | null;
  kelly: {
    fullPct: number;
    halfPct: number;
    quarterPct: number;
    recommendedStakeUsd: number | null;
  } | null;
  confidencePct: number;
  confidenceBin: "low" | "moderate" | "high" | "elite";
  compositeScore: number;
  metrics: BettingMetricScore[];
  summary: string;
  risks: string[];
  informationGaps: string[];
  /** Real third-party data used to ground the analysis. */
  realData: BettingRealData | null;
  /** Set when the user didn't supply odds and we couldn't resolve them from
   *  the fixture source. Edge/Kelly are null in this case. */
  oddsMissing: boolean;
  generatedAt: string;
  cost: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
  } | null;
}

/** Natural-language chat request payload sent from the page. */
export interface BettingChatPayload {
  /** Free-form query, e.g. "Arsenal over 2.5 goals vs Chelsea tomorrow". */
  query: string;
  /** Optional decimal or American odds the user wants to override with. */
  odds?: string | number | null;
  /** Optional research notes or specific context. */
  notes?: string | null;
  /** Optional bankroll (USD) to compute a dollar stake. */
  bankroll?: string | number | null;
  /** Client's IANA timezone (e.g. "Pacific/Auckland"). Used so "today" and
   *  "tomorrow" resolve to the user's local calendar day instead of the
   *  server's UTC day — the difference can be >24h across the dateline. */
  timezone?: string | null;
}

/* ── odds math (pure, used on both server and client) ─────────────────── */

export interface ParsedOdds {
  decimal: number;
  american: number;
  impliedPct: number;
  /** What the user typed: decimal (1.91) vs American (-110 / +180). */
  format: "decimal" | "american";
}

export function americanToDecimal(n: number): number {
  return n >= 100 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}

export function decimalToAmerican(d: number): number {
  if (!(d > 1)) return 0;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}

export function americanToImpliedProb(n: number): number {
  const d = americanToDecimal(n);
  return (1 / d) * 100;
}

/**
 * Accepts either American ("+180", "-110", -110, 180) or decimal ("1.91", 1.91, "2.50").
 * Returns a normalised object or null if the value is unreadable.
 *
 * Disambiguation rules:
 *   - An explicit leading "+" / "-" → American.
 *   - Absolute value ≥ 100 → American (no one types decimal 100.0).
 *   - Otherwise decimal, valid range [1.01, 99.99].
 */
export function parseOdds(
  value: string | number | null | undefined,
): ParsedOdds | null {
  if (value === null || value === undefined) return null;
  let str = typeof value === "number" ? String(value) : value.trim();
  if (!str) return null;

  const hasPlus = str.startsWith("+");
  const hasMinus = str.startsWith("-");
  if (hasPlus) str = str.slice(1);

  const n = Number(str);
  if (!Number.isFinite(n) || n === 0) return null;

  const americanSigned = hasMinus ? n : n;

  if (hasPlus || hasMinus || Math.abs(americanSigned) >= 100) {
    if (Math.abs(americanSigned) < 100) return null;
    const dec = americanToDecimal(americanSigned);
    return {
      decimal: Number(dec.toFixed(4)),
      american: americanSigned,
      impliedPct: (1 / dec) * 100,
      format: "american",
    };
  }

  if (n < 1.01 || n >= 100) return null;
  return {
    decimal: Number(n.toFixed(4)),
    american: decimalToAmerican(n),
    impliedPct: (1 / n) * 100,
    format: "decimal",
  };
}

/** Legacy helper – kept so older callers don't break. Returns the American
 *  representation of any odds-like input, or null. */
export function parseAmericanOdds(value: string | number): number | null {
  const o = parseOdds(value);
  return o ? o.american : null;
}

/* ── stream event shape (server → client SSE payloads) ─────────────────── */

/** Hidden fields the server sends alongside the final analysis so the
 *  "Track this bet" button can persist the ESPN identifiers needed for
 *  auto-settlement later. */
export interface BettingTrackContext {
  sportPath: string | null;
  espnEventId: string | null;
  espnHomeTeamId: string | null;
  espnAwayTeamId: string | null;
}

/* ── Tracked-bet types (shared between server and client) ──────────────── */

export type TrackedBetStatus =
  | "pending"
  | "won"
  | "lost"
  | "push"
  | "void"
  | "needs_review"
  | "cancelled";

export interface TrackedBetRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  query: string;
  pick_summary: string;
  market_normalized: string;
  sport_label: string | null;
  sport_path: string | null;
  espn_event_id: string | null;
  espn_home_team_id: string | null;
  espn_away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  kickoff: string | null;
  venue: string | null;
  odds_decimal: number | null;
  odds_american: number | null;
  stake_usd: number | null;
  fair_win_probability_pct: number;
  confidence_pct: number;
  confidence_bin: "low" | "moderate" | "high" | "elite";
  edge_pct: number | null;
  verdict: string;
  composite_score: number | null;
  status: TrackedBetStatus;
  settled_at: string | null;
  home_score: number | null;
  away_score: number | null;
  settlement_notes: string | null;
  profit_units: number | null;
  user_notes: string | null;
  snapshot: BettingAnalysisResult | null;
}

export interface CalibrationBucket {
  bin: "low" | "moderate" | "high" | "elite";
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  winRatePct: number | null;
  roiPct: number | null;
  avgConfidence: number | null;
}

export interface CalibrationSummary {
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  winRatePct: number | null;
  roiPct: number | null;
  profitUnits: number;
  brier: number | null;
  buckets: CalibrationBucket[];
  pending: number;
  needsReview: number;
}

export type BettingStreamEvent =
  | { type: "stage"; stage: string; label: string; status: "running" | "done" }
  | { type: "thought"; stage: string; text: string }
  | { type: "fixture"; fixture: BettingFixture }
  | {
      type: "final";
      result: BettingAnalysisResult;
      track: BettingTrackContext;
    }
  | { type: "error"; message: string }
  | { type: "done" };

/** Fixed stage ordering the server emits + the UI renders. */
export const BETTING_STAGES: Array<{ id: string; label: string }> = [
  { id: "parse", label: "Understanding your request" },
  { id: "fixture", label: "Identifying the fixture" },
  { id: "odds", label: "Pricing the market" },
  { id: "form", label: "Recent form & momentum" },
  { id: "injuries", label: "Injuries & lineups" },
  { id: "h2h", label: "Head-to-head" },
  { id: "tactics", label: "Tactical matchup" },
  { id: "market", label: "Market-specific trends" },
  { id: "value", label: "Line value vs fair price" },
  { id: "synthesis", label: "Final verdict" },
];
