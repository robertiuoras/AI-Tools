/**
 * Heuristics for /api/tools/analyze — downloadable apps, agencies, revenue refinement.
 * Used alongside OpenAI output for more reliable UX labels.
 */

/**
 * True when the page shows a real installable app. We use a layered approach
 * so that modern landing pages (Wispr Flow, Linear, etc.) that push visitors
 * through an intermediate `/get-started` or `/download` page are still caught,
 * without over-firing on marketing copy like "our AI app":
 *
 *   Tier A — a single obvious link is enough:
 *     • App / Play / Microsoft Store URL with an app id
 *     • TestFlight, Chrome Web Store, Firefox addons page
 *     • Direct installable artifact (.dmg/.msi/.exe/.apk/...)
 *     • Known first-party download hub (slack, notion, discord, ...)
 *
 *   Tier B — "download for [platform]" style call-to-action. Anchor links
 *     whose visible text includes "download" / "install" / "get the app"
 *     alongside a specific OS name count as a real install CTA even when
 *     they point at an internal router page.
 *
 *   Tier C — copy + link corroboration. If the page explicitly says things
 *     like "available on Mac, Windows, iPhone, and Android" or "runs natively
 *     on", AND the same page contains at least one anchor that looks like a
 *     download router (`/download`, `/get-started`, `/desktop`, `/mac`,
 *     `/windows`, `/ios`, `/android`), we count it. Text alone is not enough;
 *     blog posts talk about "Mac and Windows" all the time.
 *
 * Scripts and styles are stripped before text signals are read.
 */
