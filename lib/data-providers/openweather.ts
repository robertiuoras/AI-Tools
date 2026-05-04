import "server-only";
import type { BettingWeather } from "@/lib/betting-bot";
import { cached, SPORTS_CACHE_TTL } from "@/lib/sports-cache";
import { sportsdbTeamVenue } from "@/lib/data-providers/sportsdb";

/**
 * OpenWeather One Call (free tier, 1k requests/day). Used only for
 * outdoor sports (soccer); indoor sports skip this entirely.
 *
 * No API key set → returns null and the bot just operates without a
 * weather block (matches existing behaviour).
 */

interface OwResponse {
  main?: { temp?: number };
  wind?: { speed?: number };
  weather?: Array<{ description?: string; main?: string }>;
  rain?: { "1h"?: number };
}

interface OwGeocodeResponse {
  lat?: number;
  lon?: number;
}

async function get<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function openWeatherForVenue(
  homeTeamName: string,
  kickoffIso: string | null,
): Promise<BettingWeather | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;
  if (!homeTeamName) return null;

  // Use SportsDB to resolve the team's stadium location, then geocode it.
  const venue = await sportsdbTeamVenue(homeTeamName);
  if (!venue?.location && !venue?.country) return null;
  const query = [venue.location, venue.country].filter(Boolean).join(", ");

  return cached(
    `openweather:${query}:${(kickoffIso ?? "").slice(0, 10)}`,
    SPORTS_CACHE_TTL.weather,
    async () => {
      const geo = await get<OwGeocodeResponse[]>(
        `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=1&appid=${apiKey}`,
      );
      const lat = geo?.[0]?.lat;
      const lon = geo?.[0]?.lon;
      if (lat == null || lon == null) return null;

      // Current weather is fine — kickoff-specific forecast on the free
      // tier requires the One Call 3.0 endpoint which is paid.
      const current = await get<OwResponse>(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`,
      );
      if (!current) return null;

      const tempC = current.main?.temp ?? null;
      const windKph =
        typeof current.wind?.speed === "number"
          ? Number((current.wind.speed * 3.6).toFixed(1))
          : null;
      const precipMm =
        typeof current.rain?.["1h"] === "number" ? current.rain["1h"] : null;
      const conditions = current.weather?.[0]?.description ?? null;
      const summary = [
        tempC != null ? `${Math.round(tempC)}°C` : null,
        windKph != null ? `${windKph} km/h wind` : null,
        precipMm != null && precipMm > 0 ? `${precipMm}mm rain/h` : null,
        conditions,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        tempC,
        windKph,
        precipMm,
        conditions,
        summary: summary || "Weather data available.",
      };
    },
  );
}
