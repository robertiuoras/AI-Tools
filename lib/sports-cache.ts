import "server-only";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Generic Supabase-backed cache for sports-data fetchers.
 *
 * Why: ESPN / API-Football / OpenWeather are all free-tier or rate-limited.
 * Hitting them on every bot request is both slow (multi-second handshakes)
 * and wasteful. This wrapper hashes a key into `sports_data_cache`,
 * returns the previous value if it's still fresh, and otherwise calls the
 * fetcher, stores the result, and returns it.
 *
 * Degrades silently: if Supabase is unreachable or the table doesn't
 * exist, the fetcher is called every time (matches today's behaviour).
 */

function shortHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function admin() {
  return supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => {
          maybeSingle: () => Promise<{
            data: { value: unknown; expires_at: string } | null;
            error: unknown;
          }>;
        };
      };
      upsert: (
        row: Record<string, unknown>,
        opts?: Record<string, unknown>,
      ) => Promise<{ error: unknown }>;
    };
  };
}

export async function readCache<T>(key: string): Promise<T | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { data, error } = await admin()
      .from("sports_data_cache")
      .select("value, expires_at")
      .eq("cache_key", shortHash(key))
      .maybeSingle();
    if (error || !data) return null;
    if (new Date(data.expires_at).getTime() < Date.now()) return null;
    return data.value as T;
  } catch {
    return null;
  }
}

export async function writeCache(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await admin()
      .from("sports_data_cache")
      .upsert(
        {
          cache_key: shortHash(key),
          value,
          expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        },
        { onConflict: "cache_key" },
      );
  } catch {
    // best-effort cache; swallow
  }
}

/**
 * Wrap any async fetcher with a Supabase-backed TTL cache. Returns the
 * cached value if present and fresh; otherwise calls the fetcher and
 * caches the result before returning.
 *
 * Empty results (null, undefined, []) are NOT cached. If a fetcher
 * returns nothing because an env var was missing, an upstream API was
 * briefly down, or the team id hadn't resolved yet, we want the next
 * request to retry instead of seeing a stale empty for the TTL window.
 * Real, populated results cache for the full TTL.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = await readCache<T>(key);
  if (hit !== null) {
    // Defensive: a previously-cached empty array (from before this guard
    // was added) would still come back as []. Treat it as a miss so the
    // fetcher gets a chance to repopulate.
    if (!isEmptyish(hit)) return hit;
  }
  const fresh = await fetcher();
  if (!isEmptyish(fresh)) {
    await writeCache(key, fresh, ttlSeconds);
  }
  return fresh;
}

function isEmptyish(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export const SPORTS_CACHE_TTL = {
  scoreboard: 300, // 5 min — fixtures move
  injuries: 1800, // 30 min
  teamStats: 21_600, // 6 hours
  schedule: 3600, // 1 hour
  h2h: 86_400, // 24 hours — also persisted long-term in h2h_history
  venue: 21_600, // 6 hours
  weather: 21_600, // 6 hours
  odds: 60, // 1 min — line movement matters
  predictions: 3600, // 1 hour
  lineups: 1800, // 30 min — flips closer to kickoff
} as const;
