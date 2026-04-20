"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Gauge,
  Info,
  Loader2,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
  Telescope,
  TrendingDown,
  TrendingUp,
  Wand2,
  XCircle,
  ListChecks,
  AlertTriangle,
  DollarSign,
  Scale,
  Clock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import {
  BETTING_MARKETS,
  BETTING_SPORTS,
  METRIC_FRAMEWORK,
  americanToDecimal,
  americanToImpliedProb,
  parseAmericanOdds,
  type BettingAnalysisResult,
  type BettingMetricScore,
} from "@/lib/betting-bot";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function fmtPct(n: number, d = 1): string {
  return `${n.toFixed(d)}%`;
}

function fmt$(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

const VERDICT_STYLES: Record<
  BettingAnalysisResult["verdict"],
  {
    label: string;
    tone: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  strong_bet: {
    label: "Strong bet",
    tone: "emerald",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-600 dark:text-emerald-300",
    badgeBorder: "border-emerald-500/40",
    subtitle: "High edge + strong data quality. Fire at half-Kelly.",
    icon: CheckCircle2,
  },
  bet: {
    label: "Bet",
    tone: "emerald",
    badgeBg: "bg-emerald-500/10",
    badgeText: "text-emerald-600 dark:text-emerald-300",
    badgeBorder: "border-emerald-500/30",
    subtitle: "Positive edge with acceptable data. Size modestly.",
    icon: TrendingUp,
  },
  lean: {
    label: "Lean",
    tone: "amber",
    badgeBg: "bg-amber-500/10",
    badgeText: "text-amber-600 dark:text-amber-300",
    badgeBorder: "border-amber-500/30",
    subtitle: "Slight edge — quarter-Kelly or pass if you need conviction.",
    icon: CircleDot,
  },
  pass: {
    label: "Pass",
    tone: "slate",
    badgeBg: "bg-slate-500/10",
    badgeText: "text-slate-600 dark:text-slate-300",
    badgeBorder: "border-slate-500/30",
    subtitle: "No meaningful edge. Save the bullet.",
    icon: XCircle,
  },
  fade: {
    label: "Fade",
    tone: "rose",
    badgeBg: "bg-rose-500/10",
    badgeText: "text-rose-600 dark:text-rose-300",
    badgeBorder: "border-rose-500/30",
    subtitle: "Value is on the other side. Consider the opposing line.",
    icon: TrendingDown,
  },
};

const CONFIDENCE_BIN_STYLES: Record<
  BettingAnalysisResult["confidenceBin"],
  { label: string; tone: string }
> = {
  low: { label: "Low", tone: "text-slate-500" },
  moderate: { label: "Moderate", tone: "text-amber-500" },
  high: { label: "High", tone: "text-emerald-500" },
  elite: { label: "Elite", tone: "text-emerald-400" },
};

function metricToneFor(direction: BettingMetricScore["direction"]): {
  ring: string;
  bar: string;
  text: string;
  dot: string;
} {
  if (direction === "for") {
    return {
      ring: "ring-emerald-500/30",
      bar: "bg-gradient-to-r from-emerald-600 to-emerald-400",
      text: "text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
    };
  }
  if (direction === "against") {
    return {
      ring: "ring-rose-500/30",
      bar: "bg-gradient-to-r from-rose-600 to-rose-400",
      text: "text-rose-600 dark:text-rose-400",
      dot: "bg-rose-500",
    };
  }
  return {
    ring: "ring-slate-500/20",
    bar: "bg-gradient-to-r from-slate-500 to-slate-400",
    text: "text-slate-500 dark:text-slate-400",
    dot: "bg-slate-500",
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  SVG primitives — gauge + radar, no chart library needed                   */
/* ────────────────────────────────────────────────────────────────────────── */

function polar(cx: number, cy: number, r: number, angle: number) {
  const a = (angle - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M",
    start.x,
    start.y,
    "A",
    r,
    r,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
  ].join(" ");
}

function ConfidenceGauge({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const startAngle = -120;
  const endAngle = 120;
  const span = endAngle - startAngle;
  const valueAngle = startAngle + (span * clamped) / 100;

  const cx = 110;
  const cy = 110;
  const r = 82;

  // Colour ramp based on bin.
  const colour =
    clamped >= 72
      ? "#10b981"
      : clamped >= 60
        ? "#22c55e"
        : clamped >= 48
          ? "#f59e0b"
          : "#94a3b8";

  return (
    <div className="relative mx-auto flex w-full max-w-[240px] flex-col items-center">
      <svg viewBox="0 0 220 180" className="w-full">
        <defs>
          <linearGradient id="gauge-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="gauge-fg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={colour} stopOpacity="0.7" />
            <stop offset="100%" stopColor={colour} />
          </linearGradient>
        </defs>

        <path
          d={arcPath(cx, cy, r, startAngle, endAngle)}
          stroke="currentColor"
          strokeOpacity="0.14"
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={arcPath(cx, cy, r, startAngle, valueAngle)}
          stroke="url(#gauge-fg)"
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
        />

        {/* Minor ticks */}
        {Array.from({ length: 11 }).map((_, i) => {
          const a = startAngle + (span * i) / 10;
          const p1 = polar(cx, cy, r - 4, a);
          const p2 = polar(cx, cy, r + 4, a);
          return (
            <line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="currentColor"
              strokeOpacity={i % 5 === 0 ? 0.5 : 0.2}
              strokeWidth={i % 5 === 0 ? 2 : 1}
            />
          );
        })}

        {/* Needle */}
        <g transform={`rotate(${valueAngle} ${cx} ${cy})`}>
          <line
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy - r + 10}
            stroke={colour}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="6" fill={colour} />
        </g>

        <text
          x={cx}
          y={cy + 20}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 26, fontWeight: 800 }}
        >
          {clamped.toFixed(0)}
        </text>
        <text
          x={cx}
          y={cy + 38}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 10, letterSpacing: 2 }}
        >
          CONFIDENCE
        </text>
      </svg>
    </div>
  );
}

