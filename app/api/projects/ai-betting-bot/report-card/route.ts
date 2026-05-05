import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { autoSettlePending, buildModelReportCard, listTrackedBets } from "@/lib/betting-bot-bets";

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

  const daysRaw = Number(request.nextUrl.searchParams.get("days") ?? "90");
  const lookbackDays = Math.min(365, Math.max(30, Number.isFinite(daysRaw) ? daysRaw : 90));

  try {
    await autoSettlePending(userId);
    const bets = await listTrackedBets(userId);
    const reportCard = buildModelReportCard(bets, lookbackDays);
    return NextResponse.json({ reportCard });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build report card." },
      { status: 500 },
    );
  }
}

