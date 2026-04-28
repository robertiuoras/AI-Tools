import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId } from "@/lib/notes-auth";
import { google } from "googleapis";
import { createNotification } from "@/lib/notifications";

const PG_UNDEFINED_COLUMN = "42703";
const NEWS_DAY_CACHE_MS = 5 * 60 * 1000;
let cachedLatestNewsDay: { value: string | null; expiresAt: number } = {
  value: null,
  expiresAt: 0,
};

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

    await ensureDailyNewsNotification(userId);

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

async function ensureDailyNewsNotification(userId: string): Promise<void> {
  const latestNewsDay = await getLatestNewsDay();
  if (!latestNewsDay) return;

  const admin = supabaseAdmin as any;
  const { data: userRow, error } = await admin
    .from("user")
    .select("id, last_news_notified_day")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // Backward compatible: migration might not be applied yet.
    if (String(error.code ?? "") === PG_UNDEFINED_COLUMN) return;
    console.warn("[notifications] news day check failed:", error);
    return;
  }

  const lastNotifiedDay = String(userRow?.last_news_notified_day ?? "");
  if (lastNotifiedDay === latestNewsDay) return;

  const prettyDay = new Date(`${latestNewsDay}T00:00:00.000Z`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  await createNotification({
    userId,
    type: "news_daily_digest",
    title: "New AI news is available",
    body: `Fresh update for ${prettyDay}. Tap to read the latest feed.`,
    link: "/news",
    payload: { news_day: latestNewsDay },
  });

  const { error: updateErr } = await admin
    .from("user")
    .update({ last_news_notified_day: latestNewsDay })
    .eq("id", userId);

  if (updateErr && String(updateErr.code ?? "") !== PG_UNDEFINED_COLUMN) {
    console.warn("[notifications] failed to persist last_news_notified_day:", updateErr);
  }
}

async function getLatestNewsDay(): Promise<string | null> {
  if (cachedLatestNewsDay.expiresAt > Date.now()) {
    return cachedLatestNewsDay.value;
  }

  try {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!clientEmail || !privateKey || !sheetId) return null;

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Sheet1!C:C",
    });

    const rows = response.data.values ?? [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const raw = String(rows[i]?.[0] ?? "").trim();
      if (!raw) continue;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) continue;
      const day = parsed.toISOString().slice(0, 10);
      cachedLatestNewsDay = {
        value: day,
        expiresAt: Date.now() + NEWS_DAY_CACHE_MS,
      };
      return day;
    }

    cachedLatestNewsDay = { value: null, expiresAt: Date.now() + NEWS_DAY_CACHE_MS };
    return null;
  } catch (error) {
    console.warn("[notifications] getLatestNewsDay failed:", error);
    return null;
  }
}