function MetricRadar({ metrics }: { metrics: BettingMetricScore[] }) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const r = 105;
  const n = metrics.length;

  const pointsFor = (values: number[]) =>
    values
      .map((v, i) => {
        const angle = (360 / n) * i;
        const rad = (angle - 90) * (Math.PI / 180);
        const rr = (v / 10) * r;
        return `${cx + rr * Math.cos(rad)},${cy + rr * Math.sin(rad)}`;
      })
      .join(" ");

  const scoreValues = metrics.map((m) => m.score);
  const confidenceValues = metrics.map((m) => m.confidence);

  // Short labels to prevent clipping; tooltips show the full name on hover.
  const shortLabel: Record<string, string> = {
    "Recent form & momentum": "Form",
    "Injuries & lineup health": "Injuries",
    "Head-to-head history": "H2H",
    "Home/away & travel": "Travel",
    "Power ratings & advanced metrics": "Power",
    "Line movement & sharp action": "Sharps",
    "Weather & venue": "Venue",
    "Motivation & situational": "Situation",
    "Market efficiency & price value": "Value",
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[360px]">
      {/* Concentric rings */}
      {[0.25, 0.5, 0.75, 1].map((f, i) => (
        <polygon
          key={i}
          points={pointsFor(Array(n).fill(10 * f))}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={1}
        />
      ))}

      {/* Radial spokes */}
      {Array.from({ length: n }).map((_, i) => {
        const angle = (360 / n) * i;
        const rad = (angle - 90) * (Math.PI / 180);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + r * Math.cos(rad)}
            y2={cy + r * Math.sin(rad)}
            stroke="currentColor"
            strokeOpacity={0.1}
          />
        );
      })}

      {/* Confidence shadow (data quality), lighter */}
      <polygon
        points={pointsFor(confidenceValues)}
        fill="rgb(139, 92, 246)"
        fillOpacity={0.08}
        stroke="rgb(139, 92, 246)"
        strokeOpacity={0.4}
        strokeWidth={1}
        strokeDasharray="3 3"
      />

      {/* Primary score polygon */}
      <polygon
        points={pointsFor(scoreValues)}
        fill="rgb(16, 185, 129)"
        fillOpacity={0.2}
        stroke="rgb(16, 185, 129)"
        strokeWidth={2}
      />

      {/* Score dots */}
      {metrics.map((m, i) => {
        const angle = (360 / n) * i;
        const rad = (angle - 90) * (Math.PI / 180);
        const rr = (m.score / 10) * r;
        const x = cx + rr * Math.cos(rad);
        const y = cy + rr * Math.sin(rad);
        return (
          <circle
            key={m.key}
            cx={x}
            cy={y}
            r={3.2}
            fill="rgb(16, 185, 129)"
            stroke="rgb(6, 78, 59)"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Labels */}
      {metrics.map((m, i) => {
        const angle = (360 / n) * i;
        const rad = (angle - 90) * (Math.PI / 180);
        const labelR = r + 18;
        const x = cx + labelR * Math.cos(rad);
        const y = cy + labelR * Math.sin(rad);
        return (
          <text
            key={`label-${m.key}`}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 10, fontWeight: 600 }}
          >
            <title>{m.key}</title>
            {shortLabel[m.key] ?? m.key.split(" ")[0]}
          </text>
        );
      })}
    </svg>
  );
}

