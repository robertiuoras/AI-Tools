/** Match directory duplicate checks: lowercase, no trailing slash. */
export function normalizeToolSiteUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/$/, '')
}
