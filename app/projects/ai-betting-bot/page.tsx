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
  History,
  Info,
  ListChecks,
  Loader2,
  RefreshCw,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
  Telescope,
  TrendingDown,
  TrendingUp,
  Trash2,
  Trophy,
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
  BarChart3,
  Bookmark,
  BookmarkCheck,
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
  type BettingRealData,
  type BettingRealDataTeam,
  type BettingStreamEvent,
  type BettingTrackContext,
  type CalibrationSummary,
  type ParsedOdds,
  type TrackedBetRow,
  type TrackedBetStatus,
} from "@/lib/betting-bot";
import { supabase } from "@/lib/supabase";

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
/** Dollar formatter that keeps precision for tiny OpenAI costs ($0.0023). */
function fmtCost(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return fmt$(n);
}
function fmtGameDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
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
  // Half-dial: the arc spans the UPPER semicircle and the needle pivots at
  // the bottom. This guarantees the needle always points upward, so the
  // label text positioned BELOW the pivot can never be crossed by the
  // needle — fixing the overlay we used to see at low confidence values.
  const startAngle = -90;
  const endAngle = 90;
  const span = endAngle - startAngle;
  const valueAngle = startAngle + (span * clamped) / 100;
  const cx = 110;
  const cy = 118;
  const r = 88;
  const colour =
    clamped >= 72
      ? "#10b981"
      : clamped >= 60
        ? "#22c55e"
        : clamped >= 48
          ? "#f59e0b"
          : "#94a3b8";

  return (
    <div className="relative mx-auto flex w-full max-w-[260px] flex-col items-center">
      <svg viewBox="0 0 220 170" className="w-full">
        <defs>
          <linearGradient id="gauge-fg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={colour} stopOpacity="0.75" />
            <stop offset="100%" stopColor={colour} />
          </linearGradient>
        </defs>
        <path
          d={arcPath(cx, cy, r, startAngle, endAngle)}
          stroke="currentColor"
          strokeOpacity="0.16"
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
              strokeOpacity={i % 5 === 0 ? 0.55 : 0.22}
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
          <circle cx={cx} cy={cy} r="6.5" fill={colour} />
        </g>
      </svg>
      {/* Label sits BELOW the dial (outside the needle's swept area) so the
          pointer and the numeric value can never overlay one another. */}
      <div className="-mt-2 flex flex-col items-center leading-none">
        <div className="flex items-baseline gap-1 text-foreground">
          <span style={{ fontSize: 42, fontWeight: 900, letterSpacing: -1 }}>
            {clamped.toFixed(0)}
          </span>
          <span
            className="text-muted-foreground"
            style={{ fontSize: 18, fontWeight: 700 }}
          >
            %
          </span>
        </div>
        <div
          className="mt-1 text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: 3, fontWeight: 700 }}
        >
          CONFIDENCE
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Real-data (ESPN) components                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function TeamHeader({
  team,
  side,
}: {
  team: BettingRealDataTeam;
  side: "Home" | "Away";
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-background/60 ring-1 ring-border/60">
        {team.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={team.logo}
            alt={team.displayName}
            className="h-9 w-9 object-contain"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-xs font-black text-muted-foreground">
            {team.abbreviation || "?"}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {side}
        </p>
        <p className="truncate text-sm font-bold text-foreground">
          {team.displayName}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {team.record ?? "record n/a"} · last-10{" "}
          <span className="font-mono font-semibold text-foreground/80">
            {team.last10Streak || "—"}
          </span>
        </p>
      </div>
    </div>
  );
}

function streakToColor(ch: string) {
  if (ch === "W") return "bg-emerald-500/80 text-white";
  if (ch === "L") return "bg-rose-500/80 text-white";
  if (ch === "T") return "bg-amber-500/80 text-white";
  return "bg-muted text-muted-foreground";
}

function FormStrip({ streak }: { streak: string }) {
  const chars = streak.padEnd(10, " ").slice(0, 10).split("");
  return (
    <div className="flex gap-1">
      {chars.map((c, i) => (
        <span
          key={i}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded text-[10px] font-black",
            streakToColor(c.trim()),
          )}
        >
          {c.trim() || "·"}
        </span>
      ))}
    </div>
  );
}

