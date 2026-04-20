"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Brain,
  CheckCircle2,
  CircleDot,
  Clock,
  DollarSign,
  Gauge,
  Info,
  ListChecks,
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
  AlertTriangle,
  Scale,
  Send,
  ChevronDown,
  ChevronUp,
  Zap,
  MapPin,
  CalendarClock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import {
  BETTING_STAGES,
  METRIC_FRAMEWORK,
  parseOdds,
  type BettingAnalysisResult,
  type BettingFixture,
  type BettingMetricScore,
  type BettingStreamEvent,
  type ParsedOdds,
} from "@/lib/betting-bot";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Formatting helpers                                                        */
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
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  strong_bet: {
    label: "Strong bet",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-600 dark:text-emerald-300",
    badgeBorder: "border-emerald-500/40",
    subtitle: "High edge + strong data quality. Fire at half-Kelly.",
    icon: CheckCircle2,
  },
  bet: {
    label: "Bet",
    badgeBg: "bg-emerald-500/10",
    badgeText: "text-emerald-600 dark:text-emerald-300",
    badgeBorder: "border-emerald-500/30",
    subtitle: "Positive edge with acceptable data. Size modestly.",
    icon: TrendingUp,
  },
  lean: {
    label: "Lean",
    badgeBg: "bg-amber-500/10",
    badgeText: "text-amber-600 dark:text-amber-300",
    badgeBorder: "border-amber-500/30",
    subtitle: "Slight edge — quarter-Kelly or pass if you need conviction.",
    icon: CircleDot,
  },
  pass: {
    label: "Pass",
    badgeBg: "bg-slate-500/10",
    badgeText: "text-slate-600 dark:text-slate-300",
    badgeBorder: "border-slate-500/30",
    subtitle: "No meaningful edge. Save the bullet.",
    icon: XCircle,
  },
  fade: {
    label: "Fade",
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
/*  SVG primitives                                                            */
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
      <polygon
        points={pointsFor(confidenceValues)}
        fill="rgb(139, 92, 246)"
        fillOpacity={0.08}
        stroke="rgb(139, 92, 246)"
        strokeOpacity={0.4}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <polygon
        points={pointsFor(scoreValues)}
        fill="rgb(16, 185, 129)"
        fillOpacity={0.2}
        stroke="rgb(16, 185, 129)"
        strokeWidth={2}
      />
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

function EdgeBar({ fair, book }: { fair: number; book: number }) {
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
/*  Live "thinking" panel                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

type StageState = {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
  thoughts: string[];
};

function buildInitialStages(): StageState[] {
  return BETTING_STAGES.map((s) => ({
    id: s.id,
    label: s.label,
    status: "pending" as const,
    thoughts: [],
  }));
}

function ThinkingPanel({
  stages,
  fixture,
  streaming,
}: {
  stages: StageState[];
  fixture: BettingFixture | null;
  streaming: boolean;
}) {
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [stages]);

  const active = stages.find((s) => s.status === "running");

  return (
    <div className="rounded-3xl border border-border/60 bg-card/40 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Brain className="h-5 w-5 text-amber-500" />
            {streaming ? (
              <span className="absolute -right-1 -top-1 h-2 w-2 animate-ping rounded-full bg-amber-500" />
            ) : null}
          </div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            AI thinking
          </h2>
        </div>
        {streaming ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-300">
            <Loader2 className="h-3 w-3 animate-spin" />
            {active?.label ?? "working"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            complete
          </span>
        )}
      </div>

      {fixture && (fixture.homeTeam || fixture.awayTeam) ? (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                Fixture identified
              </p>
              <p className="mt-0.5 truncate text-sm font-bold text-foreground">
                {fixture.homeTeam} vs {fixture.awayTeam}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {fixture.competition || "competition tbd"}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                {fixture.kickoffIso ? (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" />
                    {new Date(fixture.kickoffIso).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                ) : null}
                {fixture.venue ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {fixture.venue}
                  </span>
                ) : null}
              </div>
            </div>
            <Zap className="h-5 w-5 shrink-0 text-amber-500" />
          </div>
        </div>
      ) : null}

      <div
        ref={logRef}
        className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-2"
      >
        {stages.map((s) => {
          const idx = BETTING_STAGES.findIndex((b) => b.id === s.id);
          return (
            <div key={s.id} className="relative pl-7">
              <span
                className={cn(
                  "absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold",
                  s.status === "done" &&
                    "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                  s.status === "running" &&
                    "border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-300",
                  s.status === "pending" &&
                    "border-border/50 bg-muted/30 text-muted-foreground/60",
                )}
              >
                {s.status === "done" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : s.status === "running" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  idx + 1
                )}
              </span>
              <p
                className={cn(
                  "text-[11px] font-bold uppercase tracking-wider",
                  s.status === "pending"
                    ? "text-muted-foreground/50"
                    : s.status === "done"
                      ? "text-muted-foreground"
                      : "text-foreground",
                )}
              >
                {s.label}
              </p>
              {s.thoughts.length > 0 ? (
                <ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-foreground/80">
                  {s.thoughts.map((t, i) => (
                    <li
                      key={i}
                      className="flex gap-2 rounded-md bg-muted/30 px-2 py-1"
                    >
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500/70" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              ) : s.status === "running" ? (
                <p className="mt-1 text-[11px] italic text-muted-foreground/70">
                  researching…
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Dashboard atoms                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

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
            <p className="truncate text-sm font-semibold text-foreground">
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
              "text-xl font-black leading-none tabular-nums",
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

/* ────────────────────────────────────────────────────────────────────────── */
/*  Page                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

const EXAMPLE_PROMPTS = [
  "Arsenal over 2.5 goals vs Chelsea tomorrow",
  "Lakers -4.5 vs Nuggets tonight",
  "Man City & Liverpool both to score Saturday",
  "Over 9.5 corners Real Madrid vs Barcelona",
  "Djokovic to win in straight sets at the Australian Open final",
];

export default function AiBettingBotPage() {
  const { addToast } = useToast();

  const [query, setQuery] = useState<string>("");
  const [odds, setOdds] = useState<string>("");
  const [bankroll, setBankroll] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [optionsOpen, setOptionsOpen] = useState<boolean>(false);

  const [stages, setStages] = useState<StageState[]>(buildInitialStages);
  const [fixture, setFixture] = useState<BettingFixture | null>(null);
  const [streaming, setStreaming] = useState<boolean>(false);
  const [result, setResult] = useState<BettingAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const oddsParsed: ParsedOdds | null = useMemo(
    () => (odds.trim() ? parseOdds(odds) : null),
    [odds],
  );
  const oddsInvalid = odds.trim().length > 0 && oddsParsed === null;

  const canSubmit = query.trim().length >= 3 && !streaming && !oddsInvalid;

  const resetForRun = useCallback(() => {
    setStages(buildInitialStages());
    setFixture(null);
    setResult(null);
    setError(null);
  }, []);

  const handleStreamEvent = useCallback(
    (ev: BettingStreamEvent) => {
      switch (ev.type) {
        case "stage":
          setStages((prev) => {
            const idx = prev.findIndex((s) => s.id === ev.stage);
            if (idx === -1) {
              // Unknown stage – append.
              return [
                ...prev,
                {
                  id: ev.stage,
                  label: ev.label,
                  status: ev.status,
                  thoughts: [],
                },
              ];
            }
            const next = prev.slice();
            next[idx] = { ...next[idx]!, status: ev.status, label: ev.label };
            return next;
          });
          return;
        case "thought":
          setStages((prev) => {
            const idx = prev.findIndex((s) => s.id === ev.stage);
            if (idx === -1) {
              return [
                ...prev,
                {
                  id: ev.stage,
                  label: ev.stage,
                  status: "running",
                  thoughts: [ev.text],
                },
              ];
            }
            const next = prev.slice();
            const s = next[idx]!;
            next[idx] = { ...s, thoughts: [...s.thoughts, ev.text] };
            return next;
          });
          return;
        case "fixture":
          setFixture(ev.fixture);
          return;
        case "final":
          setResult(ev.result);
          return;
        case "error":
          setError(ev.message);
          addToast({
            variant: "error",
            title: "Analysis failed",
            description: ev.message.slice(0, 180),
          });
          return;
        case "done":
          setStreaming(false);
          return;
      }
    },
    [addToast],
  );

  const runAnalysis = useCallback(async () => {
    if (!canSubmit) return;
    resetForRun();
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/projects/ai-betting-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          odds: odds.trim() || undefined,
          bankroll: bankroll.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = `Request failed with ${res.status}`;
        try {
          const j = JSON.parse(text) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          if (text) msg = text.slice(0, 200);
        }
        setError(msg);
        addToast({ variant: "error", title: "Analysis failed", description: msg });
        setStreaming(false);
        return;
      }

      if (!res.body) {
        setError("No response body from server.");
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload) as BettingStreamEvent;
            handleStreamEvent(parsed);
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") {
        setError("Cancelled.");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        addToast({ variant: "error", title: "Network error", description: msg });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [canSubmit, resetForRun, query, odds, bankroll, notes, addToast, handleStreamEvent]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const verdictStyle = result ? VERDICT_STYLES[result.verdict] : null;
  const showThinking = streaming || (stages.some((s) => s.status !== "pending") && !result);

  return (
    <div className="relative overflow-hidden pb-16">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-24 top-24 -z-10 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl dark:bg-amber-400/10" />
      <div className="pointer-events-none absolute -left-24 bottom-0 -z-10 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl dark:bg-rose-400/10" />

      <div className="container mx-auto max-w-6xl px-4 py-10 md:py-12">
        <header className="mb-8 md:mb-10">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All projects
          </Link>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                <Bot className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                AI Betting Bot · Conversational analyst
              </div>
              <h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
                Just describe the bet. The bot does the research.
              </h1>
              <p className="mt-3 max-w-2xl text-base text-muted-foreground">
                Drop a bet in plain English — &ldquo;Arsenal over 2.5 goals
                tomorrow&rdquo; is enough. The analyst identifies the fixture,
                checks form, injuries, H2H, market trends and price value, then
                returns a calibrated confidence with a half-Kelly stake. Prices
                assume Betcha.co.nz-level lines — verify before you place.
              </p>
            </div>
            <div className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 ring-1 ring-amber-500/30 md:flex">
              <Brain className="h-8 w-8 text-amber-600 dark:text-amber-300" />
            </div>
          </div>
        </header>

        {/* Chat composer */}
        <section className="mb-8">
          <div className="rounded-3xl border border-border/60 bg-card/40 p-5 shadow-sm md:p-6">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Describe the bet
              </h2>
            </div>

            <div className="mt-3">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void runAnalysis();
                  }
                }}
                rows={3}
                disabled={streaming}
                placeholder="e.g. Arsenal over 2.5 goals vs Chelsea tomorrow, or LeBron under 24.5 points Friday"
                className="w-full resize-none rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-[15px] font-medium text-foreground placeholder:text-muted-foreground/70 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-60"
              />
            </div>

            {query.trim().length === 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setQuery(p)}
                    className="rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-700 dark:hover:text-amber-300"
                  >
                    {p}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setOptionsOpen((o) => !o)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                {optionsOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                Extras (odds, bankroll, your notes)
              </button>
              {optionsOpen ? (
                <div className="mt-3 grid gap-3 rounded-2xl border border-border/50 bg-muted/20 p-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="odds"
                      className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      Odds (decimal or American)
                    </Label>
                    <div className="relative">
                      <Input
                        id="odds"
                        value={odds}
                        onChange={(e) => setOdds(e.target.value)}
                        placeholder="1.91  or  -110"
                        disabled={streaming}
                        className={cn(
                          "h-10 bg-background/60 pr-28",
                          oddsInvalid && "border-rose-500/50",
                        )}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60">
                        {oddsParsed
                          ? `${oddsParsed.impliedPct.toFixed(1)}% · ${oddsParsed.decimal.toFixed(2)}x`
                          : oddsInvalid
                            ? "invalid"
                            : "auto"}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70">
                      Leave blank to let the bot estimate from betcha.co.nz-style
                      lines.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="bankroll"
                      className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      Bankroll (optional)
                    </Label>
                    <div className="relative">
                      <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                      <Input
                        id="bankroll"
                        value={bankroll}
                        onChange={(e) => setBankroll(e.target.value)}
                        placeholder="1000"
                        disabled={streaming}
                        inputMode="decimal"
                        className="h-10 bg-background/60 pl-8"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground/70">
                      Used to compute a dollar half-Kelly stake.
                    </p>
                  </div>
                  <div className="space-y-1.5 md:col-span-1">
                    <Label
                      htmlFor="notes"
                      className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      Your notes (optional)
                    </Label>
                    <textarea
                      id="notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      disabled={streaming}
                      rows={3}
                      placeholder="Any context the bot should know — injuries, line moves, insider info, tactical reads…"
                      className="w-full resize-none rounded-md border border-border/60 bg-background/60 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {streaming ? (
                <Button
                  onClick={cancel}
                  variant="outline"
                  className="h-11 gap-2"
                >
                  <XCircle className="h-4 w-4" /> Stop
                </Button>
              ) : (
                <Button
                  onClick={() => void runAnalysis()}
                  disabled={!canSubmit}
                  className="h-11 gap-2 bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/20 hover:from-amber-500/90 hover:to-orange-500/90"
                >
                  <Send className="h-4 w-4" /> Analyse this bet
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground/80">
                Tip: press{" "}
                <kbd className="rounded border border-border/60 bg-background/60 px-1 py-0.5 text-[10px] font-semibold">
                  Ctrl/⌘ + ↵
                </kbd>{" "}
                to run.
              </span>
              {error && !streaming ? (
                <p className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {error.slice(0, 180)}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {/* Live thinking */}
        {showThinking ? (
          <section className="mb-8">
            <ThinkingPanel
              stages={stages}
              fixture={fixture}
              streaming={streaming}
            />
          </section>
        ) : null}

        {/* Dashboard */}
        {result && verdictStyle ? (
          <div className="space-y-8">
            {/* Fixture header */}
            {result.fixture && result.fixture.homeTeam ? (
              <section className="rounded-3xl border border-border/60 bg-card/40 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Fixture
                    </p>
                    <h2 className="mt-1 text-xl font-bold md:text-2xl">
                      {result.fixture.homeTeam} vs {result.fixture.awayTeam}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {result.fixture.competition}
                      {result.fixture.venue ? ` · ${result.fixture.venue}` : ""}
                      {result.fixture.kickoffIso
                        ? ` · ${new Date(result.fixture.kickoffIso).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end text-right">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Pick
                    </p>
                    <p className="mt-1 max-w-[280px] text-sm font-semibold text-foreground">
                      {result.pickSummary}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {result.marketNormalized}
                      {result.oddsUsed
                        ? ` · ${result.oddsUsed.decimal.toFixed(2)}x (${
                            result.oddsUsed.american > 0 ? "+" : ""
                          }${result.oddsUsed.american})`
                        : ""}
                      {result.oddsSource === "estimated-market" ? (
                        <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                          est · verify on betcha.co.nz
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {/* Hero verdict */}
            <section
              aria-labelledby="hero-verdict"
              className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"
            >
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
                      Add a bankroll above to see a dollar stake — we&apos;ll
                      use half-Kelly by default.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Metrics */}
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
                  <span>{result.cost.totalTokens} tokens</span>
                  <span>·</span>
                  <span>{fmt$(result.cost.totalCostUsd)}</span>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {/* Primer tiles when idle */}
        {!result && !streaming && !stages.some((s) => s.status !== "pending") ? (
          <section
            aria-label="How it works"
            className="mt-6 grid gap-4 md:grid-cols-3"
          >
            <InfoTile
              icon={Sparkles}
              title="One-line input"
              body="Describe the bet however you'd say it out loud. The bot resolves the teams, date, market and line — no dropdown archaeology."
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
