import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId } from "@/lib/notes-auth";

/**
 * GET /api/notifications
 *   ?unreadOnly=1   – return only unread
 *   ?limit=50       – cap rows (default 50, max 100)
 *
 * Returns: { items: NotificationRow[], unreadCount: number }
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "1";
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 100)
      : 50;

    const admin = supabaseAdmin as any;
    let query = admin
      .from("notification")
      .select("id, user_id, type, title, body, link, payload, is_read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (unreadOnly) query = query.eq("is_read", false);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Always return the unread count so the bell badge can be updated even
    // when the dropdown is showing the "all" tab.
    const { count: unreadCount, error: countErr } = await admin
      .from("notification")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (countErr) {
      console.warn("[notifications] count failed:", countErr);
    }

    return NextResponse.json({
      items: data ?? [],
      unreadCount: unreadCount ?? 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
