import { NextRequest, NextResponse } from "next/server";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";

/**
 * CS2 skin price aggregator.
 *
 * Given a `market_hash_name` (e.g. "AK-47 | Redline (Field-Tested)"), return
 * the lowest live price across multiple marketplaces, the platform fee, the
 * net the user would receive when *selling* there, and a rolled-up
 * recommendation that highlights cross-market arbitrage opportunities.
 *
 * Sources (no API key required, all public surfaces):
 * - CSFloat:      https://csfloat.com/api/v1/listings   (real-money, 2% fee)
 * - Steam Market: https://steamcommunity.com/market/priceoverview/  (Steam balance, 15% fee)
 * - Skinport:     https://api.skinport.com/v1/items     (real-money, ~12% fee, EU-popular)
 * - DMarket:      https://api.dmarket.com/exchange/v1/market/items (real-money, ~7% fee)
 * - Buff.market:  no public API; we surface a deep link only.
 *
 * The Skinport list endpoint returns ALL CS2 items in one big payload, so we
 * cache it module-side for 5 minutes — looking up an item is then O(1) and
 * does not hit Skinport on every request.
 */

interface CSFloatListing {
  price?: number;
  item?: {
    float_value?: number;
    paint_seed?: number;
  };
}

type Marketplace = "csfloat" | "steam" | "buff" | "skinport" | "dmarket";

interface PriceQuote {
  marketplace: Marketplace;
  url: string;
  /** Lowest currently-listed price in USD (best ask). null if unavailable. */
  priceUsd: number | null;
  /** Net USD you would actually receive when SELLING here (after marketplace fees). */
  sellNetUsd: number | null;
  /** Marketplace fee taken on a sale, as a decimal of the listed price (0.15 = 15%). */
  sellFeePct: number;
  currency: string;
  /** How many listings / monthly volume the marketplace exposed for this name. */
  count: number | null;
  asOf: string;
  note?: string;
}

interface PricesResponse {
  query: string;
  generatedAt: string;
  quotes: PriceQuote[];
  recommendation: {
    bestBuy: PriceQuote | null;
    bestSell: PriceQuote | null;
    /** Profit per skin if you BUY at bestBuy and SELL at bestSell after fees. */
    arbitrageUsd: number | null;
    arbitragePct: number | null;
    summary: string;
  };
  filters: {
    maxFloat: number | null;
    minFloat: number | null;
    maxPriceUsd: number | null;
  };
}

const STEAM_MARKET_FEE_PCT = 0.15; // 5% Steam + 10% game (CS2)
const CSFLOAT_FEE_PCT = 0.02; // 2% taker fee on CSFloat sales
const SKINPORT_FEE_PCT = 0.12; // 12% on default Skinport sales (sliding 6–12%)
const DMARKET_FEE_PCT = 0.07; // ~7% on most CS2 listings on DMarket
const BUFF_FEE_PCT = 0.025; // ~2.5% on Buff (informational; we don't pull live data)

function netAfterFee(price: number | null, feePct: number): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  return Math.max(0, price * (1 - feePct));
}

interface PriceFilters {
  /** CSFloat listings with float strictly above this are ignored. */
  maxFloat: number | null;
  /** CSFloat listings with float strictly below this are ignored. */
  minFloat: number | null;
  /** Listings priced above this in USD are ignored across all markets. */
  maxPriceUsd: number | null;
}

function applyPriceCap(price: number | null, max: number | null): number | null {
  if (price == null) return null;
  if (max == null) return price;
  return price <= max ? price : null;
}

