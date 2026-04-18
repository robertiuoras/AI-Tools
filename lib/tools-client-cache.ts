import type { Tool } from "@/lib/supabase";

/**
 * In-memory catalog for the current browser tab only (not shared with the server).
 * Survives client-side navigations so / → Videos → / can show cached tools immediately.
 *
 * We also track when the cache was last written so the home page can decide
 * whether a background revalidation is actually worth doing — pinging
 * `/api/tools` on every nav adds latency for no UX gain when the data is fresh.
 */
let clientToolsCache: Tool[] | null = null;
let clientToolsCacheAt = 0;

export function getClientToolsCache(): Tool[] | null {
  if (typeof window === "undefined") return null;
  return clientToolsCache;
}

export function getClientToolsCacheAgeMs(): number {
  if (typeof window === "undefined") return Number.POSITIVE_INFINITY;
  if (clientToolsCacheAt === 0) return Number.POSITIVE_INFINITY;
  return Date.now() - clientToolsCacheAt;
}

export function setClientToolsCache(tools: Tool[]): void {
  if (typeof window === "undefined") return;
  clientToolsCache = tools.length > 0 ? tools : null;
  clientToolsCacheAt = clientToolsCache ? Date.now() : 0;
}

export function clearClientToolsCache(): void {
  clientToolsCache = null;
  clientToolsCacheAt = 0;
}
