/**
 * Brand logo resolution for tool cards.
 *
 * Most sites expose multiple "icons", but only a small subset are usable as a
 * crisp little square next to a card title. The previous implementation pulled
 * `og:image` as a logo when nothing else matched — `og:image` is almost always
 * a 1200x630 social banner, which `object-cover` then center-crops into an
 * unreadable smear (this is exactly what made canva.com look like it had no
 * logo: the og:image hit, but the rendered crop looked blank/wrong).
 *
 * The new strategy in priority order:
 *
 *  1. **Schema.org Organization JSON-LD** — `"@type":"Organization"` blocks
 *     usually include `"logo": "<url>"` pointing at the canonical brand mark.
 *     This is what Canva, Stripe, GitHub, Notion, etc. publish, and it's
 *     specifically the asset their brand team curated for embeds.
 *  2. **`<link rel="icon" | "apple-touch-icon" | "mask-icon">`**, ranked by
 *     size hint. Apple touch icons are 180px PNGs and look great as cards.
 *  3. **HEAD-verified common paths** — `/apple-touch-icon.png`,
 *     `/favicon.png`, `/logo.png`, etc. We *verify* the response is actually
 *     an image before accepting (old code just constructed a string).
 *  4. **`<img>` with "logo" in its class/id/alt** — useful for SPAs where the
 *     brand mark is the first hero image.
 *  5. **DuckDuckGo icon service** — works without an API key and covers the
 *     long tail of small commercial sites (~32px PNG).
 *  6. **Google S2 favicons** — guaranteed last resort for any indexed domain
 *     (returns a 128px PNG even when the live page hides its favicon behind
 *     client-side JS).
 *
 * `og:image` is intentionally **not** in this list. It's still extracted by
 * the analyze route for other purposes, but never as the logo.
 */

const HEAD_TIMEOUT_MS = 2_500
const COMMON_PATHS = [
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/favicon.png',
  '/favicon.svg',
  '/favicon.ico',
  '/icon.png',
  '/icon.svg',
  '/logo.png',
  '/logo.svg',
] as const

/** What the resolver picked, plus *why*, so admin tools can show provenance. */
export interface ResolvedLogo {
  /** Final URL to use as the tool logo (always populated — falls back to S2). */
  url: string
  /** How we found it. Useful for debugging "why does Canva have a banner?" */
  source:
    | 'schema_org_json_ld'
    | 'link_rel_icon'
    | 'common_path_head'
    | 'img_logo_class'
    | 'duckduckgo_icon'
    | 'google_s2'
    | 'manual'
  /** Was the candidate verified to actually return an image? */
  verified: boolean
}

/**
 * Some sites mark `<script type="application/ld+json" nonce="...">`. Match the
 * type substring rather than the whole attribute to be tolerant of nonce, id,
 * data-*, and attribute order.
 */
const JSON_LD_RE =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

function extractJsonLdLogos(html: string, origin: string): string[] {
  const out: string[] = []
  for (const match of html.matchAll(JSON_LD_RE)) {
    const raw = match[1]?.trim()
    if (!raw) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Some sites embed multiple JSON objects in one script tag separated by
      // commas (invalid JSON). We can't recover from that without a proper
      // parser; skip gracefully.
      continue
    }
    walkForLogo(parsed, origin, out)
  }
  return out
}

/** Recursively look for `{ "@type": "Organization", "logo": ... }` shaped nodes. */
function walkForLogo(node: unknown, origin: string, out: string[]): void {
  if (!node) return
  if (Array.isArray(node)) {
    for (const item of node) walkForLogo(item, origin, out)
    return
  }
  if (typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  const type = obj['@type']
  // Organization, NewsMediaOrganization, OnlineBusiness, SoftwareApplication, etc.
  const looksLikeOrg =
    typeof type === 'string'
      ? /Organization|Business|Brand|SoftwareApplication|WebSite/i.test(type)
      : Array.isArray(type)
        ? type.some((t) => typeof t === 'string' && /Organization|Business|Brand|SoftwareApplication|WebSite/i.test(t))
        : false
  if (looksLikeOrg) {
    const logoCandidate = obj.logo
    pushLogoCandidate(logoCandidate, origin, out)
    // Some publishers nest the logo inside `image` instead.
    pushLogoCandidate(obj.image, origin, out)
  }
  // Many sites wrap in `@graph: [ ... ]` — walk all values.
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') walkForLogo(value, origin, out)
  }
}

