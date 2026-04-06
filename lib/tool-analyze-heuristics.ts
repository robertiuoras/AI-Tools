/**
 * Heuristics for /api/tools/analyze — downloadable apps, agencies, revenue refinement.
 * Used alongside OpenAI output for more reliable UX labels.
 */

/**
 * True only when the page shows a real installable app: official store links,
 * installable packages (.dmg, .msi, etc.), or known vendor download hubs.
 * Avoids marketing copy like "AI app" / "mobile app" with no actual download.
 */
export function detectDownloadableAppFromHtml(html: string): boolean {
  if (!html || html.length < 40) return false

  // Official mobile / desktop store URLs (high confidence)
  if (
    /https?:\/\/(apps\.apple\.com|itunes\.apple\.com)\b/i.test(html) ||
    /https?:\/\/play\.google\.com\/store\/apps\b/i.test(html) ||
    /microsoft\.com\/(?:store|p)\//i.test(html) ||
    /testflight\.apple\.com\b/i.test(html)
  ) {
    return true
  }

  // Installable artifacts (must look like a file path or href)
  const artifact =
    /\.(?:dmg|msi|exe|deb|rpm|pkg|apk|appimage)(\?|#|"|'|\s|>|$)/i
  if (artifact.test(html)) return true

  // Browser / extension stores (user installs a package)
  if (/chrome\.google\.com\/webstore\b/i.test(html)) return true
  if (/addons\.mozilla\.org\/[^"'\s<>]+/i.test(html)) return true

  // Known first-party download pages with real desktop clients
  if (/slack\.com\/downloads\b/i.test(html)) return true

  return false
}

export function detectAgencyFromText(text: string): boolean {
  if (!text || text.length < 30) return false
  const t = text.toLowerCase()
  const strong: RegExp[] = [
    /\bbook\s+a\s+demo\b/,
    /\bschedule\s+(a\s+)?demo\b/,
    /\brequest\s+a\s+demo\b/,
    /\btalk\s+to\s+sales\b/,
    /\bcontact\s+sales\b/,
    /\bhire\s+us\b/,
    /\bdigital\s+agency\b/,
    /\bmarketing\s+agency\b/,
    /\bcreative\s+agency\b/,
    /\bseo\s+agency\b/,
    /\bwe\s+(are\s+)?a[n]?\s+agency\b/,
    /\bour\s+agency\b/,
    /\bagency\s+services\b/,
    /\bclient\s+success\b.*\bcase\s+stud/i,
  ]
  let hits = 0
  for (const p of strong) {
    if (p.test(t)) hits++
  }
  if (/\bcase\s+stud(?:y|ies)\b/.test(t) && /\bclients?\b/.test(t)) hits++
  if (/\bagency\b/.test(t) && /\b(services|clients?|consulting)\b/.test(t)) hits++
  return hits >= 2 || (/\bagency\b/.test(t) && /\b(book|schedule|demo|contact)\b/.test(t))
}

/**
 * Extra signals from hostname + copy when the page does not repeat "agency" enough
 * for {@link detectAgencyFromText} (e.g. AI marketing / growth firms like rayne.ai).
 */
export function detectAgencyFromUrlAndText(hostname: string, text: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, "")
  // Curated: known service/agency positioning (avoid manual admin toggles)
  if (
    h === "rayne.ai" ||
    h === "rayneai.com" ||
    h.endsWith(".rayne.ai") ||
    h.endsWith(".rayneai.com")
  ) {
    return true
  }

  if (!text || text.length < 40) return false
  const t = text.toLowerCase()

  const singleStrong: RegExp[] = [
    /\b(?:growth|performance|digital)\s+marketing\s+(?:agency|firm|company|team|studio)\b/,
    /\b(?:creative|marketing)\s+(?:agency|firm|studio)\b/,
    /\bwe\s+(?:are|work\s+as)\s+(?:a\s+)?(?:marketing|creative|growth)\s+(?:agency|firm|partner|team)\b/,
    /\b(?:paid\s+media|media\s+buying)\s+(?:agency|services)\b/,
    /\b(?:book|schedule)\s+(?:a\s+)?(?:strategy|discovery|intro)\s+call\b/,
    /\brequest\s+(?:a\s+)?(?:consultation|audit)\b/,
  ]
  for (const p of singleStrong) {
    if (p.test(t)) return true
  }

  if (
    /\b(?:ai|artificial intelligence)[-\s]+(?:marketing|advertising|growth)\b/.test(t) &&
    /\b(?:clients?|brands?|services|campaigns?)\b/.test(t)
  ) {
    return true
  }

  return false
}

/**
 * Fix common mislabel: "freemium" when the product is paid-first / no real free tier.
 */
export function refineRevenueModel(
  revenue: "free" | "freemium" | "paid" | "enterprise" | null | undefined,
  pricingText: string,
  pageText: string,
): "free" | "freemium" | "paid" | "enterprise" | null {
  const combined = `${pricingText} ${pageText}`.toLowerCase()

  if (revenue === "freemium") {
    const hasFreeTier =
      /\bfree\s+(tier|plan|forever|version)\b/.test(combined) ||
      /\bfree\s+to\s+use\b/.test(combined) ||
      /\$\s*0\s*\/\s*mo/.test(combined) ||
      /\bforever\s+free\b/.test(combined)

    const paidOnlySignals =
      /\bpaid\s+only\b/.test(combined) ||
      /\bsubscription\s+only\b/.test(combined) ||
      /\bno\s+free\s+(tier|plan|version)\b/.test(combined) ||
      /\b(?:paid|premium)\s+plans?\s+only\b/.test(combined) ||
      (/\bstarts?\s+at\s+\$\d/.test(combined) &&
        !hasFreeTier &&
        !/\btrial\b/.test(combined)) ||
      (/\bper\s+month\b/.test(combined) &&
        /\$\d/.test(combined) &&
        !hasFreeTier &&
        !/\bfree\s+trial\b/.test(combined))

    if (paidOnlySignals && !hasFreeTier) {
      return "paid"
    }
  }

  return revenue ?? null
}
