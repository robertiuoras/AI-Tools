/**
 * Supabase/Postgres rows may expose boolean flags as camelCase or snake_case.
 * Use these helpers everywhere we read `tool` rows so agency / app labels stay in sync.
 */
export function toolIsAgency(
  tool: { isAgency?: unknown; is_agency?: unknown },
): boolean {
  const t = tool as Record<string, unknown>
  return Boolean(t.isAgency ?? t.is_agency)
}

export function toolHasDownloadableApp(
  tool: { hasDownloadableApp?: unknown; has_downloadable_app?: unknown },
): boolean {
  const t = tool as Record<string, unknown>
  return Boolean(t.hasDownloadableApp ?? t.has_downloadable_app)
}
