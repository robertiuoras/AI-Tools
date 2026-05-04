import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getEntainOdds, getEventPickcenter } from "@/lib/sports-data";
import { eventKeyFor, snapshotOdds } from "@/lib/odds-history";

/**
 * GET /api/projects/ai-betting-bot/cron/snapshot-closing
 *
 * Runs on a schedule (Vercel cron — see vercel.json) to capture the
 * *actual* closing line for every tracked bet whose kickoff is within
 * the next ~30 minutes. Without this, CLV is best-effort against the
 * snapshot the user happened to have when they last analysed the
 * fixture — usually hours stale.
 *
 * Auth: requires a Bearer token matching CRON_SECRET (Vercel injects
 * this automatically when calling cron endpoints; for manual / external
 * pings set CRON_SECRET in your env and pass it).
 *
 * Idempotent — multiple runs in the window just append more snapshots,
 * which is fine; CLV reads the most recent pre-kickoff one.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PendingBet {
  id: string;
  sport_path: string | null;
  espn_event_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  kickoff: string | null;
}

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset → open (dev / hobby tier)
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const horizonMs = now + 30 * 60_000; // next 30 minutes

  let pending: PendingBet[] = [];
  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("betting_bot_bet")
      .select("id, sport_path, espn_event_id, home_team_name, away_team_name, kickoff")
      .eq("status", "pending")
      .not("kickoff", "is", null);
    if (error) throw new Error(error.message);
    pending = (data ?? []) as PendingBet[];
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Filter by kickoff window client-side (Supabase comparison on
  // timestamptz with computed bounds is fiddly; the table stays small).
  const due = pending.filter((b) => {
    if (!b.kickoff) return false;
    const t = Date.parse(b.kickoff);
    return Number.isFinite(t) && t > now && t <= horizonMs;
  });

  // De-dup by (sport_path + home + away + kickoff) — multiple users
  // tracking the same bet shouldn't cost N×provider calls.
  const fixturesMap = new Map<string, PendingBet>();
  for (const b of due) {
    if (!b.sport_path || !b.home_team_name || !b.away_team_name) continue;
    const k = eventKeyFor({
      homeTeamName: b.home_team_name,
      awayTeamName: b.away_team_name,
      kickoffIso: b.kickoff,
    });
    if (!fixturesMap.has(k)) fixturesMap.set(k, b);
  }

  let snapped = 0;
  let failed = 0;
  for (const [eventKey, bet] of fixturesMap.entries()) {
    try {
      const [entain, pickcenter] = await Promise.all([
        getEntainOdds(
          bet.sport_path!,
          bet.home_team_name!,
          bet.away_team_name!,
          bet.kickoff,
        ),
        bet.espn_event_id
          ? getEventPickcenter(bet.sport_path!, bet.espn_event_id)
          : Promise.resolve([]),
      ]);
      const seen = new Set<string>();
      const books = [...entain, ...pickcenter].filter((b) =>
        seen.has(b.key) ? false : (seen.add(b.key), true),
      );
      if (books.length > 0) {
        await snapshotOdds({
          sport: bet.sport_path!,
          eventKey,
          espnEventId: bet.espn_event_id,
          books,
        });
        snapped += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({
    runAt: new Date().toISOString(),
    pendingTotal: pending.length,
    dueInWindow: due.length,
    uniqueFixtures: fixturesMap.size,
    snapshotsWritten: snapped,
    failed,
  });
}
