import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLocalMonthStartIso } from "@/lib/tool-popularity";

export function getSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUserIdFromRequest(
  request: NextRequest,
  client: ReturnType<typeof getSupabaseClient>,
): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await client.auth.getUser(token);
    if (!error && user) return user.id;
  }
  const { data: { user }, error } = await client.auth.getUser();
  if (!error && user) return user.id;
  return null;
}

export function todayUtcRange() {
  const today = new Date().toISOString().split("T")[0];
  return {
    start: `${today}T00:00:00.000Z`,
    end: `${today}T23:59:59.999Z`,
  };
}

/** Monthly totals + whether user has up/down today (for one tool). */
export async function fetchVoteSnapshot(
  admin: any,
  toolId: string,
  userId: string | null,
) {
  const monthStartIso = getLocalMonthStartIso();
  const { start, end } = todayUtcRange();

  const upCountP = admin
    .from("upvote")
    .select("*", { count: "exact", head: true })
    .eq("toolId", toolId)
    .gte("upvotedAt", monthStartIso);

  const downCountP = admin
    .from("downvote")
    .select("*", { count: "exact", head: true })
    .eq("toolId", toolId)
    .gte("downvotedAt", monthStartIso);

  let userUpP: PromiseLike<{ count: number | null }> = Promise.resolve({
    count: 0,
  });
  let userDownP: PromiseLike<{ count: number | null }> = Promise.resolve({
    count: 0,
  });

  if (userId) {
    userUpP = admin
      .from("upvote")
      .select("*", { count: "exact", head: true })
      .eq("userId", userId)
      .eq("toolId", toolId)
      .gte("upvotedAt", start)
      .lt("upvotedAt", end);

    userDownP = admin
      .from("downvote")
      .select("*", { count: "exact", head: true })
      .eq("userId", userId)
      .eq("toolId", toolId)
      .gte("downvotedAt", start)
      .lt("downvotedAt", end);
  }

  const [upRes, downRes, uu, ud] = await Promise.all([
    upCountP,
    downCountP,
    userUpP,
    userDownP,
  ]);

  return {
    upvoteCount: upRes.count ?? 0,
    downvoteCount: downRes.count ?? 0,
    userUpvoted: (uu.count ?? 0) > 0,
    userDownvoted: (ud.count ?? 0) > 0,
  };
}
