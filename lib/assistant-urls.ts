/** URLs for the separate local-first assistant (FastAPI). Used by /assistant and admin. */

export const DEFAULT_ASSISTANT_DASHBOARD = 'http://127.0.0.1:8000/dashboard'

export function getAssistantDashboardUrl(): string {
  const raw = process.env.NEXT_PUBLIC_ASSISTANT_DASHBOARD_URL?.trim()
  if (raw) return raw
  return DEFAULT_ASSISTANT_DASHBOARD
}

/** FastAPI Swagger UI lives at `/docs` on the same origin as the assistant API. */
export function getAssistantOpenApiUrl(): string {
  const dash = getAssistantDashboardUrl()
  try {
    const u = new URL(dash)
    u.pathname = '/docs'
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return 'http://127.0.0.1:8000/docs'
  }
}
