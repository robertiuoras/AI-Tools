import { NextRequest, NextResponse } from "next/server";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";

/**
 * CS2 skin price aggregator.
 *
 * Goal: given a `market_hash_name` (e.g. "AK-47 | Redline (Field-Tested)"), return
 * the best buy quotes from supported marketplaces with platform-fee net prices,
 * plus a recommendation flag for Steam-balance arbitrage (buy off-market, sell
 * on Steam at a markup that survives the 15% Steam Market fee).
 *
 * Sources (all public, no API key required for the basic tier):
 * - CSFloat:      https://csfloat.com/api/v1/listings (real-money buy)
 * - Steam Market: https://steamcommunity.com/market/priceoverview/ (Steam balance buy)
 *
 * Buff.market does not expose an open API. We surface a deep link so the user can
 * verify the third quote manually; pulling a real Buff price requires either a
 * paid third-party (Pricempire / SteamDT) or a server-side scraper which would
 * get blocked from a serverless edge. Wiring those in is a follow-up.
 */

interface PriceQuote {
  marketplace: "csfloat" | "steam" | "buff";
  url: string;
  /** Lowest currently-listed price in USD (best ask). null if unavailable. */
  priceUsd: number | null;
  /** Net you actually receive when SELLING here (after marketplace fees). */
  sellNetUsd: number | null;
  /** Marketplace fee taken on a sale, as a percentage of the listed price. */
  sellFeePct: number;
  currency: string;
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
    /**
     * If positive, you can BUY at `bestBuy` and (after fees) SELL at `bestSell`
     * for this many USD per skin. Negative ⇒ no arbitrage right now.
     */
    arbitrageUsd: number | null;
    arbitragePct: number | null;
    summary: string;
  };
}

const STEAM_MARKET_FEE_PCT = 0.15; // 5% Steam + 10% game (CS2)
const CSFLOAT_FEE_PCT = 0.02; // 2% taker fee on CSFloat sales
const BUFF_FEE_PCT = 0.025; // ~2.5% on Buff (informational; we don't pull live data)

function netAfterFee(price: number | null, feePct: number): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  return Math.max(0, price * (1 - feePct));
}

async function fetchCsfloat(name: string): Promise<PriceQuote> {
  const url = `https://csfloat.com/api/v1/listings?market_hash_name=${encodeURIComponent(name)}&sort_by=lowest_price&type=buy_now&limit=10`;
  const quote: PriceQuote = {
    marketplace: "csfloat",
    url: `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}&sort_by=lowest_price`,
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
    const data = (await res.json()) as {
      data?: Array<{ price?: number }>;
    };
    const items = Array.isArray(data?.data) ? data.data : [];
    quote.count = items.length;
    const cheapest = items
      .map((it) => (typeof it.price === "number" ? it.price : null))
      .filter((p): p is number => p != null && p > 0)
      .sort((a, b) => a - b)[0];
    // CSFloat returns prices in cents (USD).
    if (cheapest != null) {
      const usd = cheapest / 100;
      quote.priceUsd = usd;
      quote.sellNetUsd = netAfterFee(usd, CSFLOAT_FEE_PCT);
    }
    return quote;
  } catch (err) {
    quote.note = err instanceof Error ? err.message : "CSFloat lookup failed";
    return quote;
  }
}

async function fetchSteam(name: string): Promise<PriceQuote> {
  const APPID = 730; // CS2 / CS:GO
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
    if (ask != null) {
      quote.priceUsd = ask;
      quote.sellNetUsd = netAfterFee(ask, STEAM_MARKET_FEE_PCT);
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
    note: "Buff has no public API — open the link to verify (we'll wire SteamDT/Pricempire next).",
  };
}

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
      summary: "Not enough live data to compute arbitrage. Try a more specific market_hash_name.",
    };
  }

  const arbitrageUsd = bestSell.sellNetUsd - bestBuy.priceUsd;
  const arbitragePct = (arbitrageUsd / bestBuy.priceUsd) * 100;

  let summary: string;
  if (arbitrageUsd > 0.5 && arbitragePct > 5) {
    summary = `Buy on ${bestBuy.marketplace.toUpperCase()} at $${bestBuy.priceUsd.toFixed(2)}, list on ${bestSell.marketplace.toUpperCase()} for ~$${(bestSell.sellNetUsd / (1 - bestSell.sellFeePct)).toFixed(2)} → +$${arbitrageUsd.toFixed(2)} net (${arbitragePct.toFixed(1)}%) per skin after fees.`;
  } else if (arbitrageUsd > 0) {
    summary = `Marginal edge: +$${arbitrageUsd.toFixed(2)} (${arbitragePct.toFixed(1)}%) — likely eaten by float / wait time.`;
  } else {
    summary = `No arbitrage: best sell after fees ($${bestSell.sellNetUsd.toFixed(2)}) ≤ best buy ($${bestBuy.priceUsd.toFixed(2)}).`;
  }

  return { bestBuy, bestSell, arbitrageUsd, arbitragePct, summary };
}

export async function POST(request: NextRequest) {
  try {
    const limited = enforceApiRateLimit(request, "cs2_prices");
    if (limited) return limited;
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "Provide a CS2 market_hash_name (e.g. 'AK-47 | Redline (Field-Tested)')." },
        { status: 400 },
      );
    }

    const [csfloat, steam] = await Promise.all([
      fetchCsfloat(name),
      fetchSteam(name),
    ]);
    const buff = buildBuffStub(name);
    const quotes = [csfloat, steam, buff];
    const recommendation = buildRecommendation(quotes);

    const payload: PricesResponse = {
      query: name,
      generatedAt: new Date().toISOString(),
      quotes,
      recommendation,
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
