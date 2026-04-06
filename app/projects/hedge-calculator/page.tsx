"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Plus, Trash2, TrendingUp, RefreshCw,
  Calculator, Shuffle, BarChart3, Target, DollarSign,
  TrendingDown, CheckCircle2, XCircle, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ─── Math / utils ────────────────────────────────────────────────────────────

function americanToDecimal(n: number): number {
  return n >= 100 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
function decimalToAmerican(d: number): number {
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function decimalToFractional(d: number): string {
  const diff = d - 1;
  if (diff <= 0) return "0/1";
  const P = 1000;
  let num = Math.round(diff * P), den = P;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(num, den); num /= g; den /= g;
  return `${num}/${den}`;
}
function fractionalToDecimal(frac: string): number | null {
  const p = frac.replace(/\s/g, "").split("/");
  if (p.length !== 2) return null;
  const n = parseFloat(p[0]), d = parseFloat(p[1]);
  if (isNaN(n) || isNaN(d) || d === 0) return null;
  return n / d + 1;
}
function impliedProb(dec: number): number { return (1 / dec) * 100; }
function fmt$(n: number): string {
  const abs = Math.abs(n);
  const s = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(abs);
  return n < 0 ? `-${s}` : s;
}
function fmtPct(n: number, d = 1): string { return `${n.toFixed(d)}%`; }

type OddsMode = "american" | "decimal";

function parseOdds(v: string, mode: OddsMode): number | null {
  const n = parseFloat(v);
  if (isNaN(n)) return null;
  if (mode === "american") {
    if (n === 0 || (n > 0 && n < 100)) return null;
    return americanToDecimal(n);
  }
  return n > 1 ? n : null;
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function MoneyInput({ id, label, value, onChange, placeholder = "100" }: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="relative">
        <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-8 h-11 bg-background/60 border-border/60 focus:border-emerald-500/50 focus:ring-emerald-500/20 text-base font-medium transition-colors" />
      </div>
    </div>
  );
}

function OddsInput({ id, label, value, onChange, mode, placeholder }: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; mode: OddsMode; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? (mode === "american" ? "-110" : "1.91")}
          className="pr-14 h-11 bg-background/60 border-border/60 focus:border-violet-500/50 focus:ring-violet-500/20 text-base font-medium transition-colors" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold tracking-wide uppercase text-muted-foreground/50">
          {mode === "american" ? "US" : "DEC"}
        </span>
      </div>
    </div>
  );
}

function PctInput({ id, label, value, onChange, placeholder = "55" }: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-8 h-11 bg-background/60 border-border/60 focus:border-violet-500/50 text-base font-medium transition-colors" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground/50">%</span>
      </div>
    </div>
  );
}

function InputPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-muted/20 p-5 space-y-4">
      {children}
    </div>
  );
}

function ResultsPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border/40 bg-gradient-to-br from-background to-muted/20 overflow-hidden", className)}>
      {children}
    </div>
  );
}

type Sentiment = "positive" | "negative" | "neutral" | "warning";

function StatRow({ label, value, sub, sentiment = "neutral", hero }: {
  label: string; value: string; sub?: string;
  sentiment?: Sentiment; hero?: boolean;
}) {
  const colors: Record<Sentiment, string> = {
    positive: "text-emerald-600 dark:text-emerald-400",
    negative: "text-red-500 dark:text-red-400",
    neutral: "text-foreground",
    warning: "text-amber-600 dark:text-amber-400",
  };
  const bg: Record<Sentiment, string> = {
    positive: "bg-emerald-500/8 border-emerald-500/15",
    negative: "bg-red-500/8 border-red-500/15",
    neutral: "bg-transparent border-border/30",
    warning: "bg-amber-500/8 border-amber-500/15",
  };
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b px-5 py-3.5 last:border-b-0", bg[sentiment])}>
      <div className="min-w-0">
        <p className={cn("text-sm font-medium leading-snug", sentiment !== "neutral" ? colors[sentiment] : "text-muted-foreground")}>{label}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground/70 leading-tight">{sub}</p>}
      </div>
      <p className={cn("shrink-0 tabular-nums font-bold text-right leading-snug", colors[sentiment], hero ? "text-xl" : "text-base")}>
        {value}
      </p>
    </div>
  );
}