function InjuryList({
  team,
}: {
  team: BettingRealDataTeam;
}) {
  if (!team.injuries.length) {
    return (
      <p className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        No injuries listed.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {team.injuries.map((p) => {
        const status = p.status.toLowerCase();
        const toneBg =
          status.includes("out") || status.includes("ir") || status.includes("suspended")
            ? "bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/30"
            : status.includes("question") ||
                status.includes("probable") ||
                status.includes("doubt")
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
              : status.includes("day")
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                : "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30";
        return (
          <li
            key={p.name + p.status}
            className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-background/40 p-2.5"
          >
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border/50">
              {p.headshot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.headshot}
                  alt={p.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-muted-foreground">
                  {p.name
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-[13px] font-semibold text-foreground">
                  {p.name}
                </p>
                {p.position ? (
                  <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                    {p.position}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    toneBg,
                  )}
                >
                  {p.status}
                </span>
              </div>
              {p.detail ? (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {p.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RecentGamesList({ team }: { team: BettingRealDataTeam }) {
  if (!team.recentGames.length) {
    return (
      <p className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        No recent games found.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {team.recentGames.slice(0, 10).map((g) => {
        const tone =
          g.result === "W"
            ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/5"
            : g.result === "L"
              ? "text-rose-600 dark:text-rose-400 border-rose-500/40 bg-rose-500/5"
              : "text-muted-foreground border-border/40 bg-background/40";
        return (
          <li
            key={g.date + g.opponentAbbr}
            className={cn(
              "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]",
              tone,
            )}
          >
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-background/70 text-[9px] font-black ring-1 ring-border/40">
                {g.result ?? "·"}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {fmtGameDate(g.date)}
              </span>
              <span className="text-muted-foreground">
                {g.homeAway === "home" ? "vs" : "@"}
              </span>
              {g.opponentLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={g.opponentLogo}
                  alt={g.opponentName}
                  className="h-4 w-4 object-contain"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <span className="font-semibold">{g.opponentAbbr}</span>
            </span>
            <span className="font-mono tabular-nums">
              {g.teamScore ?? "–"}
              <span className="mx-0.5 text-muted-foreground">·</span>
              {g.oppScore ?? "–"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TeamDataPanel({
  team,
  side,
}: {
  team: BettingRealDataTeam;
  side: "Home" | "Away";
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/40 p-4">
      <TeamHeader team={team} side={side} />

      <div className="grid grid-cols-3 gap-2 rounded-xl border border-border/40 bg-background/40 p-3 text-center">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            L10
          </p>
          <p className="text-sm font-black tabular-nums">
            {team.wins10}-{team.losses10}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            For avg
          </p>
          <p className="text-sm font-black tabular-nums">
            {team.pointsForAvg ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            Allowed
          </p>
          <p className="text-sm font-black tabular-nums">
            {team.pointsAgainstAvg ?? "—"}
          </p>
        </div>
      </div>

      {/* Splits + rest + margin row — the pro-level signals. */}
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-border/40 bg-background/40 p-3 text-center">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            H/A split
          </p>
          <p className="text-xs font-black tabular-nums">
            {team.homeWins10}-{team.homeLosses10}{" "}
            <span className="text-muted-foreground">·</span>{" "}
            {team.awayWins10}-{team.awayLosses10}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            Margin
          </p>
          <p
            className={cn(
              "text-sm font-black tabular-nums",
              team.marginAvg == null
                ? "text-muted-foreground"
                : team.marginAvg > 0
                  ? "text-emerald-500"
                  : team.marginAvg < 0
                    ? "text-rose-500"
                    : "",
            )}
          >
            {team.marginAvg != null
              ? `${team.marginAvg > 0 ? "+" : ""}${team.marginAvg}`
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            Rest
          </p>
          <p
            className={cn(
              "text-sm font-black tabular-nums",
              team.restDays === 0
                ? "text-rose-500"
                : team.restDays != null && team.restDays >= 3
                  ? "text-emerald-500"
                  : "",
            )}
          >
            {team.restDays != null
              ? team.restDays === 0
                ? "B2B"
                : `${team.restDays}d`
              : "—"}
          </p>
        </div>
      </div>

      {team.style.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Season stats
          </p>
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border/40 bg-background/30 p-2 text-[11px]">
            {team.style.slice(0, 8).map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between gap-2 rounded-md bg-card/50 px-2 py-1"
              >
                <span className="truncate text-muted-foreground">
                  {s.label}
                </span>
                <span className="font-bold tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Last 10
        </p>
        <FormStrip streak={team.last10Streak} />
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Injuries
        </p>
        <InjuryList team={team} />
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Recent games
        </p>
        <RecentGamesList team={team} />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Head-to-head + market board                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function HeadToHeadPanel({
  data,
}: {
  data: BettingRealData;
}) {
  const h2h = data.headToHead;
  const homeName = data.homeTeam?.displayName ?? "";
  if (!h2h.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-5 text-sm text-muted-foreground">
        No recent head-to-head meetings found in the available ESPN schedule
        data. The model will treat the matchup with a neutral prior.
      </div>
    );
  }
  const homeWins = h2h.filter(
    (g) =>
      (g.winner === "home" && g.homeTeam === homeName) ||
      (g.winner === "away" && g.awayTeam === homeName),
  ).length;
  const homeAbbr = data.homeTeam?.abbreviation ?? "H";
  const awayAbbr = data.awayTeam?.abbreviation ?? "A";
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Head-to-head (last {h2h.length})
          </p>
          <p className="text-lg font-black tabular-nums">
            {homeAbbr}{" "}
            <span className="text-emerald-500">{homeWins}</span>
            <span className="mx-1 text-muted-foreground">·</span>
            <span className="text-rose-500">{h2h.length - homeWins}</span>{" "}
            {awayAbbr}
          </p>
        </div>
        <div className="text-right text-[10px] font-bold uppercase tracking-widest text-emerald-500/80">
          Verified · ESPN
        </div>
      </div>
      <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/40 bg-background/40 text-sm">
        {h2h.map((g, i) => {
          const winSide = g.winner;
          return (
            <li
              key={`${g.date}-${i}`}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2"
            >
              <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                {g.date.slice(0, 10)}
              </span>
              <span className="truncate">
                <span
                  className={cn(
                    "font-semibold",
                    winSide === "away" ? "text-emerald-500" : "",
                  )}
                >
                  {g.awayTeam}
                </span>{" "}
                <span className="tabular-nums">{g.awayScore ?? "?"}</span>{" "}
                <span className="text-muted-foreground">@</span>{" "}
                <span
                  className={cn(
                    "font-semibold",
                    winSide === "home" ? "text-emerald-500" : "",
                  )}
                >
                  {g.homeTeam}
                </span>{" "}
                <span className="tabular-nums">{g.homeScore ?? "?"}</span>
              </span>
              {g.venue && (
                <span className="truncate text-right text-[11px] text-muted-foreground">
                  {g.venue}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MarketBoardPanel({
  data,
  resultOdds,
  oddsSource,
}: {
  data: BettingRealData;
  resultOdds: ParsedOdds | null;
  oddsSource: BettingAnalysisResult["oddsSource"];
}) {
  const books = data.books;
  if (!books.length) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 text-sm">
        <p className="font-bold text-amber-600 dark:text-amber-400">
          No live market odds available
        </p>
        <p className="mt-1 text-muted-foreground">
          Add a free API key from{" "}
          <a
            href="https://the-odds-api.com/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            the-odds-api.com
          </a>{" "}
          as <code className="rounded bg-muted px-1 py-0.5 text-xs">
            ODDS_API_KEY
          </code>{" "}
          on Vercel to pull Ladbrokes / Neds / TAB prices (these share the
          Betcha feed because they&apos;re all Entain-owned).
        </p>
      </div>
    );
  }
  const entainCount = books.filter((b) => b.entainFamily).length;
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Market board
          </p>
          <p className="text-base font-bold">
            {books.length} book{books.length === 1 ? "" : "s"}
            {entainCount > 0 && (
              <span className="ml-2 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {entainCount} Entain (= Betcha)
              </span>
            )}
          </p>
        </div>
        {resultOdds && (
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {oddsSource === "user" ? "Your price" : "Auto-priced from"}
            </p>
            <p className="text-sm font-black tabular-nums">
              {resultOdds.decimal.toFixed(2)}
            </p>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border/40 text-left text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="py-2 pr-3 font-bold">Book</th>
              <th className="py-2 pr-3 text-right font-bold">ML H</th>
              <th className="py-2 pr-3 text-right font-bold">ML A</th>
              <th className="py-2 pr-3 text-right font-bold">Spread</th>
              <th className="py-2 pr-3 text-right font-bold">Total</th>
              <th className="py-2 text-right font-bold">O / U</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {books.map((b) => (
              <tr
                key={b.key}
                className={cn(
                  "tabular-nums",
                  b.entainFamily && "bg-emerald-500/5",
                )}
              >
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{b.provider}</span>
                    {b.entainFamily && (
                      <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                        Entain
                      </span>
                    )}
                    {!b.entainFamily && b.region !== "unknown" && (
                      <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                        {b.region}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-3 text-right">
                  {b.moneylineHome?.toFixed(2) ?? "—"}
                </td>
                <td className="py-2 pr-3 text-right">
                  {b.moneylineAway?.toFixed(2) ?? "—"}
                </td>
                <td className="py-2 pr-3 text-right">
                  {b.spreadPoint != null
                    ? `${b.spreadPoint > 0 ? "+" : ""}${b.spreadPoint}`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-right">
                  {b.total != null ? b.total : "—"}
                </td>
                <td className="py-2 text-right">
                  {b.overOdds != null || b.underOdds != null
                    ? `${b.overOdds?.toFixed(2) ?? "—"} / ${b.underOdds?.toFixed(2) ?? "—"}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entainCount === 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          No Entain-family books returned for this event. Prices shown are
          from alternative markets — verify on{" "}
          <a
            href="https://betcha.co.nz/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Betcha.co.nz
          </a>{" "}
          before placing.
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Tracked bets + calibration                                                */
/* ────────────────────────────────────────────────────────────────────────── */

const STATUS_STYLES: Record<
  TrackedBetStatus,
  { label: string; dot: string; pill: string }
> = {
  pending: {
    label: "Pending",
    dot: "bg-sky-500",
    pill: "bg-sky-500/10 text-sky-600 dark:text-sky-300 border-sky-500/30",
  },
  won: {
    label: "Won",
    dot: "bg-emerald-500",
    pill:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
  },
  lost: {
    label: "Lost",
    dot: "bg-rose-500",
    pill: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40",
  },
  push: {
    label: "Push",
    dot: "bg-amber-500",
    pill:
      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40",
  },
  void: {
    label: "Void",
    dot: "bg-slate-500",
    pill:
      "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/40",
  },
  needs_review: {
    label: "Needs review",
    dot: "bg-violet-500",
    pill:
      "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/40",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-muted-foreground/40",
    pill:
      "bg-muted/40 text-muted-foreground border-border/40",
  },
};

function fmtSigned(n: number | null, digits = 1, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(digits)}${suffix}`;
}

function CalibrationCard({ summary }: { summary: CalibrationSummary }) {
  const record = `${summary.wins}-${summary.losses}${summary.pushes ? `-${summary.pushes}` : ""}`;
  const roiTone =
    summary.roiPct == null
      ? "text-muted-foreground"
      : summary.roiPct > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : summary.roiPct < 0
          ? "text-rose-600 dark:text-rose-400"
          : "text-muted-foreground";

  return (
    <section className="rounded-3xl border border-border/60 bg-card/40 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-5 w-5 text-amber-500" />
        <h2 className="text-lg font-bold tracking-tight">
          My track record
        </h2>
        <span className="rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Self-calibration
        </span>
        {summary.pending > 0 ? (
          <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-300">
            {summary.pending} pending
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Settled
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {summary.settled}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {record} record
          </p>
        </div>
        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Win rate
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {summary.winRatePct == null
              ? "—"
              : `${summary.winRatePct.toFixed(1)}%`}
          </p>
          <p className="text-[11px] text-muted-foreground">
            excludes pushes
          </p>
        </div>
        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            ROI (1u flat)
          </p>
          <p className={cn("mt-1 text-2xl font-black tabular-nums", roiTone)}>
            {summary.roiPct == null
              ? "—"
              : `${summary.roiPct >= 0 ? "+" : ""}${summary.roiPct.toFixed(1)}%`}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {fmtSigned(summary.profitUnits, 2, "u")} net
          </p>
        </div>
        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Brier score
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {summary.brier == null ? "—" : summary.brier.toFixed(3)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            lower is better · calibration quality
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border/40">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                Confidence bin
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                Settled
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                Record
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                Win rate
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                ROI
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                Avg stated conf
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {summary.buckets.map((b) => (
              <tr
                key={b.bin}
                className={cn(
                  "tabular-nums",
                  b.settled === 0 && "opacity-50",
                )}
              >
                <td className="px-3 py-2 font-semibold capitalize">
                  {b.bin}
                </td>
                <td className="px-3 py-2 text-right">{b.settled}</td>
                <td className="px-3 py-2 text-right">
                  {b.wins}-{b.losses}
                  {b.pushes ? `-${b.pushes}` : ""}
                </td>
                <td className="px-3 py-2 text-right">
                  {b.winRatePct == null
                    ? "—"
                    : `${b.winRatePct.toFixed(1)}%`}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-semibold",
                    b.roiPct != null && b.roiPct > 0 && "text-emerald-600 dark:text-emerald-400",
                    b.roiPct != null && b.roiPct < 0 && "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {b.roiPct == null
                    ? "—"
                    : `${b.roiPct >= 0 ? "+" : ""}${b.roiPct.toFixed(1)}%`}
                </td>
                <td className="px-3 py-2 text-right">
                  {b.avgConfidence == null
                    ? "—"
                    : `${b.avgConfidence.toFixed(0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {summary.settled >= 3 ? (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          The bot reads this table on every new analysis and dials its own
          confidence up or down to match your actual hit rate per bin.
        </p>
      ) : (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Track at least 3 settled bets and the bot will start using this
          calibration to correct its own confidence.
        </p>
      )}
    </section>
  );
}

function BetHistoryRow({
  bet,
  busy,
  onRefresh,
  onGrade,
  onDelete,
}: {
  bet: TrackedBetRow;
  busy: boolean;
  onRefresh: (id: string) => void;
  onGrade: (id: string, outcome: TrackedBetStatus) => void;
  onDelete: (id: string) => void;
}) {
  const style = STATUS_STYLES[bet.status];
  const teams =
    bet.away_team_name && bet.home_team_name
      ? `${bet.away_team_name} @ ${bet.home_team_name}`
      : "(fixture not resolved)";
  const kickoffLabel = bet.kickoff
    ? new Date(bet.kickoff).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Kickoff tbd";
  const scoreLabel =
    bet.home_score != null && bet.away_score != null
      ? `${bet.away_score}–${bet.home_score}`
      : null;
  const oddsLabel = bet.odds_decimal
    ? `${bet.odds_decimal.toFixed(2)}x`
    : bet.odds_american
      ? `${bet.odds_american > 0 ? "+" : ""}${bet.odds_american}`
      : "no odds";
  const profitTone =
    bet.profit_units == null
      ? ""
      : bet.profit_units > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : bet.profit_units < 0
          ? "text-rose-600 dark:text-rose-400"
          : "text-muted-foreground";

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/40 p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              style.pill,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
            {style.label}
          </span>
          {bet.sport_label ? (
            <span className="rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {bet.sport_label}
            </span>
          ) : null}
          <span className="text-[11px] text-muted-foreground">
            {kickoffLabel}
          </span>
        </div>
        <p className="mt-1.5 truncate text-sm font-bold text-foreground">
          {bet.pick_summary}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {teams}
          {scoreLabel ? (
            <>
              {" · "}
              <span className="font-mono font-semibold text-foreground/80">
                {scoreLabel}
              </span>
            </>
          ) : null}
          {" · "}
          {bet.market_normalized}
          {" · "}
          <span className="font-mono">{oddsLabel}</span>
          {" · conf "}
          <span className="font-mono">
            {bet.confidence_pct.toFixed(0)}%
          </span>
          {bet.profit_units != null ? (
            <>
              {" · "}
              <span className={cn("font-mono font-semibold", profitTone)}>
                {bet.profit_units > 0 ? "+" : ""}
                {bet.profit_units.toFixed(2)}u
              </span>
            </>
          ) : null}
        </p>
        {bet.settlement_notes ? (
          <p className="mt-1 line-clamp-1 text-[11px] italic text-muted-foreground">
            {bet.settlement_notes}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(bet.status === "pending" || bet.status === "needs_review") &&
        bet.espn_event_id ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onRefresh(bet.id)}
            title="Re-check ESPN now"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", busy && "animate-spin")}
            />
            <span className="ml-1 hidden sm:inline">Refresh</span>
          </Button>
        ) : null}
        {bet.status === "pending" ||
        bet.status === "needs_review" ||
        bet.status === "lost" ||
        bet.status === "push" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onGrade(bet.id, "won")}
            className="text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
            title="Mark as won"
          >
            <Trophy className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">Won</span>
          </Button>
        ) : null}
        {bet.status === "pending" ||
        bet.status === "needs_review" ||
        bet.status === "won" ||
        bet.status === "push" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onGrade(bet.id, "lost")}
            className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
            title="Mark as lost"
          >
            <XCircle className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">Lost</span>
          </Button>
        ) : null}
        {bet.status !== "push" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onGrade(bet.id, "push")}
            className="text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400"
            title="Mark as push"
          >
            <CircleDot className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">Push</span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onDelete(bet.id)}
          className="text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
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

      {(() => {
        // Defensive guard: never render the "Fixture identified" card unless
        // we have two real team names. Filters the literal-"null" / "n/a"
        // strings some LLMs emit for unknown fields.
        const badStr = (s: string | null | undefined) =>
          !s ||
          /^(null|n\/a|na|none|tbd|tba|unknown|undefined)$/i.test(s.trim());
        if (!fixture || badStr(fixture.homeTeam) || badStr(fixture.awayTeam)) {
          return null;
        }
        const kickoffDate = fixture.kickoffIso
          ? new Date(fixture.kickoffIso)
          : null;
        const validKickoff =
          kickoffDate && !Number.isNaN(kickoffDate.getTime())
            ? kickoffDate
            : null;
        const cleanVenue = badStr(fixture.venue) ? null : fixture.venue;
        const cleanCompetition = badStr(fixture.competition)
          ? null
          : fixture.competition;
        return (
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
                  {cleanCompetition || "competition tbd"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                  {validKickoff ? (
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      {validKickoff.toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  ) : null}
                  {cleanVenue ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {cleanVenue}
                    </span>
                  ) : null}
                </div>
              </div>
              <Zap className="h-5 w-5 shrink-0 text-amber-500" />
            </div>
          </div>
        );
      })()}

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

  // Track-context sent alongside the "final" event so we can persist the
  // ESPN identifiers when the user clicks "Track this bet".
  const [trackCtx, setTrackCtx] = useState<BettingTrackContext | null>(null);
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const [tracking, setTracking] = useState<boolean>(false);

  // Bet history + calibration.
  const [bets, setBets] = useState<TrackedBetRow[]>([]);
  const [calibration, setCalibration] = useState<CalibrationSummary | null>(
    null,
  );
  const [betsLoading, setBetsLoading] = useState<boolean>(false);
  const [refreshingBetId, setRefreshingBetId] = useState<string | null>(null);

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
          setTrackCtx(ev.track);
          setTrackedId(null);
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
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      // Forward the user's Supabase session so the server can look up
      // their historical calibration and feed it into the prompt.
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }
      } catch {
        /* non-fatal — the endpoint works unauthenticated too */
      }
      // The browser's IANA timezone (e.g. "Pacific/Auckland") — the server
      // uses it so "today"/"tomorrow" mean the user's calendar day instead
      // of Vercel's UTC day.
      let tz: string | undefined;
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      } catch {
        tz = undefined;
      }
      const res = await fetch("/api/projects/ai-betting-bot", {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          odds: odds.trim() || undefined,
          bankroll: bankroll.trim() || undefined,
          notes: notes.trim() || undefined,
          timezone: tz,
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

  /** Returns `{ Authorization }` when the user is signed in — required for
   *  any /api/projects/ai-betting-bot/bets* call. */
  const authHeader = useCallback(async (): Promise<Record<string, string>> => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        return { Authorization: `Bearer ${session.access_token}` };
      }
    } catch {
      /* ignore */
    }
    return {};
  }, []);

  const refreshBets = useCallback(
    async (silent = false) => {
      if (!silent) setBetsLoading(true);
      try {
        const auth = await authHeader();
        if (!auth.Authorization) {
          setBets([]);
          setCalibration(null);
          return;
        }
        const res = await fetch("/api/projects/ai-betting-bot/bets", {
          headers: auth,
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          bets: TrackedBetRow[];
          calibration: CalibrationSummary;
        };
        setBets(data.bets ?? []);
        setCalibration(data.calibration ?? null);
      } finally {
        if (!silent) setBetsLoading(false);
      }
    },
    [authHeader],
  );

  // Initial load + re-load whenever an analysis finishes so the calibration
  // card always reflects the freshest numbers.
  useEffect(() => {
    void refreshBets(true);
  }, [refreshBets]);

  const trackCurrent = useCallback(async () => {
    if (!result || tracking) return;
    setTracking(true);
    try {
      const auth = await authHeader();
      if (!auth.Authorization) {
        addToast({
          variant: "error",
          title: "Sign in required",
          description: "You need to be signed in to save tracked bets.",
        });
        return;
      }
      const res = await fetch("/api/projects/ai-betting-bot/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          query,
          result,
          sportPath: trackCtx?.sportPath ?? null,
          espnEventId: trackCtx?.espnEventId ?? null,
          espnHomeTeamId: trackCtx?.espnHomeTeamId ?? null,
          espnAwayTeamId: trackCtx?.espnAwayTeamId ?? null,
          stakeUsd: result.kelly?.recommendedStakeUsd ?? null,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 200) || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { bet: TrackedBetRow };
      setTrackedId(data.bet.id);
      addToast({
        variant: "success",
        title: "Bet tracked",
        description:
          trackCtx?.espnEventId
            ? "I'll auto-settle this once the game ends."
            : "Saved. You can grade it manually when the result is in.",
      });
      await refreshBets(true);
    } catch (e) {
      addToast({
        variant: "error",
        title: "Couldn't track this bet",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTracking(false);
    }
  }, [
    result,
    tracking,
    authHeader,
    query,
    trackCtx,
    addToast,
    refreshBets,
  ]);

  const refreshSingleBet = useCallback(
    async (id: string) => {
      setRefreshingBetId(id);
      try {
        const auth = await authHeader();
        if (!auth.Authorization) return;
        const res = await fetch(
          `/api/projects/ai-betting-bot/bets/${id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...auth },
            body: JSON.stringify({ action: "settle" }),
          },
        );
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t.slice(0, 200) || `HTTP ${res.status}`);
        }
        await refreshBets(true);
      } catch (e) {
        addToast({
          variant: "error",
          title: "Refresh failed",
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setRefreshingBetId(null);
      }
    },
    [authHeader, refreshBets, addToast],
  );

  const gradeBet = useCallback(
    async (id: string, outcome: TrackedBetStatus) => {
      const auth = await authHeader();
      if (!auth.Authorization) return;
      try {
        const res = await fetch(
          `/api/projects/ai-betting-bot/bets/${id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...auth },
            body: JSON.stringify({ action: "grade", outcome }),
          },
        );
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t.slice(0, 200) || `HTTP ${res.status}`);
        }
        await refreshBets(true);
      } catch (e) {
        addToast({
          variant: "error",
          title: "Couldn't grade bet",
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [authHeader, refreshBets, addToast],
  );

  const deleteBet = useCallback(
    async (id: string) => {
      if (!confirm("Delete this tracked bet? This cannot be undone.")) return;
      const auth = await authHeader();
      if (!auth.Authorization) return;
      try {
        const res = await fetch(
          `/api/projects/ai-betting-bot/bets/${id}`,
          { method: "DELETE", headers: auth },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await refreshBets(true);
      } catch (e) {
        addToast({
          variant: "error",
          title: "Delete failed",
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [authHeader, refreshBets, addToast],
  );

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
                      {result.realData?.source === "espn" ? (
                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Verified · ESPN
                        </span>
                      ) : null}
                    </p>
                    <h2 className="mt-1 text-xl font-bold md:text-2xl">
                      {result.fixture.awayTeam} @ {result.fixture.homeTeam}
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
                      {result.oddsMissing ? (
                        <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                          odds needed
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {/* Missing-odds banner */}
            {result.oddsMissing ? (
              <section className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div className="min-w-0 space-y-1">
                  <p className="font-bold text-amber-800 dark:text-amber-200">
                    Add odds to price the edge
                  </p>
                  <p className="text-[13px] leading-relaxed text-amber-900/80 dark:text-amber-100/80">
                    Edge and Kelly stake can&apos;t be computed without a
                    concrete price. Check the exact line on{" "}
                    <a
                      href="https://betcha.co.nz"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold underline underline-offset-2"
                    >
                      betcha.co.nz
                    </a>
                    , then paste it into the Extras → Odds field above
                    (decimal works, e.g. <code>1.91</code>). The fair
                    probability, metrics and real-data panels below are
                    still accurate.
                  </p>
                </div>
              </section>
            ) : null}

            {/* Real data panels (ESPN-sourced) */}
            {result.realData?.source === "espn" &&
            (result.realData.homeTeam || result.realData.awayTeam) ? (
              <section aria-labelledby="real-data-heading" className="space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  <h2
                    id="real-data-heading"
                    className="text-lg font-bold tracking-tight"
                  >
                    Verified data · injuries, form & recent games
                  </h2>
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                    ESPN
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {result.realData.awayTeam ? (
                    <TeamDataPanel
                      team={result.realData.awayTeam}
                      side="Away"
                    />
                  ) : null}
                  {result.realData.homeTeam ? (
                    <TeamDataPanel
                      team={result.realData.homeTeam}
                      side="Home"
                    />
                  ) : null}
                </div>

                {/* Head-to-head history — grounds the "H2H" metric. */}
                <HeadToHeadPanel data={result.realData} />

                {/* Live market board from Entain-family (Betcha-equivalent)
                    and ESPN pickcenter — grounds the "Market trends" and
                    "Line value" metrics. */}
                <MarketBoardPanel
                  data={result.realData}
                  resultOdds={result.oddsUsed}
                  oddsSource={result.oddsSource}
                />
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
                  <div className="min-w-0">
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
                  <div className="flex flex-col items-end gap-3">
                    <verdictStyle.icon
                      className={cn(
                        "h-12 w-12 shrink-0",
                        verdictStyle.badgeText,
                      )}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant={trackedId ? "secondary" : "default"}
                      disabled={tracking}
                      onClick={() => void trackCurrent()}
                      className={cn(
                        "shrink-0",
                        trackedId &&
                          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
                      )}
                      title={
                        trackedId
                          ? "Tracked — view in My track record below"
                          : "Save this bet so the bot can auto-settle it later"
                      }
                    >
                      {tracking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : trackedId ? (
                        <BookmarkCheck className="h-4 w-4" />
                      ) : (
                        <Bookmark className="h-4 w-4" />
                      )}
                      <span className="ml-1.5">
                        {trackedId ? "Tracked" : "Track this bet"}
                      </span>
                    </Button>
                  </div>
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
                    value={
                      result.edgePct === null
                        ? "—"
                        : `${result.edgePct > 0 ? "+" : ""}${fmtPct(result.edgePct)}`
                    }
                    icon={Scale}
                    tone={
                      result.edgePct === null
                        ? "neutral"
                        : result.edgePct > 0
                          ? "positive"
                          : "negative"
                    }
                  />
                  <MiniStat
                    label="Composite"
                    value={`${result.compositeScore.toFixed(0)}/100`}
                    icon={Gauge}
                    tone="neutral"
                  />
                </div>

                {result.bookImpliedProbabilityPct !== null ? (
                  <div className="mt-6">
                    <EdgeBar
                      fair={result.fairWinProbabilityPct}
                      book={result.bookImpliedProbabilityPct}
                    />
                  </div>
                ) : (
                  <div className="mt-6 rounded-xl border border-dashed border-border/50 bg-background/30 p-3 text-[12px] text-muted-foreground">
                    Edge bar unlocks once you enter the book price. Fair win
                    probability is calculated from the metrics below.
                  </div>
                )}

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
                  {result.kelly ? (
                    <>
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
                    </>
                  ) : (
                    <p className="mt-3 rounded-lg border border-dashed border-border/50 bg-background/30 p-3 text-[11px] text-muted-foreground">
                      Stake sizing unlocks once you enter odds — Kelly needs a
                      concrete price.
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
                  <span>
                    {result.cost.totalTokens.toLocaleString()} tokens
                  </span>
                  <span>·</span>
                  <span title={`${result.cost.totalCostUsd.toFixed(6)} USD`}>
                    {fmtCost(result.cost.totalCostUsd)}
                  </span>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {/* Tracked bets + self-calibration — always visible when the user has any */}
        {(bets.length > 0 || betsLoading) ? (
          <div className="mt-10 space-y-6">
            {calibration ? <CalibrationCard summary={calibration} /> : null}
            <section aria-labelledby="my-bets-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-violet-500" />
                  <h2
                    id="my-bets-heading"
                    className="text-lg font-bold tracking-tight"
                  >
                    My tracked bets
                  </h2>
                  <span className="rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {bets.length}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void refreshBets(false)}
                  disabled={betsLoading}
                  title="Re-fetch and auto-settle any finished games"
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      betsLoading && "animate-spin",
                    )}
                  />
                  <span className="ml-1">Refresh</span>
                </Button>
              </div>
              {bets.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border/50 bg-background/30 p-6 text-center text-sm text-muted-foreground">
                  No tracked bets yet. Run an analysis and click{" "}
                  <span className="font-semibold">Track this bet</span>.
                </p>
              ) : (
                <ul className="space-y-2">
                  {bets.map((bet) => (
                    <BetHistoryRow
                      key={bet.id}
                      bet={bet}
                      busy={refreshingBetId === bet.id}
                      onRefresh={(id) => void refreshSingleBet(id)}
                      onGrade={(id, outcome) => void gradeBet(id, outcome)}
                      onDelete={(id) => void deleteBet(id)}
                    />
                  ))}
                </ul>
              )}
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
