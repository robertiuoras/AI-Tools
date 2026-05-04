import "server-only";

/**
 * League-average priors for sample-size shrinkage.
 *
 * Why: when a team has only 3 completed games in your data window, their
 * raw PPG/GPG is incredibly noisy — a 35-point blowout can shift it 5
 * points. Empirical Bayes pulls those small samples toward the league
 * mean. With 30 games of data the prior barely moves the value; with
 * 3 games it dominates.
 *
 * Formula: shrunk = (raw * games + leagueMean * priorStrength) / (games + priorStrength)
 *
 * The priors below are the long-run season averages for each league.
 * Bookmakers use roughly the same numbers — they're public.
 */

export interface ScoringPrior {
  /** League-average points / goals scored per team per match. */
  perMatchFor: number;
  /** League-average points / goals conceded per team per match (= perMatchFor for symmetric leagues). */
  perMatchAgainst: number;
  /** Effective "prior games" — how many phantom matches at the league mean
   *  to add. Higher = stronger pull toward the prior. ~8-10 is typical. */
  priorStrength: number;
}

const PRIORS: Record<string, ScoringPrior> = {
  // Soccer ~ 1.4 goals per team per match in top-5 leagues.
  "soccer/eng.1": { perMatchFor: 1.45, perMatchAgainst: 1.45, priorStrength: 8 },
  "soccer/esp.1": { perMatchFor: 1.30, perMatchAgainst: 1.30, priorStrength: 8 },
  "soccer/ita.1": { perMatchFor: 1.40, perMatchAgainst: 1.40, priorStrength: 8 },
  "soccer/ger.1": { perMatchFor: 1.55, perMatchAgainst: 1.55, priorStrength: 8 },
  "soccer/fra.1": { perMatchFor: 1.40, perMatchAgainst: 1.40, priorStrength: 8 },
  "soccer/usa.1": { perMatchFor: 1.40, perMatchAgainst: 1.40, priorStrength: 8 },
  "soccer/uefa.champions": { perMatchFor: 1.45, perMatchAgainst: 1.45, priorStrength: 6 },
  "soccer/uefa.europa": { perMatchFor: 1.50, perMatchAgainst: 1.50, priorStrength: 6 },
  "soccer/eng.fa": { perMatchFor: 1.55, perMatchAgainst: 1.55, priorStrength: 6 },

  // Basketball
  "basketball/nba": { perMatchFor: 113, perMatchAgainst: 113, priorStrength: 6 },
  "basketball/wnba": { perMatchFor: 82, perMatchAgainst: 82, priorStrength: 6 },
  "basketball/mens-college-basketball": {
    perMatchFor: 73,
    perMatchAgainst: 73,
    priorStrength: 8,
  },
  "basketball/euroleague": { perMatchFor: 80, perMatchAgainst: 80, priorStrength: 6 },

  // Football
  "football/nfl": { perMatchFor: 22, perMatchAgainst: 22, priorStrength: 6 },
  "football/college-football": {
    perMatchFor: 28,
    perMatchAgainst: 28,
    priorStrength: 6,
  },

  // Hockey
  "hockey/nhl": { perMatchFor: 3.1, perMatchAgainst: 3.1, priorStrength: 8 },

  // Baseball
  "baseball/mlb": { perMatchFor: 4.5, perMatchAgainst: 4.5, priorStrength: 10 },
};

const DEFAULT_PRIOR: ScoringPrior = {
  perMatchFor: 0,
  perMatchAgainst: 0,
  priorStrength: 6,
};

export function priorForSport(sportPath: string): ScoringPrior {
  return PRIORS[sportPath] ?? DEFAULT_PRIOR;
}

/**
 * Empirical-Bayes shrinkage. `prior=0` disables shrinkage; this is what
 * we do for sports without a known league mean (returns the raw value).
 */
export function shrunkAvg(
  raw: number | null,
  games: number,
  prior: { mean: number; strength: number },
): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  if (games <= 0) return raw;
  if (prior.strength <= 0 || prior.mean <= 0) return raw;
  const shrunk =
    (raw * games + prior.mean * prior.strength) / (games + prior.strength);
  return Number(shrunk.toFixed(2));
}
