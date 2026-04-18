"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Crosshair,
  Loader2,
  ExternalLink,
  Calculator,
  Sparkles,
  Upload,
  AlertTriangle,
  Image as ImageIcon,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PriceQuote {
  marketplace: "csfloat" | "steam" | "buff";
  url: string;
  priceUsd: number | null;
  sellNetUsd: number | null;
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
    arbitrageUsd: number | null;
    arbitragePct: number | null;
    summary: string;
  };
}

interface AnalyzeResponse {
  skin: {
    name: string | null;
    wear: string | null;
    float: number | null;
    pattern: number | null;
    stickers: string[];
  };
  listing: {
    askPriceUsd: number | null;
    medianPriceUsd: number | null;
    trend: "up" | "down" | "flat" | "volatile" | null;
    trendNotes: string | null;
  };
  verdict: {
    rating: number;
    label: "Avoid" | "Risky" | "Fair" | "Good" | "Great";
    rationale: string;
    redFlags: string[];
    greenFlags: string[];
  };
  cost: { totalCostUsd: number } | null;
}

const MARKETPLACE_LABEL: Record<PriceQuote["marketplace"], string> = {
  csfloat: "CSFloat",
  steam: "Steam Market",
  buff: "Buff.market",
};

function formatUsd(v: number | null): string {
  if (v == null) return "—";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export default function CS2BotPage() {
  // ── price lookup ─────────────────────────────────────
  const [name, setName] = useState("AK-47 | Redline (Field-Tested)");
  const [pricesLoading, setPricesLoading] = useState(false);
  const [prices, setPrices] = useState<PricesResponse | null>(null);
  const [pricesError, setPricesError] = useState<string | null>(null);

  const lookup = useCallback(async () => {
    if (pricesLoading || !name.trim()) return;
    setPricesLoading(true);
    setPricesError(null);
    setPrices(null);
    try {
      const res = await fetch("/api/projects/cs2/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      setPrices(data as PricesResponse);
    } catch (err) {
      setPricesError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setPricesLoading(false);
    }
  }, [name, pricesLoading]);

  // ── fee calculator ───────────────────────────────────
  const [calcMode, setCalcMode] = useState<"buyer" | "seller">("seller");
  const [calcAmount, setCalcAmount] = useState("100");
  const [calcPlatform, setCalcPlatform] = useState<"steam" | "csfloat" | "buff" | "custom">("steam");
  const [calcCustomFee, setCalcCustomFee] = useState("5");

  const feePct = useMemo(() => {
    if (calcPlatform === "steam") return 0.15;
    if (calcPlatform === "csfloat") return 0.02;
    if (calcPlatform === "buff") return 0.025;
    const n = parseFloat(calcCustomFee);
    return Number.isFinite(n) ? Math.max(0, Math.min(50, n)) / 100 : 0;
  }, [calcPlatform, calcCustomFee]);

  const calcResult = useMemo(() => {
    const amt = parseFloat(calcAmount);
    if (!Number.isFinite(amt) || amt <= 0) return null;
    if (calcMode === "seller") {
      const fee = amt * feePct;
      return {
        listed: amt,
        fee,
        net: amt - fee,
        label: "You receive after fees",
      };
    }
    const gross = amt / (1 - feePct);
    return {
      listed: gross,
      fee: gross - amt,
      net: amt,
      label: "Buyer must list at",
    };
  }, [calcAmount, feePct, calcMode]);

  // ── steam-balance optimiser ──────────────────────────
  const arbitrage = prices?.recommendation;
  const balanceTip = useMemo(() => {
    const buy = arbitrage?.bestBuy;
    const sell = arbitrage?.bestSell;
    const buyAt = buy?.priceUsd;
    const sellNet = sell?.sellNetUsd;
    if (!buy || !sell || buyAt == null || sellNet == null) return null;
    const listAt = sellNet / (1 - sell.sellFeePct);
    return {
      buyOn: MARKETPLACE_LABEL[buy.marketplace],
      buyAt,
      sellOn: MARKETPLACE_LABEL[sell.marketplace],
      listAt,
      net: sellNet,
      delta: arbitrage?.arbitrageUsd ?? 0,
      pct: arbitrage?.arbitragePct ?? 0,
    };
  }, [arbitrage]);

  // ── AI image analysis ────────────────────────────────
  const [analysing, setAnalysing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const onFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (file.size > 5_000_000) {
        setAnalysisError("Image must be ≤ 5MB.");
        return;
      }
      setAnalysisError(null);
      setAnalysing(true);
      setAnalysis(null);
      try {
        const reader = new FileReader();
        const dataUrl: string = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        setImagePreview(dataUrl);
        const res = await fetch("/api/projects/cs2/analyze-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: dataUrl,
            mimeType: file.type || "image/png",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
        setAnalysis(data as AnalyzeResponse);
      } catch (err) {
        setAnalysisError(err instanceof Error ? err.message : "Analysis failed");
      } finally {
        setAnalysing(false);
      }
    },
    [],
  );

  return (
    <div className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.10),transparent)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-24 top-24 -z-10 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl dark:bg-orange-400/10" />
      <div className="pointer-events-none absolute -left-24 bottom-0 -z-10 h-64 w-64 rounded-full bg-red-500/10 blur-3xl dark:bg-red-400/10" />

      <div className="container mx-auto max-w-5xl px-4 py-8 md:py-12">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="gap-2">
            <Link href="/projects">
              <ArrowLeft className="h-4 w-4" />
              All projects
            </Link>
          </Button>
        </div>

        <header className="mb-8 md:mb-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <Crosshair className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
            CS2 Skin Bot · live prices + AI assessment
          </div>
          <h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
            CS2 Skin Bot
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground md:text-lg">
            Look up live CSFloat &amp; Steam Market prices, calculate platform
            fees, and let AI score a screenshot of any listing.
          </p>
        </header>

        {/* ── Price lookup ─────────────────────────────── */}
        <section className="mb-10 rounded-2xl border border-border/60 bg-card/70 p-5 shadow-sm backdrop-blur-sm">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Activity className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            Price compare
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="cs2-name" className="text-xs">
                market_hash_name
              </Label>
              <Input
                id="cs2-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void lookup();
                  }
                }}
                placeholder="AK-47 | Redline (Field-Tested)"
                className="h-10 text-sm"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Use the exact name shown on Steam Market (incl. wear in
                parentheses).
              </p>
            </div>
            <Button
              onClick={() => void lookup()}
              disabled={pricesLoading || !name.trim()}
              className="h-10 gap-1.5"
            >
              {pricesLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Compare
            </Button>
          </div>

          {pricesError && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {pricesError}
            </div>
          )}

          {prices && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {prices.quotes.map((q) => (
                  <div
                    key={q.marketplace}
                    className="rounded-lg border border-border/60 bg-background p-3 text-sm"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold">
                        {MARKETPLACE_LABEL[q.marketplace]}
                      </span>
                      <a
                        href={q.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Open ${q.marketplace} listing`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <div className="text-xl font-bold">
                      {formatUsd(q.priceUsd)}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Sell-fee {(q.sellFeePct * 100).toFixed(1)}% · net{" "}
                      {formatUsd(q.sellNetUsd)}
                    </div>
                    {q.note && (
                      <div className="mt-2 text-[10px] italic text-muted-foreground">
                        {q.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-sm">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  Best move
                </div>
                <p className="text-sm">{prices.recommendation.summary}</p>
                {balanceTip && (
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-md border border-border/50 bg-background/60 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Buy on
                      </div>
                      <div className="font-semibold">
                        {balanceTip.buyOn} · {formatUsd(balanceTip.buyAt)}
                      </div>
                    </div>
                    <div className="rounded-md border border-border/50 bg-background/60 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        List on
                      </div>
                      <div className="font-semibold">
                        {balanceTip.sellOn} · list at{" "}
                        {formatUsd(balanceTip.listAt)} (net{" "}
                        {formatUsd(balanceTip.net)})
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Fee calculator ───────────────────────────── */}
        <section className="mb-10 rounded-2xl border border-border/60 bg-card/70 p-5 shadow-sm backdrop-blur-sm">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Calculator className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            Fee calculator
          </h2>

          <div className="mb-3 inline-flex rounded-full border border-border bg-muted/40 p-0.5 text-xs">
            {(["seller", "buyer"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setCalcMode(m)}
                className={cn(
                  "rounded-full px-3 py-1.5 font-medium transition-colors",
                  calcMode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "seller" ? "I'm selling" : "I'm buying"}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">
                {calcMode === "seller" ? "Listing price (USD)" : "I want to spend (USD)"}
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={calcAmount}
                onChange={(e) => setCalcAmount(e.target.value)}
                className="h-10 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Platform</Label>
              <select
                value={calcPlatform}
                onChange={(e) =>
                  setCalcPlatform(e.target.value as typeof calcPlatform)
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="steam">Steam Market (15%)</option>
                <option value="csfloat">CSFloat (2%)</option>
                <option value="buff">Buff.market (2.5%)</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Custom fee %</Label>
              <Input
                type="number"
                min="0"
                max="50"
                step="0.1"
                value={calcCustomFee}
                onChange={(e) => setCalcCustomFee(e.target.value)}
                disabled={calcPlatform !== "custom"}
                className="h-10 text-sm disabled:opacity-50"
              />
            </div>
          </div>

          {calcResult && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-background p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Listed price
                </div>
                <div className="text-lg font-bold">
                  {formatUsd(calcResult.listed)}
                </div>
              </div>
              <div className="rounded-lg border border-border/60 bg-background p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Fee ({(feePct * 100).toFixed(1)}%)
                </div>
                <div className="text-lg font-bold text-destructive">
                  −{formatUsd(calcResult.fee)}
                </div>
              </div>
              <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {calcResult.label}
                </div>
                <div className="text-lg font-bold text-orange-700 dark:text-orange-400">
                  {formatUsd(calcResult.net)}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── AI image analysis ────────────────────────── */}
        <section className="mb-10 rounded-2xl border border-border/60 bg-card/70 p-5 shadow-sm backdrop-blur-sm">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            AI listing analysis
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Drop a screenshot of a CSFloat / Steam Market listing (or just the
            skin). Vision model extracts wear, float, stickers, trend, and
            scores the buy 1–5.
          </p>

          <label
            htmlFor="cs2-image"
            className={cn(
              "flex min-h-[8rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground transition-colors hover:border-orange-500/50 hover:bg-orange-500/5",
              analysing && "pointer-events-none opacity-60",
            )}
          >
            <input
              id="cs2-image"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
            {analysing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Analysing…
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                <span>Click to upload a screenshot (PNG / JPG, ≤ 5MB)</span>
              </>
            )}
          </label>

          {analysisError && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {analysisError}
            </div>
          )}

          {(imagePreview || analysis) && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,260px),minmax(0,1fr)]">
              {imagePreview && (
                <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview}
                    alt="Uploaded listing screenshot"
                    className="h-auto w-full object-contain"
                  />
                </div>
              )}
              {analysis ? (
                <AnalysisPanel a={analysis} />
              ) : (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-border/60 p-6 text-xs text-muted-foreground">
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Awaiting analysis…
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function AnalysisPanel({ a }: { a: AnalyzeResponse }) {
  const trendIcon =
    a.listing.trend === "up" ? (
      <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
    ) : a.listing.trend === "down" ? (
      <TrendingDown className="h-3.5 w-3.5 text-destructive" />
    ) : (
      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
    );

  const ratingColor =
    a.verdict.rating >= 4
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : a.verdict.rating >= 3
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
        : "bg-destructive/10 text-destructive border-destructive/30";

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            ratingColor,
          )}
        >
          {a.verdict.rating}/5 · {a.verdict.label}
        </span>
        {a.skin.name && (
          <span className="text-sm font-semibold">{a.skin.name}</span>
        )}
        {a.skin.wear && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {a.skin.wear}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Float" value={a.skin.float?.toFixed(6) ?? "—"} />
        <Stat label="Pattern" value={a.skin.pattern?.toString() ?? "—"} />
        <Stat label="Ask" value={formatUsd(a.listing.askPriceUsd)} />
        <Stat label="Median" value={formatUsd(a.listing.medianPriceUsd)} />
      </div>

      <p className="rounded-lg border border-border/60 bg-background p-3 text-sm">
        {a.verdict.rationale}
      </p>

      {(a.listing.trend || a.listing.trendNotes) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {trendIcon}
          <span className="font-medium capitalize">{a.listing.trend ?? "—"}</span>
          {a.listing.trendNotes && (
            <span className="text-muted-foreground">· {a.listing.trendNotes}</span>
          )}
        </div>
      )}

      {(a.verdict.greenFlags.length > 0 || a.verdict.redFlags.length > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {a.verdict.greenFlags.length > 0 && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                Green flags
              </div>
              <ul className="ml-4 list-disc space-y-0.5 text-xs">
                {a.verdict.greenFlags.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {a.verdict.redFlags.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                Red flags
              </div>
              <ul className="ml-4 list-disc space-y-0.5 text-xs">
                {a.verdict.redFlags.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {a.skin.stickers.length > 0 && (
        <div className="text-xs">
          <span className="font-semibold">Stickers:</span>{" "}
          {a.skin.stickers.join(", ")}
        </div>
      )}

      {a.cost && (
        <p className="text-[10px] text-muted-foreground">
          Vision call cost: {formatUsd(a.cost.totalCostUsd)}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
