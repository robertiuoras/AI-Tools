"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Copy, Database } from "lucide-react";

type DebugPayload = {
  savedAt: string;
  query: string;
  notes: string | null;
  odds: string | null;
  bankroll: string | null;
  fixture: unknown;
  trackCtx: unknown;
  result: unknown;
};

export default function BettingBotDebugPage() {
  const [copied, setCopied] = useState(false);

  const payload = useMemo<DebugPayload | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw =
        sessionStorage.getItem("betting-bot:last-analysis-debug") ??
        localStorage.getItem("betting-bot:last-analysis-debug");
      if (!raw) return null;
      return JSON.parse(raw) as DebugPayload;
    } catch {
      return null;
    }
  }, []);

  const json = useMemo(() => {
    if (!payload) return "";
    return JSON.stringify(payload, null, 2);
  }, [payload]);

  const onCopy = async () => {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/projects/ai-betting-bot"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to betting bot
        </Link>
        <button
          type="button"
          onClick={onCopy}
          disabled={!json}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <Copy className="h-4 w-4" />
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Database className="h-4 w-4" />
          Raw analysis data used by betting bot
        </div>
        {!payload ? (
          <p className="text-sm text-muted-foreground">
            No analysis payload found yet. Run an analysis first, then click
            &quot;Open debug data&quot; from the results card.
          </p>
        ) : (
          <pre className="max-h-[70vh] overflow-auto rounded-lg border border-border/50 bg-background p-3 text-xs leading-5">
            {json}
          </pre>
        )}
      </div>
    </main>
  );
}
