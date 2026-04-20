import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import {
  deleteTrackedBet,
  manualGradeBet,
  settleTrackedBet,
} from "@/lib/betting-bot-bets";

/**
 * POST   /api/projects/ai-betting-bot/bets/{id}    (action in body)
 *   body: { action: "settle" }                      → re-check ESPN now
 *   body: { action: "grade", outcome, notes? }      → manual grade
 * DELETE /api/projects/ai-betting-bot/bets/{id}    → remove
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

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const limited = enforceApiRateLimit(request, "ai_betting_bot");
  if (limited) return limited;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: {
    action?: "settle" | "grade";
    outcome?: "won" | "lost" | "push" | "void" | "cancelled";
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action === "settle") {
    try {
      const bet = await settleTrackedBet(userId, id);
      if (!bet)
        return NextResponse.json(
          { error: "Bet not found." },
          { status: 404 },
        );
      return NextResponse.json({ bet });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Settle failed." },
        { status: 500 },
      );
    }
  }

  if (body.action === "grade") {
    const outcome = body.outcome;
    if (
      outcome !== "won" &&
      outcome !== "lost" &&
      outcome !== "push" &&
      outcome !== "void" &&
      outcome !== "cancelled"
    ) {
      return NextResponse.json(
        { error: "outcome must be won | lost | push | void | cancelled." },
        { status: 400 },
      );
    }
    try {
      const bet = await manualGradeBet(userId, id, outcome, body.notes);
      if (!bet)
        return NextResponse.json(
          { error: "Bet not found." },
          { status: 404 },
        );
      return NextResponse.json({ bet });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Grade failed." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { error: "Unknown action — use 'settle' or 'grade'." },
    { status: 400 },
  );
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const limited = enforceApiRateLimit(request, "ai_betting_bot");
  if (limited) return limited;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = await deleteTrackedBet(userId, id);
  if (!ok) {
    return NextResponse.json(
      { error: "Delete failed." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