async function fetchCsfloat(name: string, filters: PriceFilters): Promise<PriceQuote> {
  const params = new URLSearchParams({
    market_hash_name: name,
    sort_by: "lowest_price",
    type: "buy_now",
    limit: "20",
  });
  if (filters.maxFloat != null) params.set("max_float", String(filters.maxFloat));
  if (filters.minFloat != null) params.set("min_float", String(filters.minFloat));
  if (filters.maxPriceUsd != null) {
    params.set("max_price", String(Math.round(filters.maxPriceUsd * 100)));
  }
  const url = `https://csfloat.com/api/v1/listings?${params.toString()}`;
  const quote: PriceQuote = {
    marketplace: "csfloat",
    url: `https://csfloat.com/search?${params.toString()}`,
    priceUsd: null,
    sellNetUsd: null,
    sellFeePct: CSFLOAT_FEE_PCT,
    currency: "USD",
    count: null,
    asOf: new Date().toISOString(),
  };
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; AI-Tools/1.0; +https://aitools.local)",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      quote.note = `CSFloat returned ${res.status}`;
      return quote;
    }
    const data = (await res.json()) as { data?: CSFloatListing[] };
    const items = Array.isArray(data?.data) ? data.data : [];
    quote.count = items.length;
    const cheapest = items
      .map((it) => (typeof it.price === "number" ? it.price : null))
      .filter((p): p is number => p != null && p > 0)
      .sort((a, b) => a - b)[0];
    if (cheapest != null) {
      const usd = cheapest / 100; // CSFloat returns prices in cents.
      const capped = applyPriceCap(usd, filters.maxPriceUsd);
      quote.priceUsd = capped;
      quote.sellNetUsd = netAfterFee(capped, CSFLOAT_FEE_PCT);
    }
    return quote;
  } catch (err) {
    quote.note = err instanceof Error ? err.message : "CSFloat lookup failed";
    return quote;
  }
}

async function fetchSteam(name: string, filters: PriceFilters): Promise<PriceQuote> {
  const APPID = 730;
  const url = `https://steamcommunity.com/market/priceoverview/?appid=${APPID}&currency=1&market_hash_name=${encodeURIComponent(name)}`;
  const quote: PriceQuote = {
    marketplace: "steam",
    url: `https://steamcommunity.com/market/listings/${APPID}/${encodeURIComponent(name)}`,
    priceUsd: null,
    sellNetUsd: null,
    sellFeePct: STEAM_MARKET_FEE_PCT,
    currency: "USD",
    count: null,
    asOf: new Date().toISOString(),
  };
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; AI-Tools/1.0)",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      quote.note = `Steam returned ${res.status}`;
      return quote;
    }
    const data = (await res.json()) as {
      success?: boolean;
      lowest_price?: string;
      median_price?: string;
      volume?: string;
    };
    if (!data?.success) {
      quote.note = "Steam reported no data for this name (check spelling).";
      return quote;
    }
    const parse = (s?: string) => {
      if (!s) return null;
      const n = parseFloat(s.replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const ask = parse(data.lowest_price) ?? parse(data.median_price);
    const capped = applyPriceCap(ask, filters.maxPriceUsd);
    if (capped != null) {
      quote.priceUsd = capped;
      quote.sellNetUsd = netAfterFee(capped, STEAM_MARKET_FEE_PCT);
    }
    if (data.volume) {
      const v = parseInt(data.volume.replace(/[^0-9]/g, ""), 10);
      if (Number.isFinite(v)) quote.count = v;
    }
    return quote;
  } catch (err) {
    quote.note = err instanceof Error ? err.message : "Steam lookup failed";
    return quote;
  }
}

/**
 * Skinport's `/v1/items` endpoint returns the entire item index for the game
 * in a single response. Caching the result is essential — without it every
 * lookup re-downloads ~3 MB. We refresh every 5 minutes which matches their
 * recommended polling cadence.
 */
interface SkinportItem {
  market_hash_name?: string;
  currency?: string;
  min_price?: number | null;
  suggested_price?: number | null;
  item_page?: string;
  market_page?: string;
  quantity?: number;
}

let skinportCache: { fetchedAt: number; byName: Map<string, SkinportItem> } | null = null;
const SKINPORT_TTL_MS = 5 * 60_000;