export function detectDownloadableAppFromHtml(html: string): boolean {
  if (!html || html.length < 40) return false

  // ── 1. Pull every attribute value we care about ──────────────────────────
  const hrefValues: string[] = []
  const attrRe = /(?:href|src|content|data-href|data-url)\s*=\s*("([^"]+)"|'([^']+)')/gi
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(html)) !== null) {
    const v = (m[2] ?? m[3] ?? "").trim()
    if (v) hrefValues.push(v)
    if (hrefValues.length > 6000) break
  }
  if (hrefValues.length === 0) return false

  // ── 2. Pull <a> / <button> anchor text + href pairs (for Tier B) ────────
  // We also look at aria-labels so icon-only buttons still count.
  const anchors: Array<{ href: string; text: string }> = []
  const anchorRe =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let a: RegExpExecArray | null
  while ((a = anchorRe.exec(html)) !== null) {
    const attrs = a[1] ?? ""
    const inner = (a[2] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
    const hrefMatch = attrs.match(/\bhref\s*=\s*("([^"]+)"|'([^']+)')/i)
    const ariaMatch = attrs.match(/\baria-label\s*=\s*("([^"]+)"|'([^']+)')/i)
    const href = (hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim()
    const aria = (ariaMatch?.[2] ?? ariaMatch?.[3] ?? "").trim().toLowerCase()
    const text = `${inner} ${aria}`.trim()
    if (href) anchors.push({ href, text })
    if (anchors.length > 3000) break
  }

  // ── 3. Strip scripts/styles for a clean visible-copy corpus ─────────────
  const visibleText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 20000)

  // ── Tier A — concrete install links ─────────────────────────────────────
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
    /\.(?:dmg|msi|exe|deb|rpm|pkg|apk|appimage|xap|appx|msix)(?:$|[?#])/i.test(u)
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
    /^https?:\/\/discord\.com\/download\b/i.test(u) ||
    /^https?:\/\/(?:www\.)?linear\.app\/download\b/i.test(u) ||
    /^https?:\/\/(?:www\.)?figma\.com\/downloads\b/i.test(u) ||
    /^https?:\/\/(?:www\.)?arc\.net\/download\b/i.test(u)

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

  // ── Tier B — strong CTA: anchor text says "Download for Mac" etc. ──────
  // Platform nouns we care about: mac/macos/osx, windows/pc, ios/iphone/ipad,
  // android, linux. We only count if the anchor text *also* carries a
  // download-intent verb (download/install/get/available/native).
  const platformInText =
    /\b(mac\s?os|macos|mac\b|osx|os x|windows|win(?:dows)? pc|pc\b|ios\b|iphone|ipad|ipados|android|linux|chromebook|desktop|mobile)\b/
  const downloadIntent =
    /\b(download|install|get it|get the app|get flow|get on|open in|try in|available on|now on|native)\b/
  for (const { href, text } of anchors) {
    if (!text) continue
    if (downloadIntent.test(text) && platformInText.test(text) && href.length > 0) {
      // Make sure the target at least looks web-ish (not just "#")
      if (href.startsWith("#") || href.toLowerCase().startsWith("mailto:")) continue
      return true
    }
  }

  // ── Tier C — visible copy says "available on X, Y, Z" + a download router ─
  const multiPlatformStatement =
    /\bavailable\s+(?:on|for)\s+(?:mac(?:\s?os)?|macos|osx|windows|ios|iphone|ipad|android)\b[^.]{0,80}\b(?:mac(?:\s?os)?|macos|osx|windows|ios|iphone|ipad|android)\b/i
  const runsNativelyStatement =
    /\b(?:runs?|works?)\s+(?:natively|native(?:ly)?)\s+(?:on|across)\s+(?:mac|macos|windows|ios|iphone|ipad|android|linux)\b/i
  const desktopAppStatement =
    /\b(?:desktop|native|mobile)\s+app\s+(?:for|on)\s+(?:mac|macos|windows|ios|iphone|ipad|android|linux)\b/i
  const getTheAppStatement =
    /\b(?:get|download|install)\s+(?:the\s+)?(?:app|flow|client)\s+(?:for|on)\s+(?:mac|macos|windows|ios|iphone|ipad|android|linux)\b/i

  const hasCopyClaim =
    multiPlatformStatement.test(visibleText) ||
    runsNativelyStatement.test(visibleText) ||
    desktopAppStatement.test(visibleText) ||
    getTheAppStatement.test(visibleText)

  if (hasCopyClaim) {
    // Need a download-router link on the same page so we don't flag a blog
    // post that merely *mentions* native apps.
    const downloadRouterHref = (u: string) => {
      // Only consider same-origin / relative links (absolute http:// to the
      // same host is fine too — we don't have the host here, so we accept
      // "/" and "https://" paths equally).
      const s = u.toLowerCase()
      if (s.startsWith("mailto:") || s.startsWith("tel:") || s.startsWith("#")) return false
      return (
        /(?:^|\/)(?:download|downloads|get[-_]?started|start|get[-_]?the[-_]?app|desktop|mobile|apps?|install|mac|macos|windows|ios|android)(?:\/|\?|$)/i.test(
          s,
        )
      )
    }
    // Also accept the anchor text carrying the intent even without a hit on
    // the path (some sites point at `/?ref=cta`).
    const downloadAnchor =
      anchors.some(({ href }) => downloadRouterHref(href)) ||
      anchors.some(
        ({ text }) =>
          /\b(?:download|get started|install|get the app)\b/.test(text) &&
          /\b(free|for|on|mac|windows|ios|android|iphone|ipad|app|flow)\b/.test(text),
      )
    if (downloadAnchor) return true
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
    /\bfree\s+for\s+(personal|individual|hobby|small\s+teams?)\b/.test(combined) ||
    // "2000 free words", "200 free minutes", "30 free credits" — strong
    // "metered free tier" wording that modern AI tools use instead of the
    // classic "free plan" label.
    /\b\d{2,}[,\d]*\s+free\s+(words|minutes|credits|messages|tokens|queries|requests|transcriptions|characters|pages|calls|emails|generations|runs|uploads)\b/.test(
      combined,
    ) ||
    /\bfree\s+\d{1,}[,\d]*\s+(words|minutes|credits|messages|tokens|queries|requests|transcriptions|characters|pages|calls|emails|generations|runs|uploads)\b/.test(
      combined,
    ) ||
    // "Free" header in a plan table right next to a "Pro"/"Premium" row —
    // strong signal that the product ships a permanent free tier.
    /\bfree\b[\s\S]{0,400}\b(pro|premium|business|team|growth|plus)\s+(plan)?\b[\s\S]{0,40}\$\s?\d/.test(
      combined,
    )

  const trialOnly =
    /\b(\d+[- ]?day|two[- ]?week|one[- ]?week|14[- ]?day|7[- ]?day|30[- ]?day)\s+(free\s+)?trial\b/.test(combined) ||
    /\bfree\s+trial\b/.test(combined) ||
    /\bfree\s+for\s+\d+\s+days?\b/.test(combined) ||
    /\bfree\s+for\s+(one|two|three|four)\s+weeks?\b/.test(combined)

  // "No credit card required" is a near-universal tell for a real free tier
  // — trials that ask for a card almost never say this. When the product
  // also has paid plans, this is strong enough on its own to flip a "paid"
  // verdict to "freemium".
  const noCardRequired =
    /\bno\s+credit\s+card(?:\s+required|\s+needed)?\b/.test(combined) ||
    /\bwithout\s+(?:a\s+)?credit\s+card\b/.test(combined) ||
    /\bno\s+card\s+(?:required|needed)\b/.test(combined)

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

  // "No credit card required" + paid plans = a real free tier, even when
  // the landing copy only shows a trial duration. Modern devtools (Wispr
  // Flow, Granola, Superhuman, etc.) advertise trial length on the home
  // page and hide the permanent free tier on the pricing page.
  if ((revenue === "paid" || !revenue) && paidPlansExist && noCardRequired) {
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