function EdgeBar({
  fair,
  book,
}: {
  fair: number;
  book: number;
}) {
  const positive = fair > book;
  const low = Math.min(fair, book);
  const high = Math.max(fair, book);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-medium">
        <span className="text-muted-foreground">Book implied</span>
        <span className="text-muted-foreground">Fair win prob</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        {/* Full width = 100% probability */}
        <div
          className={cn(
            "absolute inset-y-0 rounded-full",
            positive
              ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
              : "bg-gradient-to-r from-rose-600 to-rose-400",
          )}
          style={{
            left: `${low}%`,
            width: `${Math.max(high - low, 0.5)}%`,
          }}
        />
        <div
          className="absolute inset-y-0 w-[2px] bg-foreground/70"
          style={{ left: `${book}%` }}
          aria-label="Book probability"
        />
        <div
          className="absolute -top-1.5 h-6 w-1 rounded bg-emerald-500"
          style={{ left: `calc(${fair}% - 2px)` }}
          aria-label="Fair probability"
        />
      </div>
      <div className="flex items-center justify-between text-[11px] font-semibold tabular-nums">
        <span className="text-muted-foreground">{fmtPct(book)}</span>
        <span className={positive ? "text-emerald-500" : "text-rose-500"}>
          {positive ? "+" : ""}
          {fmtPct(fair - book)} edge
        </span>
        <span className="text-emerald-500">{fmtPct(fair)}</span>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Layout primitives                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

function InputPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-muted/20 p-5 space-y-4">
      {children}
    </div>
  );
}

