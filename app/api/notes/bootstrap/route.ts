import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

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

/**
 * Single round-trip: all pages + notes for the initial page (replaces pages then notes fetch).
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const preferred = request.nextUrl.searchParams.get("preferredPageId");

    const admin = supabaseAdmin as any;
    const { data: pageData, error: pageErr } = await admin
      .from("note_page")
      .select("*")
      .eq("userId", userId)
      .order("favorite", { ascending: false })
      .order("updatedAt", { ascending: false });

    if (pageErr)
      return NextResponse.json({ error: pageErr.message }, { status: 500 });

    const pages = Array.isArray(pageData) ? pageData : [];
    const pageIds = new Set(pages.map((p: { id: string }) => p.id));
    const firstPageId = pages[0]?.id ?? null;
    const initialPageId =
      preferred && pageIds.has(preferred) ? preferred : firstPageId;

    let notes: unknown[] = [];
    if (initialPageId) {
      const { data: noteData, error: noteErr } = await admin
        .from("note")
        .select("*")
        .eq("userId", userId)
        .eq("pageId", initialPageId)
        .order("favorite", { ascending: false })
        .order("updatedAt", { ascending: false });

      if (noteErr)
        return NextResponse.json({ error: noteErr.message }, { status: 500 });
      notes = Array.isArray(noteData) ? noteData : [];
    }

    return NextResponse.json({
      pages,
      notes,
      initialPageId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
