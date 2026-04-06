import type { Tool } from "@/lib/supabase";

/**
 * In-memory catalog for the current browser tab only (not shared with the server).
 * Survives client-side navigations so / → Videos → / can show cached tools immediately.
 */
let clientToolsCache: Tool[] | null = null;

export function getClientToolsCache(): Tool[] | null {
  if (typeof window === "undefined") return null;
  return clientToolsCache;
}

export function setClientToolsCache(tools: Tool[]): void {
  if (typeof window === "undefined") return;
  clientToolsCache = tools.length > 0 ? tools : null;
}

export function clearClientToolsCache(): void {
  clientToolsCache = null;
}