function FieldWrapper({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label
          htmlFor={id}
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </Label>
        {hint ? (
          <span className="text-[10px] text-muted-foreground/70">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function NativeSelect({
  id,
  value,
  onChange,
  children,
  className,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-11 w-full appearance-none rounded-md border border-border/60 bg-background/60 px-3 pr-9 text-sm font-medium text-foreground shadow-sm",
          "focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
    </div>
  );
}

function MetricCard({ metric }: { metric: BettingMetricScore }) {
  const frame = METRIC_FRAMEWORK.find((f) => f.key === metric.key);
  const tone = metricToneFor(metric.direction);
  const scorePct = (metric.score / 10) * 100;
  const confPct = (metric.confidence / 10) * 100;
  const lowData = metric.confidence <= 3;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-card/40 p-4 ring-1 ring-inset",
        tone.ring,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
            <p className="text-sm font-semibold text-foreground truncate">
              {metric.key}
            </p>
          </div>
          {frame ? (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
              Weight {frame.weight}/100 · {frame.description}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              "text-xl font-black tabular-nums leading-none",
              tone.text,
            )}
          >
            {metric.score.toFixed(1)}
            <span className="text-xs font-semibold text-muted-foreground">
              /10
            </span>
          </p>
          <p
            className={cn(
              "mt-0.5 text-[10px] font-bold uppercase tracking-wider",
              lowData ? "text-amber-500" : "text-muted-foreground/70",
            )}
          >
            {lowData ? "low data" : metric.direction}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", tone.bar)}
            style={{ width: `${scorePct}%` }}
          />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Data quality</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/70">
            <div
              className="h-full rounded-full bg-violet-500/60"
              style={{ width: `${confPct}%` }}
            />
          </div>
          <span className="tabular-nums">
            {metric.confidence.toFixed(0)}/10
          </span>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-foreground/80">
        {metric.reasoning}
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Page                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export default function AiBettingBotPage() {
  const { addToast } = useToast();

  const [sport, setSport] = useState<string>("NFL");
  const [league, setLeague] = useState<string>("");
  const [event, setEvent] = useState<string>("");
  const [pick, setPick] = useState<string>("");
  const [market, setMarket] = useState<string>("Moneyline");
  const [odds, setOdds] = useState<string>("");
  const [bankroll, setBankroll] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BettingAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const oddsParsed = useMemo(() => parseAmericanOdds(odds), [odds]);
  const oddsImplied =
    oddsParsed !== null ? americanToImpliedProb(oddsParsed) : null;
  const oddsDecimal = oddsParsed !== null ? americanToDecimal(oddsParsed) : null;

  const canSubmit =
    sport.trim() &&
    event.trim().length >= 3 &&
    pick.trim().length >= 2 &&
    market.trim() &&
    oddsParsed !== null &&
    !loading;

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/projects/ai-betting-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sport,
          league: league || undefined,
          event,
          pick,
          market,
          oddsAmerican: oddsParsed,
          stakeBankroll: bankroll ? Number(bankroll) : null,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          (data?.error as string | undefined) ??
          `Request failed with ${res.status}`;
        setError(msg);
        addToast({
          variant: "error",
          title: "Analysis failed",
          description: msg.length > 160 ? msg.slice(0, 160) + "…" : msg,
        });
        return;
      }
      setResult(data as BettingAnalysisResult);
      addToast({
        variant: "success",
        title: "Analysis ready",
        description: `Confidence ${(data as BettingAnalysisResult).confidencePct}%`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addToast({
        variant: "error",
        title: "Network error",
        description: msg,
      });
    } finally {
      setLoading(false);
    }
  }

  const verdictStyle = result ? VERDICT_STYLES[result.verdict] : null;

  return (
    <div className="relative overflow-hidden pb-16">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-24 top-24 -z-10 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl dark:bg-amber-400/10" />
      <div className="pointer-events-none absolute -left-24 bottom-0 -z-10 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl dark:bg-rose-400/10" />

      <div className="container mx-auto max-w-6xl px-4 py-10 md:py-12">
        {/* Header */}
        <header className="mb-8 md:mb-10">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All projects
          </Link>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                <Bot className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                AI Betting Bot · Pro-grade confidence model
              </div>
              <h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
                Bet like a pro. Quantify like a machine.
              </h1>
              <p className="mt-3 max-w-2xl text-base text-muted-foreground">
                Submit any pick — moneyline, spread, total, prop, or parlay. The
                model scores it across the same nine metrics used by full-time
                sharps, prices the true edge vs the book, and returns a calibrated
                confidence score with a conservative Kelly stake.
              </p>
            </div>
            <div className="hidden md:flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 ring-1 ring-amber-500/30">
              <Brain className="h-8 w-8 text-amber-600 dark:text-amber-300" />
            </div>
          </div>
        </header>

        {/* Input form */}
        <section className="mb-10">
          <InputPanel>
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Your bet
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <FieldWrapper id="sport" label="Sport / competition">
                <NativeSelect id="sport" value={sport} onChange={setSport}>
                  {BETTING_SPORTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelect>
              </FieldWrapper>
              <FieldWrapper
                id="league"
                label="League / tour"
                hint="optional"
              >
                <Input
                  id="league"
                  value={league}
                  onChange={(e) => setLeague(e.target.value)}
                  placeholder="e.g. AFC East"
                  className="h-11 bg-background/60"
                />
              </FieldWrapper>
              <FieldWrapper id="market" label="Market">
                <NativeSelect id="market" value={market} onChange={setMarket}>
                  {BETTING_MARKETS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </NativeSelect>
              </FieldWrapper>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FieldWrapper id="event" label="Event / matchup">
                <Input
                  id="event"
                  value={event}
                  onChange={(e) => setEvent(e.target.value)}
                  placeholder="e.g. Chiefs @ Bills — Week 12"
                  className="h-11 bg-background/60"
                />
              </FieldWrapper>
              <FieldWrapper id="pick" label="Your pick">
                <Input
                  id="pick"
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                  placeholder="e.g. Bills -2.5"
                  className="h-11 bg-background/60"
                />
              </FieldWrapper>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <FieldWrapper
                id="odds"
                label="Odds (American)"
                hint="-110, +180, …"
              >
                <div className="relative">
                  <Input
                    id="odds"
                    value={odds}
                    onChange={(e) => setOdds(e.target.value)}
                    placeholder="-110"
                    className="h-11 pr-24 bg-background/60"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60">
                    {oddsImplied !== null
                      ? `${oddsImplied.toFixed(1)}% · ${oddsDecimal?.toFixed(2)}x`
                      : "US"}
                  </span>
                </div>
              </FieldWrapper>
              <FieldWrapper
                id="bankroll"
                label="Bankroll"
                hint="optional — for stake sizing"
              >
                <div className="relative">
                  <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                  <Input
                    id="bankroll"
                    value={bankroll}
                    onChange={(e) => setBankroll(e.target.value)}
                    placeholder="1000"
                    inputMode="decimal"
                    className="h-11 pl-8 bg-background/60"
                  />
                </div>
              </FieldWrapper>
              <FieldWrapper
                id="notes-short"
                label="Research notes"
                hint="stronger when supplied"
              >
                <Input
                  id="notes-short"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Injuries, line moves, trends…"
                  className="h-11 bg-background/60"
                />
              </FieldWrapper>
            </div>

            <div className="grid gap-2">
              <Label
                htmlFor="notes-long"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Long-form research (optional)
              </Label>
              <textarea
                id="notes-long"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                placeholder={
                  "Paste injury reports, line history, team splits, sharp-side reads, weather, referee info, or model outputs. The more concrete numbers you paste here, the less the bot has to guess."
                }
                className="w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                onClick={runAnalysis}
                disabled={!canSubmit}
                className="h-11 gap-2 bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/20 hover:from-amber-500/90 hover:to-orange-500/90"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Analysing
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" /> Run pro analysis
                  </>
                )}
              </Button>
              {oddsParsed !== null ? (
                <p className="text-xs text-muted-foreground">
                  Book implied{" "}
                  <span className="font-semibold text-foreground">
                    {oddsImplied?.toFixed(1)}%
                  </span>{" "}
                  · decimal{" "}
                  <span className="font-semibold text-foreground">
                    {oddsDecimal?.toFixed(2)}x
                  </span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Enter American odds to see the book&apos;s implied probability.
                </p>
              )}
              {error ? (
                <p className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {error}
                </p>
              ) : null}
            </div>
          </InputPanel>
        </section>

        {/* Results */}
        {loading && !result ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-muted/20 p-10 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="text-sm">
              Pricing your edge across 9 professional metrics…
            </p>
          </div>
        ) : null}

        {result && verdictStyle ? (
          <div className="space-y-8">
            {/* Hero dashboard */}
            <section
              aria-labelledby="hero-verdict"
              className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"
            >
              {/* Verdict card */}
              <div
                className={cn(
                  "relative overflow-hidden rounded-3xl border p-6",
                  verdictStyle.badgeBorder,
                  verdictStyle.badgeBg,
                )}
              >
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent"
                  aria-hidden
                />
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Verdict
                    </p>
                    <h2
                      id="hero-verdict"
                      className={cn(
                        "mt-1 text-4xl font-black leading-none md:text-5xl",
                        verdictStyle.badgeText,
                      )}
                    >
                      {verdictStyle.label}
                    </h2>
                    <p className="mt-2 max-w-lg text-sm text-foreground/80">
                      {verdictStyle.subtitle}
                    </p>
                  </div>
                  <verdictStyle.icon
                    className={cn("h-12 w-12 shrink-0", verdictStyle.badgeText)}
                  />
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <MiniStat
                    label="Fair win prob"
                    value={fmtPct(result.fairWinProbabilityPct)}
                    icon={Target}
                    tone="neutral"
                  />
                  <MiniStat
                    label="Edge vs book"
                    value={`${result.edgePct > 0 ? "+" : ""}${fmtPct(result.edgePct)}`}
                    icon={Scale}
                    tone={result.edgePct > 0 ? "positive" : "negative"}
                  />
                  <MiniStat
                    label="Composite"
                    value={`${result.compositeScore.toFixed(0)}/100`}
                    icon={Gauge}
                    tone="neutral"
                  />
                </div>

                <div className="mt-6">
                  <EdgeBar
                    fair={result.fairWinProbabilityPct}
                    book={result.bookImpliedProbabilityPct}
                  />
                </div>

                {result.verdictRationale ? (
                  <p className="mt-5 rounded-xl border border-border/40 bg-background/30 p-3 text-sm leading-relaxed text-foreground/90">
                    <span className="mr-2 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <Info className="h-3 w-3" /> Why
                    </span>
                    {result.verdictRationale}
                  </p>
                ) : null}
              </div>

              {/* Confidence + Kelly card */}
              <div className="rounded-3xl border border-border/60 bg-card/40 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Confidence
                    </p>
                    <p className="mt-1 text-sm text-foreground/80">
                      Calibrated 0–80 scale · capped when data is thin.
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "border border-border/40 bg-muted/40",
                      CONFIDENCE_BIN_STYLES[result.confidenceBin].tone,
                    )}
                  >
                    {CONFIDENCE_BIN_STYLES[result.confidenceBin].label}
                  </Badge>
                </div>

                <div className="mt-4 text-muted-foreground">
                  <ConfidenceGauge value={result.confidencePct} />
                </div>

                <div className="mt-2 rounded-xl border border-border/40 bg-background/40 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Kelly stake
                    </p>
                    <ShieldCheck className="h-4 w-4 text-muted-foreground/60" />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <KellyTile
                      label="Full"
                      value={fmtPct(result.kelly.fullPct, 2)}
                      sub="high variance"
                    />
                    <KellyTile
                      label="Half"
                      value={fmtPct(result.kelly.halfPct, 2)}
                      sub="recommended"
                      emphasis
                    />
                    <KellyTile
                      label="Quarter"
                      value={fmtPct(result.kelly.quarterPct, 2)}
                      sub="conservative"
                    />
                  </div>
                  {result.kelly.recommendedStakeUsd !== null ? (
                    <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2 text-sm">
                      <span className="font-medium text-emerald-700 dark:text-emerald-300">
                        Suggested stake (half Kelly)
                      </span>
                      <span className="font-black tabular-nums text-emerald-700 dark:text-emerald-300">
                        {fmt$(result.kelly.recommendedStakeUsd)}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-3 text-[11px] text-muted-foreground/80">
                      Add a bankroll above to see a dollar stake — we&apos;ll use
                      half-Kelly by default.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Metrics dashboard */}
            <section aria-labelledby="metrics-heading" className="space-y-4">
              <div className="flex items-center gap-2">
                <Radar className="h-5 w-5 text-amber-500" />
                <h2
                  id="metrics-heading"
                  className="text-lg font-bold tracking-tight"
                >
                  Metric breakdown
                </h2>
              </div>
              <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
                <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Nine-factor radar
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground/80">
                        Solid area = score for the pick. Dashed outline = data
                        quality.
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      0 – 10 scale
                    </span>
                  </div>
                  <div className="mt-3 flex justify-center text-muted-foreground">
                    <MetricRadar metrics={result.metrics} />
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      Score
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                      Data quality
                    </span>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {result.metrics.map((m) => (
                    <MetricCard key={m.key} metric={m} />
                  ))}
                </div>
              </div>
            </section>

            {/* Analyst summary */}
            <section
              aria-labelledby="summary-heading"
              className="rounded-2xl border border-border/60 bg-card/40 p-6"
            >
              <div className="flex items-center gap-2">
                <Telescope className="h-5 w-5 text-amber-500" />
                <h2
                  id="summary-heading"
                  className="text-lg font-bold tracking-tight"
                >
                  Analyst summary
                </h2>
              </div>
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-foreground/90">
                {result.summary.split(/\n\s*\n/).map((p, i) => (
                  <p key={i}>{p.trim()}</p>
                ))}
              </div>
            </section>

            {/* Risks + gaps */}
            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-500" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-300">
                    Key risks
                  </h2>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-foreground/90">
                  {result.risks.length === 0 ? (
                    <li className="text-muted-foreground">
                      No major risk flags identified.
                    </li>
                  ) : (
                    result.risks.map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                        <span>{r}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-5">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-violet-500" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                    Research before locking in
                  </h2>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-foreground/90">
                  {result.informationGaps.length === 0 ? (
                    <li className="text-muted-foreground">
                      No additional checks surfaced.
                    </li>
                  ) : (
                    result.informationGaps.map((g, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                        <span>{g}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </section>

            {/* Footer meta */}
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                Generated{" "}
                {new Date(result.generatedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
              {result.cost ? (
                <div className="flex items-center gap-3 tabular-nums">
                  <span>
                    {result.cost.inputTokens + result.cost.outputTokens} tokens
                  </span>
                  <span>·</span>
                  <span>
                    {fmt$(result.cost.totalCostUsd).replace("$", "$ ")}
                  </span>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {!result && !loading ? (
          <section
            aria-label="How it works"
            className="mt-4 grid gap-4 md:grid-cols-3"
          >
            <InfoTile
              icon={Target}
              title="Nine-metric framework"
              body="Form, injuries, H2H, travel, power ratings, line movement, weather, situational spots, and market value — the same factors pro capper rooms weigh before a bullet."
            />
            <InfoTile
              icon={Gauge}
              title="Calibrated confidence"
              body="Confidence is capped at 80 and tempered by data quality. Missing research quietly pulls the ceiling down — no false precision."
            />
            <InfoTile
              icon={ShieldCheck}
              title="Half-Kelly by default"
              body="We recommend half-Kelly sizing so you capture ~75% of the long-run growth with far less drawdown. Your bankroll, your rules."
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-300"
      : tone === "negative"
        ? "text-rose-600 dark:text-rose-300"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className={cn("mt-1 text-xl font-black tabular-nums", toneClass)}>
        {value}
      </p>
    </div>
  );
}

function KellyTile({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2",
        emphasis
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-border/40 bg-muted/30",
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-base font-black tabular-nums",
          emphasis ? "text-emerald-600 dark:text-emerald-300" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80">
        {sub}
      </p>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/40 p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-600/20 ring-1 ring-amber-500/20">
        <Icon className="h-5 w-5 text-amber-600 dark:text-amber-300" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
