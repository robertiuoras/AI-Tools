import "server-only";
import type {
  BettingHeadToHeadGame,
  BettingLineupPlayer,
  BettingProviderPrediction,
  BettingRealDataPlayer,
  BettingWeather,
} from "@/lib/betting-bot";

/**
 * Per-sport provider registry.
 *
 * Each "data type" (injuries, h2h, lineups, weather, etc.) has a fallback
 * chain: try the league-specialised provider first, then SportsDB as a
 * universal fallback. ESPN is the existing path in lib/sports-data.ts and
 * is treated as the baseline — providers here augment / replace fields
 * when they have richer data, but the bot still works fine with only ESPN.
 *
 * All provider calls degrade silently: missing API key, rate-limit, or
 * timeout returns null/[] and the next chain entry runs.
 */

export interface ProviderTeamRef {
  /** Free-text team name from ESPN (we resolve to provider-specific id). */
  displayName: string;
  /** Optional shorter form. */
  shortName?: string | null;
  /** Optional ESPN id for cross-correlation in the cache key. */
  espnId?: string | null;
}

export interface ProviderInjuriesResult {
  source: string;
  players: BettingRealDataPlayer[];
}

export interface ProviderH2HResult {
  source: string;
  games: BettingHeadToHeadGame[];
}

export interface ProviderLineupResult {
  source: string;
  players: BettingLineupPlayer[];
}

export interface ProviderPredictionResult extends BettingProviderPrediction {}

export interface ProviderWeatherResult extends BettingWeather {}

/**
 * Sport categorisation used by the registry. Keep narrow — the registry
 * picks providers based on this, not on every ESPN sport path.
 */
export type SportFamily =
  | "soccer"
  | "nba"
  | "ncaab"
  | "nhl"
  | "euroleague"
  | "other";

const SOCCER_PATHS = new Set([
  "soccer/usa.1",
  "soccer/eng.1",
  "soccer/esp.1",
  "soccer/ita.1",
  "soccer/ger.1",
  "soccer/fra.1",
  "soccer/uefa.champions",
  "soccer/uefa.europa",
  "soccer/eng.fa",
]);

export function familyFromSportPath(sportPath: string): SportFamily {
  if (SOCCER_PATHS.has(sportPath)) return "soccer";
  if (sportPath === "basketball/nba" || sportPath === "basketball/wnba") {
    return "nba";
  }
  if (sportPath === "basketball/mens-college-basketball") return "ncaab";
  if (sportPath === "hockey/nhl") return "nhl";
  if (sportPath === "basketball/euroleague") return "euroleague";
  return "other";
}

export function isOutdoorSport(family: SportFamily): boolean {
  return family === "soccer";
}
