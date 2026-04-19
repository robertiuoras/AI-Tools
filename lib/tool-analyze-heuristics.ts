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
 * Fix common mis-labels around the revenue model.
 *
 * Two-way refinement:
 *   - "freemium" → "paid" when there is no real ongoing free tier.
 *   - "paid"     → "freemium" when there IS a real free tier alongside paid plans.
 *   - "paid"     → "freemium"/"free" when the product is open-source / npm /
 *     pip / Docker / GitHub-distributed and usable without paying.
 *   - "freemium"/"paid" → "enterprise" when copy is purely "contact sales" / SOW.
 *   - "free"     → "freemium" when free is mentioned but paid plans clearly exist.
 *
 * Trial-only ≠ free tier. "Free trial" / "14-day trial" / "no credit card" alone
 * are NOT enough to label something freemium.
 */
export function refineRevenueModel(
  revenue: "free" | "freemium" | "paid" | "enterprise" | null | undefined,
  pricingText: string,
  pageText: string,
): "free" | "freemium" | "paid" | "enterprise" | null {
  const combined = `${pricingText} ${pageText}`.toLowerCase()
  if (!combined.trim()) return revenue ?? null

  const hasFreeTier =
    /\bfree\s+(tier|plan|forever|version|account|seat)\b/.test(combined) ||
    /\bfree\s+to\s+(use|start|sign\s*up)\b/.test(combined) ||
    /\$\s*0\s*\/\s*(mo|month|yr|year|user|seat)\b/.test(combined) ||
    /\bforever\s+free\b/.test(combined) ||
    /\bunlimited\s+free\b/.test(combined) ||
    /\bfree\s+for\s+(personal|individual|hobby|small\s+teams?)\b/.test(combined)

  const trialOnly =
    /\b(\d+[- ]?day|two[- ]?week|one[- ]?week|14[- ]?day|7[- ]?day|30[- ]?day)\s+(free\s+)?trial\b/.test(combined) ||
    /\bfree\s+trial\b/.test(combined)

  const paidPlansExist =
    /\b(starts?\s+at|from)\s+\$\s?\d/.test(combined) ||
    /\$\s?\d+(?:\.\d+)?\s*\/\s*(mo|month|yr|year|user|seat)\b/.test(combined) ||
    /\b(pro|business|premium|enterprise|growth|team)\s+plan\b/.test(combined) ||
    /\bupgrade\s+to\s+(pro|premium|paid|plus)\b/.test(combined)

  const enterpriseOnly =
    /\bcontact\s+(us\s+)?(sales|for\s+pricing|to\s+get\s+started)\b/.test(combined) &&
    !paidPlansExist &&
    !hasFreeTier
  const enterpriseHints =
    /\b(custom\s+pricing|custom\s+quote|talk\s+to\s+sales|book\s+a\s+demo\s+for\s+pricing|annual\s+contract|sso\s+\+\s+saml)\b/.test(combined)

  // Open-source / freely-installable signals.
  // Many devtools (Remotion, Next.js, Supabase, etc.) sell paid plans for a
  // service or "Pro" tier but the underlying library is `npx`/`npm`/`pip`/
  // `docker`/`brew` installable for free. Those are freemium, not paid.
  const explicitOpenSource =
    /\b(open[- ]source|mit\s+licen[cs]e|apache\s+2\.0|gpl\s*v?\d|bsd\s+licen[cs]e|isc\s+licen[cs]e|self[- ]hosted)\b/.test(combined) ||
    /\b(npm\s+install|yarn\s+add|pnpm\s+add|npx\s+create-|pip\s+install|pipx\s+install|brew\s+install|docker\s+pull|docker\s+run|cargo\s+install|go\s+install|composer\s+require)\b/.test(combined) ||
    /\bavailable\s+on\s+(github|npm|pypi|docker\s+hub|crates\.io)\b/.test(combined) ||
    /\bgithub\.com\/[\w.-]+\/[\w.-]+/.test(combined) ||
    /\b(npmjs\.com\/package|pypi\.org\/project)\//.test(combined) ||
    /\b(?:free\s+(?:and|&)\s+open[- ]source|foss|community\s+edition|free\s+forever\s+for\s+(?:devs|developers))\b/.test(combined)

  const noPaidAtAll = !paidPlansExist && !/\bpricing\b/.test(combined)

  if (enterpriseOnly || (enterpriseHints && !hasFreeTier && !paidPlansExist)) {
    return "enterprise"
  }

  if (revenue === "free" && paidPlansExist) {
    return "freemium"
  }

  if (revenue === "paid" && hasFreeTier && paidPlansExist) {
    return "freemium"
  }

  // Open-source override: if the project is freely installable, never call it "paid".
  // If paid plans also exist (Pro / hosted / cloud) → freemium; otherwise → free.
  if (explicitOpenSource) {
    if (revenue === "paid") {
      return paidPlansExist ? "freemium" : "free"
    }
    if (!revenue) {
      return paidPlansExist ? "freemium" : "free"
    }
  }

  if (revenue === "freemium") {
    const paidOnlySignals =
      /\bpaid\s+only\b/.test(combined) ||
      /\bsubscription\s+only\b/.test(combined) ||
      /\bno\s+free\s+(tier|plan|version)\b/.test(combined) ||
      /\b(?:paid|premium)\s+plans?\s+only\b/.test(combined) ||
      (paidPlansExist && !hasFreeTier && !trialOnly && !explicitOpenSource)

    if (paidOnlySignals && !hasFreeTier && !explicitOpenSource) {
      return "paid"
    }
  }

  if (!revenue && noPaidAtAll && explicitOpenSource) return "free"
  if (!revenue && hasFreeTier && paidPlansExist) return "freemium"
  if (!revenue && paidPlansExist && !hasFreeTier) return "paid"

  return revenue ?? null
}
