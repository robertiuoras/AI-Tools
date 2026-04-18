/**
 * Heuristics for /api/tools/analyze — downloadable apps, agencies, revenue refinement.
 * Used alongside OpenAI output for more reliable UX labels.
 */

/**
 * True only when the page shows a real installable app: a real link to an
 * official store with an app id, an installable package linked from an `href`,
 * or a known first-party download hub. Marketing prose like "our AI app" or
 * stray references to ".exe" inside scripts/CSS are intentionally ignored.
 *
 * To avoid false positives like Vidwud/face-swap web tools that merely mention
 * an "app", every signal must look like a real link in href / src context, and
 * store URLs must include an app/extension identifier (not just the domain).
 */
export function detectDownloadableAppFromHtml(html: string): boolean {
  if (!html || html.length < 40) return false

  // Limit detection to actual link/script attributes so promo copy doesn't trip us up.
  const hrefValues: string[] = []
  const attrRe = /(?:href|src|content|data-href|data-url)\s*=\s*("([^"]+)"|'([^']+)')/gi
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(html)) !== null) {
    const v = (m[2] ?? m[3] ?? "").trim()
    if (v) hrefValues.push(v)
    if (hrefValues.length > 4000) break
  }
  if (hrefValues.length === 0) return false

  const isAppleStoreApp = (u: string) =>
    /^https?:\/\/(?:apps\.apple\.com|itunes\.apple\.com)\/[^?#]*\/(?:app|id\d+)/i.test(u) ||
    /^https?:\/\/(?:apps\.apple\.com|itunes\.apple\.com)\/[^?#]*[?&]id=\d+/i.test(u)
  const isPlayStoreApp = (u: string) =>
    /^https?:\/\/play\.google\.com\/store\/apps\/details\?[^"'\s]*id=/i.test(u)
  const isMicrosoftStoreApp = (u: string) =>
    /^https?:\/\/(?:apps\.microsoft\.com|www\.microsoft\.com)\/(?:store|p)\/[^"'\s]+\/9[a-z0-9]{10,}/i.test(u) ||
    /^https?:\/\/(?:apps\.microsoft\.com|www\.microsoft\.com)\/store\/(?:apps|productid)\//i.test(u)
  const isTestFlight = (u: string) => /^https?:\/\/testflight\.apple\.com\/join\//i.test(u)
  const isInstallableArtifact = (u: string) =>
    /\.(?:dmg|msi|exe|deb|rpm|pkg|apk|appimage)(?:$|[?#])/i.test(u)
  const isChromeWebstoreItem = (u: string) =>
    /^https?:\/\/chromewebstore\.google\.com\/detail\//i.test(u) ||
    /^https?:\/\/chrome\.google\.com\/webstore\/detail\//i.test(u)
  const isFirefoxAddonItem = (u: string) =>
    /^https?:\/\/addons\.mozilla\.org\/[^/]+\/firefox\/addon\//i.test(u)
  const isKnownDownloadHub = (u: string) =>
    /^https?:\/\/slack\.com\/downloads\b/i.test(u) ||
    /^https?:\/\/(?:zoom\.us|www\.zoom\.us)\/download\b/i.test(u) ||
    /^https?:\/\/(?:www\.)?notion\.so\/desktop\b/i.test(u) ||
    /^https?:\/\/(?:www\.)?notion\.com\/desktop\b/i.test(u) ||
    /^https?:\/\/(?:www\.)?obsidian\.md\/download\b/i.test(u) ||
    /^https?:\/\/discord\.com\/download\b/i.test(u)

  for (const u of hrefValues) {
    if (
      isAppleStoreApp(u) ||
      isPlayStoreApp(u) ||
      isMicrosoftStoreApp(u) ||
      isTestFlight(u) ||
      isInstallableArtifact(u) ||
      isChromeWebstoreItem(u) ||
      isFirefoxAddonItem(u) ||
      isKnownDownloadHub(u)
    ) {
      return true
    }
  }

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