function OutcomeCard({ label, profit, sub }: { label: string; profit: number; sub: string }) {
  const pos = profit > 0;
  return (
    <div className={cn(
      "flex-1 rounded-xl border p-4 text-center space-y-1",
      pos ? "bg-emerald-500/10 border-emerald-500/20" : "bg-red-500/10 border-red-500/20"
    )}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-black tabular-nums", pos ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400")}>
        {pos ? "+" : ""}{fmt$(profit)}
      </p>
      <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p>
    </div>
  );
}

function StatusBadge({ positive, label }: { positive: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
      positive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-red-500/15 text-red-700 dark:text-red-400"
    )}>
      {positive ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center text-muted-foreground">
      <div className="rounded-full border-2 border-dashed border-border/40 p-4">
        <Calculator className="h-6 w-6 opacity-30" />
      </div>
      <p className="text-sm max-w-[22ch]">{text}</p>
    </div>
  );
}

function Warning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3">
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
      <p className="text-sm text-red-700 dark:text-red-400 leading-relaxed">{text}</p>
    </div>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
      <span className="font-semibold text-foreground">Tip — </span>{text}
    </div>
  );
}

// ─── Tool nav ─────────────────────────────────────────────────────────────────

const TOOLS = [
  { id: "hedge",     label: "Hedge",      icon: TrendingUp  },
  { id: "convert",   label: "Converter",  icon: Shuffle     },
  { id: "ev",        label: "EV",         icon: BarChart3   },
  { id: "kelly",     label: "Kelly",      icon: Target      },
  { id: "parlay",    label: "Parlay",     icon: Calculator  },
  { id: "breakeven", label: "Break-even", icon: RefreshCw   },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

// ─── Hedge Calculator ─────────────────────────────────────────────────────────

function HedgeCalculator({ mode }: { mode: OddsMode }) {
  const [origStake, setOrigStake] = useState("");
  const [origOdds, setOrigOdds]   = useState("");
  const [hedgeOdds, setHedgeOdds] = useState("");

  const origDec  = parseOdds(origOdds, mode);
  const hedgeDec = parseOdds(hedgeOdds, mode);
  const stake    = parseFloat(origStake);
  const valid    = origDec !== null && hedgeDec !== null && stake > 0;

  let res: { hedgeStake: number; profitIfOrig: number; profitIfHedge: number; totalRisk: number; roi: number } | null = null;
  if (valid) {
    const origPayout  = stake * origDec!;
    const hedgeStake  = origPayout / hedgeDec!;
    const profitIfOrig  = origPayout - stake - hedgeStake;
    const profitIfHedge = hedgeStake * hedgeDec! - hedgeStake - stake;
    const guarProfit  = Math.min(profitIfOrig, profitIfHedge);
    res = { hedgeStake, profitIfOrig, profitIfHedge, totalRisk: stake + hedgeStake, roi: (guarProfit / (stake + hedgeStake)) * 100 };
  }
  const guaranteed = res ? Math.min(res.profitIfOrig, res.profitIfHedge) : null;
  const isProfit = guaranteed !== null && guaranteed > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Hedge Calculator</h2>
        <p className="text-sm text-muted-foreground mt-1">Lock in guaranteed profit by betting both sides with optimal stakes.</p>
      </div>

      <InputPanel>
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyInput id="orig-stake" label="Original stake" value={origStake} onChange={setOrigStake} />
          <OddsInput  id="orig-odds"  label="Original odds"  value={origOdds}  onChange={setOrigOdds}  mode={mode} placeholder={mode === "american" ? "+200" : "3.00"} />
          <OddsInput  id="hedge-odds" label="Hedge odds"     value={hedgeOdds} onChange={setHedgeOdds} mode={mode} placeholder={mode === "american" ? "-150" : "1.67"} />
        </div>
      </InputPanel>

      {res ? (
        <div className="space-y-4">
          {/* Outcome cards */}
          <div className="flex gap-3">
            <OutcomeCard label="If original wins" profit={res.profitIfOrig} sub="Net after both stakes" />
            <OutcomeCard label="If hedge wins"    profit={res.profitIfHedge} sub="Net after both stakes" />
          </div>

          {/* Guaranteed summary */}
          <div className={cn(
            "rounded-2xl border p-5 text-center",
            isProfit ? "bg-emerald-500/10 border-emerald-500/25" : "bg-red-500/10 border-red-500/25"
          )}>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Guaranteed profit</p>
            <p className={cn("text-4xl font-black tabular-nums", isProfit ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400")}>
              {isProfit ? "+" : ""}{fmt$(guaranteed!)}
            </p>
            <p className={cn("text-sm mt-1 font-semibold", isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
              {fmtPct(res.roi)} ROI · no matter the result
            </p>
          </div>

          <ResultsPanel>
            <StatRow label="Hedge stake to place" value={fmt$(res.hedgeStake)} sub="Bet this amount on the opposing outcome" sentiment="neutral" hero />
            <StatRow label="Total money at risk"  value={fmt$(res.totalRisk)} sentiment="neutral" />
          </ResultsPanel>

          {!isProfit && (
            <Warning text="These odds don't produce a guaranteed profit — both payouts must exceed the total combined stake. Try better odds on the hedge." />
          )}
        </div>
      ) : (
        <EmptyState text="Enter your original stake and both sets of odds to calculate." />
      )}
    </div>
  );
}

// ─── Odds Converter ───────────────────────────────────────────────────────────

function OddsConverter() {
  const [american,    setAmerican]    = useState("");
  const [decimal,     setDecimal]     = useState("");
  const [fractional,  setFractional]  = useState("");

  const syncAm  = (v: string) => { setAmerican(v); const n = parseFloat(v); if (!isNaN(n) && (n >= 100 || n <= -100)) { const d = americanToDecimal(n); setDecimal(d.toFixed(3)); setFractional(decimalToFractional(d)); } else { setDecimal(""); setFractional(""); } };
  const syncDec = (v: string) => { setDecimal(v); const n = parseFloat(v); if (!isNaN(n) && n > 1) { setAmerican(String(decimalToAmerican(n))); setFractional(decimalToFractional(n)); } else { setAmerican(""); setFractional(""); } };
  const syncFrac = (v: string) => { setFractional(v); const d = fractionalToDecimal(v); if (d && d > 1) { setDecimal(d.toFixed(3)); setAmerican(String(decimalToAmerican(d))); } else { setAmerican(""); setDecimal(""); } };

  const decNum = parseFloat(decimal);
  const prob   = !isNaN(decNum) && decNum > 1 ? impliedProb(decNum) : null;
  const margin = prob !== null ? prob - 50 : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Odds Converter</h2>
        <p className="text-sm text-muted-foreground mt-1">Type any format — the others sync instantly.</p>
      </div>

      <InputPanel>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { id: "am-c",   label: "American (+/-)", value: american,   fn: syncAm,   ph: "-110"  },
            { id: "dec-c",  label: "Decimal",        value: decimal,    fn: syncDec,  ph: "1.909" },
            { id: "frac-c", label: "Fractional",     value: fractional, fn: syncFrac, ph: "10/11" },
          ].map(({ id, label, value, fn, ph }) => (
            <div key={id} className="space-y-1.5">
              <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
              <Input id={id} value={value} onChange={(e) => fn(e.target.value)} placeholder={ph}
                className="h-11 bg-background/60 border-border/60 text-base font-medium text-center" />
            </div>
          ))}
        </div>
      </InputPanel>

      {prob !== null ? (
        <div className="space-y-4">
          {/* Visual probability bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground font-medium">
              <span>Implied probability</span>
              <span className="font-bold text-foreground">{fmtPct(prob)}</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
                style={{ width: `${Math.min(prob, 100)}%` }}
              />
            </div>
          </div>

          <ResultsPanel>
            <StatRow label="Implied probability" value={fmtPct(prob)} sub="Probability priced in by the bookmaker" sentiment="neutral" hero />
            <StatRow label="Vig above break-even (50%)" value={`+${fmtPct(margin!)}`} sub="Extra margin the book builds in on a coin-flip" sentiment={margin! > 5 ? "negative" : "neutral"} />
          </ResultsPanel>

          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: "American", value: american || "—", color: "text-blue-600 dark:text-blue-400" },
              { label: "Decimal",  value: decimal   || "—", color: "text-violet-600 dark:text-violet-400" },
              { label: "Fractional", value: fractional || "—", color: "text-amber-600 dark:text-amber-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl border border-border/40 bg-muted/20 py-3 px-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
                <p className={cn("text-lg font-bold tabular-nums mt-1", color)}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState text="Enter odds in any format above." />
      )}

      <div className="grid gap-2 rounded-xl border border-border/30 bg-muted/20 p-4 text-xs text-muted-foreground">
        <p><strong className="text-foreground">American:</strong> +150 = $150 profit on $100. -150 = stake $150 to profit $100.</p>
        <p><strong className="text-foreground">Decimal:</strong> Return per $1 staked (stake included). Always &gt; 1.</p>
        <p><strong className="text-foreground">Fractional:</strong> 5/2 = profit $5 per $2 staked.</p>
      </div>
    </div>
  );
}

// ─── EV Calculator ────────────────────────────────────────────────────────────

function EVCalculator({ mode }: { mode: OddsMode }) {
  const [stake,   setStake]   = useState("");
  const [odds,    setOdds]    = useState("");
  const [winProb, setWinProb] = useState("");

  const decOdds  = parseOdds(odds, mode);
  const stakeNum = parseFloat(stake);
  const probNum  = parseFloat(winProb) / 100;
  const valid    = decOdds !== null && stakeNum > 0 && probNum > 0 && probNum < 1;

  let ev: number | null = null, evPct: number | null = null,
      bookProb: number | null = null, edge: number | null = null;
  if (valid) {
    const profit = stakeNum * (decOdds! - 1);
    ev       = probNum * profit - (1 - probNum) * stakeNum;
    evPct    = (ev / stakeNum) * 100;
    bookProb = impliedProb(decOdds!);
    edge     = probNum * 100 - bookProb;
  }

  const isPositive = ev !== null && ev > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Expected Value (EV)</h2>
        <p className="text-sm text-muted-foreground mt-1">Find out if a bet is profitable long-term based on your assessed probability.</p>
      </div>

      <InputPanel>
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyInput id="ev-stake" label="Stake"           value={stake}   onChange={setStake} />
          <OddsInput  id="ev-odds"  label="Bet odds"        value={odds}    onChange={setOdds}    mode={mode} />
          <PctInput   id="ev-prob"  label="Your win prob %" value={winProb} onChange={setWinProb} />
        </div>
      </InputPanel>

      {valid && ev !== null ? (
        <div className="space-y-4">
          {/* Hero EV card */}
          <div className={cn(
            "rounded-2xl border p-5 text-center",
            isPositive ? "bg-emerald-500/10 border-emerald-500/25" : "bg-red-500/10 border-red-500/25"
          )}>
            <div className="flex items-center justify-center gap-2 mb-1">
              {isPositive ? <TrendingUp className="h-4 w-4 text-emerald-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Expected Value</p>
            </div>
            <p className={cn("text-4xl font-black tabular-nums", isPositive ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400")}>
              {isPositive ? "+" : ""}{fmt$(ev)}
            </p>
            <p className={cn("text-sm mt-1 font-semibold", isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
              {isPositive ? "+" : ""}{fmtPct(evPct!)} per bet · {isPositive ? "+EV bet" : "Negative EV"}
            </p>
          </div>

          {/* Edge bar */}
          {edge !== null && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium text-muted-foreground">
                <span>Your edge over the book</span>
                <StatusBadge positive={edge > 0} label={`${edge > 0 ? "+" : ""}${fmtPct(edge)}`} />
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all duration-300", edge > 0 ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : "bg-gradient-to-r from-red-600 to-red-400")}
                  style={{ width: `${Math.min(Math.abs(edge) * 3, 100)}%` }}
                />
              </div>
            </div>
          )}

          <ResultsPanel>
            <StatRow label="Book implied probability" value={fmtPct(bookProb!)}        sentiment="neutral" />
            <StatRow label="Your probability"         value={fmtPct(probNum * 100)}    sentiment="neutral" />
            <StatRow label="Your edge"                value={`${edge! > 0 ? "+" : ""}${fmtPct(edge!)}`} sentiment={edge! > 0 ? "positive" : "negative"} hero />
          </ResultsPanel>

          {!isPositive && <Warning text="Negative EV — at your assessed win probability, this bet loses money in the long run." />}
        </div>
      ) : (
        <EmptyState text="Enter stake, odds, and your estimated win probability." />
      )}
    </div>
  );
}

// ─── Kelly Criterion ──────────────────────────────────────────────────────────

function KellyCriterion({ mode }: { mode: OddsMode }) {
  const [bankroll, setBankroll] = useState("");
  const [odds,     setOdds]     = useState("");
  const [winProb,  setWinProb]  = useState("");
  const [frac, setFrac] = useState<"full" | "half" | "quarter">("half");

  const decOdds     = parseOdds(odds, mode);
  const bankrollNum = parseFloat(bankroll);
  const probNum     = parseFloat(winProb) / 100;
  const valid       = decOdds !== null && bankrollNum > 0 && probNum > 0 && probNum < 1;

  let kelly: number | null = null, stakeAmt: number | null = null;
  if (valid) {
    const b = decOdds! - 1, q = 1 - probNum;
    kelly    = (b * probNum - q) / b;
    const m  = frac === "full" ? 1 : frac === "half" ? 0.5 : 0.25;
    stakeAmt = Math.max(0, kelly * m * bankrollNum);
  }

  const fracOpts = [
    { id: "full"    as const, label: "Full",    desc: "100%  — high variance" },
    { id: "half"    as const, label: "Half",    desc: "50% — recommended"  },
    { id: "quarter" as const, label: "Quarter", desc: "25% — conservative" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Kelly Criterion</h2>
        <p className="text-sm text-muted-foreground mt-1">Optimal fraction of your bankroll to bet, maximising long-run growth.</p>
      </div>

      <InputPanel>
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyInput id="k-bank" label="Bankroll" value={bankroll} onChange={setBankroll} placeholder="1000" />
          <OddsInput  id="k-odds" label="Bet odds" value={odds}     onChange={setOdds}     mode={mode} />
          <PctInput   id="k-prob" label="Win prob" value={winProb}  onChange={setWinProb} />
        </div>
      </InputPanel>

      {/* Kelly fraction selector */}
      <div className="grid grid-cols-3 gap-2">
        {fracOpts.map((o) => (
          <button key={o.id} type="button" onClick={() => setFrac(o.id)}
            className={cn(
              "rounded-xl border p-3 text-center transition-all",
              frac === o.id
                ? "border-violet-500/50 bg-violet-500/15 shadow-sm"
                : "border-border/40 bg-muted/20 hover:bg-muted/40"
            )}>
            <p className={cn("text-sm font-bold", frac === o.id ? "text-violet-600 dark:text-violet-400" : "text-foreground")}>{o.label} Kelly</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{o.desc}</p>
          </button>
        ))}
      </div>

      {valid && kelly !== null && stakeAmt !== null ? (
        kelly <= 0 ? (
          <Warning text="Kelly says don't bet — no positive edge at your assessed probability." />
        ) : (
          <div className="space-y-4">
            {/* Hero stake card */}
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Recommended Stake</p>
              <p className="text-4xl font-black tabular-nums text-emerald-500 dark:text-emerald-400">{fmt$(stakeAmt)}</p>
              <p className="text-sm mt-1 font-semibold text-emerald-600 dark:text-emerald-400">
                {fmtPct((stakeAmt / bankrollNum) * 100, 2)} of bankroll · {frac} Kelly
              </p>
            </div>

            {/* Bankroll usage bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium text-muted-foreground">
                <span>Bankroll allocated</span>
                <span className="font-bold text-foreground">{fmtPct((stakeAmt / bankrollNum) * 100, 2)}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-300"
                  style={{ width: `${Math.min((stakeAmt / bankrollNum) * 100, 100)}%` }} />
              </div>
            </div>

            <ResultsPanel>
              <StatRow label="Full Kelly %" value={fmtPct(kelly * 100, 2)} sub="Maximum optimal stake size" sentiment="neutral" />
              <StatRow label={`${frac === "full" ? "Full" : frac === "half" ? "Half" : "Quarter"} Kelly stake`} value={fmt$(stakeAmt)} sentiment="positive" hero />
            </ResultsPanel>

            <Tip text="Most professionals use Half Kelly — it achieves ~75% of the growth rate with far less drawdown risk." />
          </div>
        )
      ) : (
        <EmptyState text="Enter your bankroll, bet odds, and win probability." />
      )}
    </div>
  );
}

// ─── Parlay Calculator ────────────────────────────────────────────────────────

type ParlayLeg = { id: number; odds: string };
let _id = 2;

function ParlayCalculator({ mode }: { mode: OddsMode }) {
  const [stake, setStake] = useState("");
  const [legs, setLegs]   = useState<ParlayLeg[]>([{ id: 1, odds: "" }, { id: 2, odds: "" }]);

  const addLeg    = () => setLegs((p) => [...p, { id: ++_id, odds: "" }]);
  const removeLeg = (id: number) => setLegs((p) => p.filter((l) => l.id !== id));
  const updateLeg = (id: number, odds: string) => setLegs((p) => p.map((l) => l.id === id ? { ...l, odds } : l));

  const stakeNum = parseFloat(stake);
  const decLegs  = legs.map((l) => parseOdds(l.odds, mode));
  const allValid = stakeNum > 0 && decLegs.every((d) => d !== null) && legs.length >= 2;

  let combined: number | null = null, payout: number | null = null, profit: number | null = null;
  if (allValid) {
    combined = decLegs.reduce((a, d) => a! * d!, 1)!;
    payout   = stakeNum * combined;
    profit   = payout - stakeNum;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Parlay Calculator</h2>
        <p className="text-sm text-muted-foreground mt-1">Chain multiple legs — see combined odds, payout, and implied probability.</p>
      </div>

      <InputPanel>
        <MoneyInput id="parlay-stake" label="Total stake" value={stake} onChange={setStake} />

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Legs ({legs.length})</p>
          <div className="space-y-2.5">
            {legs.map((leg, idx) => (
              <div key={leg.id} className="flex items-end gap-3">
                <div className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-xs font-bold text-muted-foreground">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <OddsInput id={`leg-${leg.id}`} label="" value={leg.odds}
                    onChange={(v) => updateLeg(leg.id, v)} mode={mode} />
                </div>
                {legs.length > 2 && (
                  <button type="button" onClick={() => removeLeg(leg.id)}
                    className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLeg} disabled={legs.length >= 12}
            className="gap-2 mt-1 h-9 border-dashed">
            <Plus className="h-4 w-4" /> Add leg
          </Button>
        </div>
      </InputPanel>

      {allValid && combined !== null ? (
        <div className="space-y-4">
          {/* Payout hero */}
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Potential Payout</p>
            <p className="text-4xl font-black tabular-nums text-emerald-500 dark:text-emerald-400">{fmt$(payout!)}</p>
            <p className="text-sm mt-1 font-semibold text-emerald-600 dark:text-emerald-400">
              +{fmt$(profit!)} profit · {legs.length}-leg parlay
            </p>
          </div>

          <ResultsPanel>
            <StatRow label="Combined decimal odds" value={combined.toFixed(3)} sentiment="neutral" />
            {mode === "american" && (
              <StatRow label="Combined American odds" value={`${decimalToAmerican(combined) > 0 ? "+" : ""}${decimalToAmerican(combined)}`} sentiment="neutral" />
            )}
            <StatRow label="Profit" value={fmt$(profit!)} sentiment="positive" hero />
            <StatRow label="Implied probability" value={fmtPct(impliedProb(combined))} sub="Chance all legs hit" sentiment="neutral" />
          </ResultsPanel>
        </div>
      ) : (
        <EmptyState text="Enter stake and odds for each leg to calculate the parlay." />
      )}
    </div>
  );
}

// ─── Break-even Calculator ────────────────────────────────────────────────────

function BreakevenCalculator({ mode }: { mode: OddsMode }) {
  const [odds,    setOdds]    = useState("");
  const [hitRate, setHitRate] = useState("");

  const decOdds  = parseOdds(odds, mode);
  const hitNum   = parseFloat(hitRate) / 100;
  const beProb   = decOdds !== null ? impliedProb(decOdds) : null;
  const edge     = beProb !== null && hitNum > 0 ? hitNum * 100 - beProb : null;
  const longRun  = beProb !== null && hitNum > 0 && hitNum < 1 && decOdds !== null
    ? 100 * (hitNum * (decOdds - 1) - (1 - hitNum)) : null;

  const isProfit = edge !== null && edge > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Break-even Calculator</h2>
        <p className="text-sm text-muted-foreground mt-1">Find the minimum win rate needed — and simulate your long-run P/L.</p>
      </div>

      <InputPanel>
        <div className="grid gap-4 sm:grid-cols-2">
          <OddsInput id="be-odds" label="Bet odds"     value={odds}    onChange={setOdds}    mode={mode} />
          <PctInput  id="be-hit"  label="Your hit rate" value={hitRate} onChange={setHitRate} placeholder="52" />
        </div>
      </InputPanel>

      {beProb !== null ? (
        <div className="space-y-4">
          {/* Win-rate comparison */}
          <div className="rounded-2xl border border-border/40 bg-muted/10 p-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Win rate comparison</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-muted-foreground">
                <span>Break-even threshold</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">{fmtPct(beProb)}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400" style={{ width: `${Math.min(beProb, 100)}%` }} />
              </div>
            </div>

            {edge !== null && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-muted-foreground">
                  <span>Your hit rate</span>
                  <StatusBadge positive={isProfit} label={fmtPct(hitNum * 100)} />
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all duration-300", isProfit ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : "bg-gradient-to-r from-red-600 to-red-400")}
                    style={{ width: `${Math.min(hitNum * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {longRun !== null && (
            <div className={cn(
              "rounded-2xl border p-5 text-center",
              longRun >= 0 ? "bg-emerald-500/10 border-emerald-500/25" : "bg-red-500/10 border-red-500/25"
            )}>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">P/L per 100 × $1 flat bets</p>
              <p className={cn("text-4xl font-black tabular-nums", longRun >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400")}>
                {longRun >= 0 ? "+" : ""}{fmt$(longRun)}
              </p>
              <p className={cn("text-sm mt-1 font-semibold", longRun >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                {longRun >= 0 ? "Profitable system" : "Losing system"} at your hit rate
              </p>
            </div>
          )}

          <ResultsPanel>
            <StatRow label="Break-even win rate" value={fmtPct(beProb)} sub="Must win at least this often to break even" sentiment="warning" hero />
            {edge !== null && (
              <StatRow label="Your edge" value={`${isProfit ? "+" : ""}${fmtPct(edge)}`} sentiment={isProfit ? "positive" : "negative"} sub="Your hit rate minus break-even" />
            )}
          </ResultsPanel>

          {edge !== null && !isProfit && (
            <Warning text="Your assessed hit rate is below break-even — this bet loses money long-term at that rate." />
          )}
        </div>
      ) : (
        <EmptyState text="Enter bet odds (and optionally your hit rate) to calculate break-even." />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HedgeCalculatorPage() {
  const [active, setActive]     = useState<ToolId>("hedge");
  const [oddsMode, setOddsMode] = useState<OddsMode>("american");

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* layered ambient glows */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_40%_at_50%_-10%,hsl(var(--primary)/0.08),transparent)]" />
      <div className="pointer-events-none absolute -right-40 top-10  -z-10 h-[500px] w-[500px] rounded-full bg-emerald-500/8  blur-[120px]" />
      <div className="pointer-events-none absolute -left-40  bottom-10 -z-10 h-[400px] w-[400px] rounded-full bg-red-500/6     blur-[100px]" />
      <div className="pointer-events-none absolute  left-1/2  top-1/2  -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/5 blur-[140px]" />

      <div className="container mx-auto max-w-4xl px-4 py-8 md:py-12">

        {/* Back */}
        <Link href="/projects"
          className="group mb-8 inline-flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-all hover:border-border hover:bg-card hover:text-foreground">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Projects
        </Link>

        {/* Header */}
        <header className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <TrendingUp className="h-3.5 w-3.5" />
            Sports Betting Suite
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            <span className="bg-gradient-to-r from-emerald-500 via-green-400 to-teal-500 bg-clip-text text-transparent">Betting</span>{" "}
            <span>Calculator</span>
          </h1>
          <p className="mt-2 max-w-xl text-base text-muted-foreground">
            Hedge bets, convert odds, calculate EV, size stakes with Kelly, build parlays, and find break-even rates.
          </p>

          {/* Odds mode toggle */}
          <div className="mt-5 inline-flex items-center rounded-xl border border-border/50 bg-muted/30 p-1 gap-0.5">
            <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Odds</span>
            {(["american", "decimal"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setOddsMode(m)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                  oddsMode === m ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}>
                {m === "american" ? "American (+/−)" : "Decimal"}
              </button>
            ))}
          </div>
        </header>

        {/* Tool tabs */}
        <div className="mb-5 flex flex-wrap gap-2">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setActive(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                active === id
                  ? "border-emerald-500/40 bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-lg shadow-emerald-500/20"
                  : "border-border/50 bg-card/60 text-muted-foreground backdrop-blur-sm hover:border-border hover:bg-card hover:text-foreground"
              )}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Main card */}
        <div className="rounded-2xl border border-border/50 bg-card/90 p-6 shadow-xl shadow-black/5 backdrop-blur-sm dark:shadow-black/20">
          {active === "hedge"     && <HedgeCalculator     mode={oddsMode} />}
          {active === "convert"   && <OddsConverter />}
          {active === "ev"        && <EVCalculator         mode={oddsMode} />}
          {active === "kelly"     && <KellyCriterion       mode={oddsMode} />}
          {active === "parlay"    && <ParlayCalculator     mode={oddsMode} />}
          {active === "breakeven" && <BreakevenCalculator  mode={oddsMode} />}
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground/60">
          For educational purposes only. Always verify calculations before placing bets.
        </p>
      </div>
    </div>
  );
}