function pushLogoCandidate(value: unknown, origin: string, out: string[]): void {
  if (!value) return
  if (typeof value === 'string') {
    const abs = absolutize(value, origin)
    if (abs) out.push(abs)
    return
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // ImageObject pattern: { "@type": "ImageObject", "url": "..." }
    if (typeof obj.url === 'string') {
      const abs = absolutize(obj.url, origin)
      if (abs) out.push(abs)
    }
    if (typeof obj.contentUrl === 'string') {
      const abs = absolutize(obj.contentUrl, origin)
      if (abs) out.push(abs)
    }
    // Some entries are arrays of ImageObjects.
    if (Array.isArray(value)) {
      for (const item of value) pushLogoCandidate(item, origin, out)
    }
  }
}

function absolutize(href: string, origin: string): string | null {
  try {
    if (!href.trim()) return null
    if (href.startsWith('//')) return `https:${href}`
    return href.startsWith('http') ? href : new URL(href, origin).toString()
  } catch {
    return null
  }
}

interface RankedHref {
  href: string
  /** Higher = preferred. Apple-touch (180px) > sized (192/256/512) > generic. */
  rank: number
}

function extractLinkIcons(html: string, origin: string): RankedHref[] {
  const linkTagRe = /<link\b[^>]*>/gi
  const candidates: RankedHref[] = []
  for (const tag of html.match(linkTagRe) ?? []) {
    const relMatch = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)
    const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)
    if (!relMatch || !hrefMatch) continue
    const rel = relMatch[1].toLowerCase()
    const isIconRel =
      rel.includes('icon') ||
      rel === 'apple-touch-icon-precomposed' ||
      rel === 'mask-icon' ||
      rel === 'fluid-icon' ||
      rel === 'shortcut icon'
    if (!isIconRel) continue
    const sizesMatch = tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i)
    const typeMatch = tag.match(/\btype\s*=\s*["']([^"']+)["']/i)
    const abs = absolutize(hrefMatch[1], origin)
    if (!abs) continue
    let rank = 1
    if (rel.includes('apple-touch-icon')) rank = 5
    else if (rel.includes('mask-icon')) rank = 2
    else if (sizesMatch && /\b(180|192|256|512)\b/.test(sizesMatch[1])) rank = 4
    else if (sizesMatch && /\b(96|128|144)\b/.test(sizesMatch[1])) rank = 3
    // SVGs scale crisply — bump them above bare 16x16 ICOs.
    if (typeMatch?.[1].includes('svg') || abs.toLowerCase().endsWith('.svg')) rank += 1
    candidates.push({ href: abs, rank })
  }
  candidates.sort((a, b) => b.rank - a.rank)
  return candidates
}

function extractMsApplicationTileImage(html: string, origin: string): string | null {
  const m = html.match(
    /<meta[^>]*name=["']msapplication-TileImage["'][^>]*content=["']([^"']+)["']/i,
  )
  if (!m) return null
  return absolutize(m[1], origin)
}

function extractImgWithLogoClass(html: string, origin: string): string | null {
  const m =
    html.match(
      /<img[^>]*(?:class|id|alt)=["'][^"']*\blogo\b[^"']*["'][^>]*src=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<img[^>]*src=["']([^"']+)["'][^>]*(?:class|id|alt)=["'][^"']*\blogo\b[^"']*["']/i,
    )
  if (!m) return null
  return absolutize(m[1], origin)
}

/**
 * HEAD a candidate URL with a tight timeout and confirm we get back an image.
 * Returns the (possibly redirected) final URL on success, null otherwise.
 *
 * Some CDNs (Cloudflare in particular) return 405 for HEAD; fall back to a
 * short Range GET in that case.
 */
async function verifyImage(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    })
    if (r.ok) {
      const ct = (r.headers.get('content-type') ?? '').toLowerCase()
      if (ct.startsWith('image') || ct === 'application/octet-stream') return true
    }
    if (r.status === 405 || r.status === 403) {
      // Try a tiny Range GET to dodge HEAD-hostile CDNs.
      const g = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-15' },
        redirect: 'follow',
        signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
      })
      const ct = (g.headers.get('content-type') ?? '').toLowerCase()
      return g.ok && (ct.startsWith('image') || ct === 'application/octet-stream')
    }
  } catch {
    /* network error / timeout */
  }
  return false
}

