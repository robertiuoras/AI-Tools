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
    const { data: { user } } = await client.auth.getUser(token);
    if (user) return user.id;
  }
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const pageId = request.nextUrl.searchParams.get("pageId");
    if (!pageId) return NextResponse.json({ error: "pageId is required" }, { status: 400 });

    const admin = supabaseAdmin as any;
    const { data, error } = await admin
      .from("note")
      .select("*")
      .eq("userId", userId)
      .eq("pageId", pageId)
      .order("favorite", { ascending: false })
      .order("updatedAt", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const pageId = typeof body?.pageId === "string" ? body.pageId : "";
    if (!pageId) return NextResponse.json({ error: "pageId is required" }, { status: 400 });

    const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "Untitled Note";
    const content = typeof body?.content === "string" ? body.content : "";

    const admin = supabaseAdmin as any;
    const { data, error } = await admin
      .from("note")
      .insert([{ userId, pageId, title, content, favorite: false }])
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

