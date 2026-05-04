import "server-only";
import type {
  BettingLineupPlayer,
  BettingRealDataPlayer,
} from "@/lib/betting-bot";

/**
 * Per-player impact ratings.
 *
 * The current bot says "3 players OUT" — but losing a starting GK is
 * not the same as losing the third-string winger. Pro models weight
 * each missing player by their typical contribution to team strength.
 *
 * Position-based defaults (no per-name database) — a star vs squad
 * player gap of ~30% is the usual error vs full Opta-style ratings,
 * but it's the right shape and consistent across leagues. Star-player
 * overrides can be added later by writing into a `player_impact` table
 * (the engine reads name → rating lookup if present, otherwise falls
 * back to position).
 *
 * Output is a fraction-of-team-strength: 0.10 means "removing this
 * player drops team strength by 10%". Aggregate across missing players
 * is a soft sum (capped at 0.35 — at some point you're playing kids).
 */

const POSITION_IMPACT: Record<string, number> = {
  // Soccer (G shared with hockey goaltender — same value)
  G: 0.12,
  GK: 0.12,
  GOALKEEPER: 0.12,
  CB: 0.06,
  LB: 0.04,
  RB: 0.07, // running back (NFL) — soccer right-back is ~0.04 but RB is mostly NFL anyway
  LWB: 0.04,
  RWB: 0.04,
  D: 0.05, // soccer or hockey defender
  DEFENDER: 0.05,
  DM: 0.07,
  CM: 0.06,
  AM: 0.08,
  M: 0.06,
  MIDFIELDER: 0.06,
  LW: 0.07,
  RW: 0.07,
  ST: 0.10,
  CF: 0.10,
  F: 0.08, // soccer or hockey forward
  FORWARD: 0.08,
  ATTACKER: 0.08,
  // Basketball
  PG: 0.13,
  SG: 0.10,
  SF: 0.10,
  PF: 0.09,
  C: 0.10, // basketball center (NHL center handled by C_HOCKEY only when explicit)
  // NFL
  QB: 0.20,
  FB: 0.03,
  WR: 0.07,
  TE: 0.05,
  OL: 0.04,
  OT: 0.05,
  OG: 0.04,
  DL: 0.05,
  DE: 0.06,
  DT: 0.05,
  EDGE: 0.07,
  LBK: 0.05,
  OLB: 0.05,
  ILB: 0.04,
  MLB: 0.05,
  S: 0.05,
  SS: 0.05,
  FS: 0.05,
  DB: 0.05,
  K: 0.02,
  P: 0.01,
  LS: 0.005,
  // Baseball
  SP: 0.18,
  RP: 0.04,
  "1B": 0.04,
  "2B": 0.04,
  "3B": 0.05,
  LF: 0.04,
  RF: 0.04,
  DH: 0.04,
};

const DEFAULT_IMPACT = 0.04;

/** Status strings that should count as "missing" (no impact if questionable). */
const OUT_STATUSES = new Set([
  "out",
  "doubtful",
  "ir",
  "injured reserve",
  "suspended",
  "ineligible",
  "missing",
]);

/** Status strings that mark a player as questionable / probable. Counted at
 *  half weight since it's uncertain whether they'll play. */
const QUESTIONABLE_STATUSES = new Set([
  "questionable",
  "doubt",
  "doubtful?",
  "game-time decision",
  "gtd",
  "probable",
  "day-to-day",
  "d2d",
]);

function statusMultiplier(status: string): number {
  const s = (status ?? "").toLowerCase().trim();
  if (OUT_STATUSES.has(s)) return 1;
  // Some providers use long descriptive strings; substring match too.
  for (const key of OUT_STATUSES) if (s.includes(key)) return 1;
  if (QUESTIONABLE_STATUSES.has(s)) return 0.5;
  for (const key of QUESTIONABLE_STATUSES) if (s.includes(key)) return 0.5;
  return 0;
}

export function impactForPosition(position: string | null): number {
  if (!position) return DEFAULT_IMPACT;
  const key = position.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return POSITION_IMPACT[key] ?? DEFAULT_IMPACT;
}

export interface MissingPlayerImpact {
  name: string;
  position: string | null;
  status: string;
  impact: number;
}

export interface TeamImpactSummary {
  /** Aggregate fraction of team strength removed by missing players, capped. */
  totalImpact: number;
  /** Sorted list (highest impact first) used for the prompt's per-player bullet. */
  breakdown: MissingPlayerImpact[];
}

/**
 * Compute aggregated player-impact for one team.
 *
 * Rules:
 *   - Only players in `injuries` with an OUT-equivalent status count fully.
 *   - Questionable / probable count at half weight.
 *   - If `lineup` is provided AND a starter we expected (e.g. xi history)
 *     isn't in it, that's also a hit — but provider lineups arrive close
 *     to kickoff so this is best-effort, not authoritative.
 *   - Total is capped at 0.35 (35% of team strength) — beyond that the
 *     team is essentially fielding a different side and the linear model
 *     stops working.
 */
export function teamImpactSummary(
  injuries: BettingRealDataPlayer[],
  _lineup: BettingLineupPlayer[],
): TeamImpactSummary {
  const breakdown: MissingPlayerImpact[] = [];
  for (const inj of injuries) {
    const mult = statusMultiplier(inj.status);
    if (mult === 0) continue;
    const base = impactForPosition(inj.position);
    const impact = Number((base * mult).toFixed(3));
    if (impact <= 0) continue;
    breakdown.push({
      name: inj.name,
      position: inj.position,
      status: inj.status,
      impact,
    });
  }
  breakdown.sort((a, b) => b.impact - a.impact);
  const raw = breakdown.reduce((acc, p) => acc + p.impact, 0);
  return {
    totalImpact: Math.min(0.35, Number(raw.toFixed(3))),
    breakdown,
  };
}