/** DuckDuckGo's icon service. No key required; works for almost every domain. */
export function duckDuckGoIcon(hostname: string): string {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`
}

/** Google's S2 favicon service — last-resort fallback for any indexed domain. */
export function googleS2Favicon(hostname: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`
}

/**
 * Heuristic check: does this URL look like a generic favicon fallback we'd
 * want to upgrade to a real brand logo if possible?
 */
export function isWeakLogoFallback(url: string | null | undefined): boolean {
  if (!url) return true
  try {
    const u = new URL(url)
    if (u.hostname.includes('google.com') && u.pathname.startsWith('/s2/favicons')) return true
    if (u.hostname.includes('duckduckgo.com') && u.pathname.startsWith('/ip3/')) return true
    return false
  } catch {
    return true
  }
}

/** Resolve the best logo URL given the page HTML. Always returns a usable URL. */
export async function resolveLogoFromHtml(
  pageUrl: string,
  html: string,
): Promise<ResolvedLogo> {
  let urlObj: URL
  try {
    urlObj = new URL(pageUrl)
  } catch {
    // We were given a malformed URL; fall back to a constant favicon service.
    return { url: googleS2Favicon('example.com'), source: 'google_s2', verified: false }
  }
  const origin = urlObj.origin

  // ── 1. Schema.org Organization JSON-LD ───────────────────────────────────
  const jsonLdLogos = extractJsonLdLogos(html, origin)
  for (const candidate of jsonLdLogos) {
    if (await verifyImage(candidate)) {
      return { url: candidate, source: 'schema_org_json_ld', verified: true }
    }
  }

  // ── 2. <link rel="icon" | apple-touch-icon | mask-icon> ──────────────────
  const linkIcons = extractLinkIcons(html, origin)
  // Also include the IE9-era msapplication-TileImage at low priority.
  const tile = extractMsApplicationTileImage(html, origin)
  if (tile) linkIcons.push({ href: tile, rank: 2 })
  for (const { href } of linkIcons) {
    if (await verifyImage(href)) {
      return { url: href, source: 'link_rel_icon', verified: true }
    }
  }

  // ── 3. HEAD-verified common paths in parallel ────────────────────────────
  const probeResults = await Promise.all(
    COMMON_PATHS.map(async (path) => {
      const u = new URL(path, origin).toString()
      return (await verifyImage(u)) ? u : null
    }),
  )
  const probed = probeResults.find((u): u is string => u !== null)
  if (probed) return { url: probed, source: 'common_path_head', verified: true }

  // ── 4. <img class="logo"> ───────────────────────────────────────────────
  const imgLogo = extractImgWithLogoClass(html, origin)
  if (imgLogo && (await verifyImage(imgLogo))) {
    return { url: imgLogo, source: 'img_logo_class', verified: true }
  }

  // ── 5. DuckDuckGo icon service ──────────────────────────────────────────
  const ddg = duckDuckGoIcon(urlObj.hostname)
  if (await verifyImage(ddg)) {
    return { url: ddg, source: 'duckduckgo_icon', verified: true }
  }

  // ── 6. Google S2 favicon (last resort, always returns an image) ─────────
  return {
    url: googleS2Favicon(urlObj.hostname),
    source: 'google_s2',
    verified: false,
  }
}

/**
 * Used when the page HTML wasn't fetched (e.g. site blocked us). We can still
 * give the card a sensible icon thanks to DuckDuckGo / Google S2.
 */
export async function resolveLogoFromHostnameOnly(
  hostname: string,
): Promise<ResolvedLogo> {
  const ddg = duckDuckGoIcon(hostname)
  if (await verifyImage(ddg)) {
    return { url: ddg, source: 'duckduckgo_icon', verified: true }
  }
  return { url: googleS2Favicon(hostname), source: 'google_s2', verified: false }
}