async function loadSkinportIndex(): Promise<Map<string, SkinportItem> | null> {
  if (skinportCache && Date.now() - skinportCache.fetchedAt < SKINPORT_TTL_MS) {
    return skinportCache.byName;
  }
  try {
    const res = await fetch("https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0", {
      headers: {
        Accept: "application/json",
        // Skinport requires brotli; Node 20+ undici will auto-decompress.
        "Accept-Encoding": "br",
        "User-Agent": "Mozilla/5.0 (compatible; AI-Tools/1.0; +https://aitools.local)",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const items = (await res.json()) as SkinportItem[];
    if (!Array.isArray(items)) return null;
    const byName = new Map<string, SkinportItem>();
    for (const it of items) {
      if (typeof it.market_hash_name === "string") {
        byName.set(it.market_hash_name.toLowerCase(), it);
      }
    }
    skinportCache = { fetchedAt: Date.now(), byName };
    return byName;
  } catch {
    return null;
  }
}

async function fetchSkinport(name: string, filters: PriceFilters): Promise<PriceQuote> {
  const slug = name
    .toLowerCase()
    .replace(/[★™]/g, "")
    .replace(/[|]/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const quote: PriceQuote = {
    marketplace: "skinport",
    url: `https://skinport.com/market?search=${encodeURIComponent(name)}&sort=price&order=asc`,
    priceUsd: null,
    sellNetUsd: null,
    sellFeePct: SKINPORT_FEE_PCT,
    currency: "USD",
    count: null,
    asOf: new Date().toISOString(),
  };
  try {
    const index = await loadSkinportIndex();
    if (!index) {
      quote.note = "Skinport index unavailable — try again in a moment.";
      return quote;
    }
    const hit = index.get(name.toLowerCase());
    if (!hit) {
      quote.note = "No Skinport listing for that exact name.";
      return quote;
    }
    if (hit.item_page || hit.market_page) {
      quote.url = (hit.item_page ?? hit.market_page) as string;
    } else {
      quote.url = `https://skinport.com/item/${slug}`;
    }
    const ask = typeof hit.min_price === "number" ? hit.min_price : null;
    const capped = applyPriceCap(ask, filters.maxPriceUsd);
    if (capped != null) {
      quote.priceUsd = capped;
      quote.sellNetUsd = netAfterFee(capped, SKINPORT_FEE_PCT);
    }
    if (typeof hit.quantity === "number") quote.count = hit.quantity;
    return quote;
  } catch (err) {
    quote.note = err instanceof Error ? err.message : "Skinport lookup failed";
    return quote;
  }
}

async function fetchDmarket(name: string, filters: PriceFilters): Promise<PriceQuote> {
  const params = new URLSearchParams({
    gameId: "a8db", // CS2 / CS:GO
    title: name,
    currency: "USD",
    limit: "20",
    orderBy: "price",
    orderDir: "asc",
  });
  const url = `https://api.dmarket.com/exchange/v1/market/items?${params.toString()}`;
  const quote: PriceQuote = {
    marketplace: "dmarket",
    url: `https://dmarket.com/ingame-items/item-list/csgo-skins?title=${encodeURIComponent(name)}`,
    priceUsd: null,
    sellNetUsd: null,
    sellFeePct: DMARKET_FEE_PCT,
    currency: "USD",
    count: null,
    asOf: new Date().toISOString(),
  };
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; AI-Tools/1.0; +https://aitools.local)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      quote.note = `DMarket returned ${res.status}`;
      return quote;
    }
    const data = (await res.json()) as {
      objects?: Array<{
        title?: string;
        price?: { USD?: string | number };
        extra?: { floatValue?: number };
      }>;
      total?: { items?: number };
    };
    const offers = Array.isArray(data?.objects) ? data.objects : [];
    quote.count = offers.length;
    const prices = offers
      .filter((o) => typeof o.title === "string" && o.title.toLowerCase() === name.toLowerCase())
      .filter((o) => {
        const f = o.extra?.floatValue;
        if (typeof f !== "number") return true;
        if (filters.maxFloat != null && f > filters.maxFloat) return false;
        if (filters.minFloat != null && f < filters.minFloat) return false;
        return true;
      })
      .map((o) => {
        const raw = o.price?.USD;
        if (typeof raw === "number") return raw / 100;
        if (typeof raw === "string") {
          const n = parseFloat(raw);
          // DMarket returns the price in cents as a string.
          return Number.isFinite(n) ? n / 100 : null;
        }
        return null;
      })
      .filter((p): p is number => p != null && p > 0)
      .sort((a, b) => a - b);
    const cheapest = prices[0];
    const capped = applyPriceCap(cheapest ?? null, filters.maxPriceUsd);
    if (capped != null) {
      quote.priceUsd = capped;
      quote.sellNetUsd = netAfterFee(capped, DMARKET_FEE_PCT);
    }
    return quote;
  } catch (err) {
    quote.note = err instanceof Error ? err.message : "DMarket lookup failed";
    return quote;
  }
}

function buildBuffStub(name: string): PriceQuote {
  return {
    marketplace: "buff",
    url: `https://buff.market/market/csgo#tab=selling&page_num=1&search=${encodeURIComponent(name)}`,
    priceUsd: null,
    sellNetUsd: null,
    sellFeePct: BUFF_FEE_PCT,
    currency: "CNY",
    count: null,
    asOf: new Date().toISOString(),
    note: "Buff.market has no public API — open the link to verify; SteamDT integration TBD.",
  };
}

const MARKET_DISPLAY: Record<Marketplace, string> = {
  csfloat: "CSFloat",
  steam: "Steam Market",
  buff: "Buff.market",
  skinport: "Skinport",
  dmarket: "DMarket",
};

function buildRecommendation(quotes: PriceQuote[]): PricesResponse["recommendation"] {
  const withPrice = quotes.filter((q) => q.priceUsd != null);
  const bestBuy = withPrice.reduce<PriceQuote | null>(
    (acc, q) => (acc == null || (q.priceUsd ?? Infinity) < (acc.priceUsd ?? Infinity) ? q : acc),
    null,
  );
  const bestSell = quotes.reduce<PriceQuote | null>(
    (acc, q) => (acc == null || (q.sellNetUsd ?? -1) > (acc.sellNetUsd ?? -1) ? q : acc),
    null,
  );

  if (!bestBuy?.priceUsd || !bestSell?.sellNetUsd) {
    return {
      bestBuy,
      bestSell,
      arbitrageUsd: null,
      arbitragePct: null,
      summary:
        "Not enough live data to compute arbitrage. Try a more popular skin or relax the filters.",
    };
  }

  const arbitrageUsd = bestSell.sellNetUsd - bestBuy.priceUsd;
  const arbitragePct = (arbitrageUsd / bestBuy.priceUsd) * 100;

  let summary: string;
  if (arbitrageUsd > 0.5 && arbitragePct > 5) {
    const listAt = bestSell.sellNetUsd / (1 - bestSell.sellFeePct);
    summary = `Buy on ${MARKET_DISPLAY[bestBuy.marketplace]} at $${bestBuy.priceUsd.toFixed(2)}, list on ${MARKET_DISPLAY[bestSell.marketplace]} for ~$${listAt.toFixed(2)} → +$${arbitrageUsd.toFixed(2)} net (${arbitragePct.toFixed(1)}%) per skin after fees.`;
  } else if (arbitrageUsd > 0) {
    summary = `Marginal edge: +$${arbitrageUsd.toFixed(2)} (${arbitragePct.toFixed(1)}%) — likely eaten by float / wait time / payout delay.`;
  } else {
    summary = `No arbitrage right now: best sell after fees ($${bestSell.sellNetUsd.toFixed(2)}) ≤ best buy ($${bestBuy.priceUsd.toFixed(2)}).`;
  }

  return { bestBuy, bestSell, arbitrageUsd, arbitragePct, summary };
}

function parseFiltersFromBody(body: unknown): PriceFilters {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const clampFloat = (v: number | null) =>
    v == null ? null : Math.min(1, Math.max(0, v));
  const clampPrice = (v: number | null) => (v == null ? null : Math.max(0, v));
  return {
    maxFloat: clampFloat(num(obj.maxFloat)),
    minFloat: clampFloat(num(obj.minFloat)),
    maxPriceUsd: clampPrice(num(obj.maxPriceUsd)),
  };
}

export async function POST(request: NextRequest) {
  try {
    const limited = enforceApiRateLimit(request, "cs2_prices");
    if (limited) return limited;
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? (body.name as string).trim() : "";
    if (!name) {
      return NextResponse.json(
        {
          error:
            "Provide a CS2 market_hash_name (e.g. 'AK-47 | Redline (Field-Tested)').",
        },
        { status: 400 },
      );
    }

    const filters = parseFiltersFromBody(body);

    const [csfloat, steam, skinport, dmarket] = await Promise.all([
      fetchCsfloat(name, filters),
      fetchSteam(name, filters),
      fetchSkinport(name, filters),
      fetchDmarket(name, filters),
    ]);
    const buff = buildBuffStub(name);
    const quotes = [csfloat, steam, skinport, dmarket, buff];
    const recommendation = buildRecommendation(quotes);

    const payload: PricesResponse = {
      query: name,
      generatedAt: new Date().toISOString(),
      quotes,
      recommendation,
      filters,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Server error while fetching CS2 prices.", details: message },
      { status: 500 },
    );
  }
}
