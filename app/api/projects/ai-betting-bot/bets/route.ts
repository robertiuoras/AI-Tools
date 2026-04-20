import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import {
  autoSettlePending,
  buildCalibrationSummary,
  listTrackedBets,
  saveTrackedBet,
} from "@/lib/betting-bot-bets";
import type { BettingAnalysisResult } from "@/lib/betting-bot";

/**
 * GET  /api/projects/ai-betting-bot/bets
 *   → { bets: TrackedBetRow[]; calibration: CalibrationSummary }
 *   Auto-settles any pending bet whose kickoff was ≥ 3h ago, so the user
 *   just needs to reload to see fresh results.
 *
 * POST /api/projects/ai-betting-bot/bets
 *   body: { query, result, sportPath?, espnEventId?, espnHomeTeamId?,
 *           espnAwayTeamId?, stakeUsd? }
 *   → { bet: TrackedBetRow }
 */

function getSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUserId(request: NextRequest): Promise<string | null> {
  const client = getSupabaseClient(request);
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await client.auth.getUser(token);
    if (user) return user.id;
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function GET(request: NextRequest) {
  const limited = enforceApiRateLimit(request, "ai_betting_bot");
  if (limited) return limited;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Best-effort auto-settle before loading the list; if ESPN is down we
    // still want the user to see what we already have.
    await autoSettlePending(userId);
    const bets = await listTrackedBets(userId);
    const calibration = buildCalibrationSummary(bets);
    return NextResponse.json({ bets, calibration });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load bets." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceApiRateLimit(request, "ai_betting_bot");
  if (limited) return limited;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    query?: string;
    result?: BettingAnalysisResult;
    sportPath?: string | null;
    espnEventId?: string | null;
    espnHomeTeamId?: string | null;
    espnAwayTeamId?: string | null;
    stakeUsd?: number | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = String(body.query ?? "").trim();
  const result = body.result;
  if (
    !query ||
    !result ||
    typeof result !== "object" ||
    typeof result.fairWinProbabilityPct !== "number"
  ) {
    return NextResponse.json(
      { error: "query and a complete analysis `result` are required." },
      { status: 400 },
    );
  }

  try {
    const bet = await saveTrackedBet({
      userId,
      query,
      result,
      sportPath: body.sportPath ?? null,
      espnEventId: body.espnEventId ?? null,
      espnHomeTeamId: body.espnHomeTeamId ?? null,
      espnAwayTeamId: body.espnAwayTeamId ?? null,
      stakeUsd:
        typeof body.stakeUsd === "number" && Number.isFinite(body.stakeUsd)
          ? body.stakeUsd
          : null,
    });
    return NextResponse.json({ bet });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed." },
      { status: 500 },
    );
  }
}
