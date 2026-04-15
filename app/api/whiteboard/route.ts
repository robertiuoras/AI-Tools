import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

const WHITEBOARD_BUCKET = "user-whiteboard";

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

async function ensureBucket() {
  const admin = supabaseAdmin as any;
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = (buckets ?? []).some((b: { name: string }) => b.name === WHITEBOARD_BUCKET);
  if (!exists) {
    await admin.storage.createBucket(WHITEBOARD_BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
    });
  }
}

/** Load whiteboard snapshot */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = supabaseAdmin as any;
    const path = `${userId}/board.json`;

    const { data, error } = await admin.storage.from(WHITEBOARD_BUCKET).download(path);

    if (error) {
      // No existing board yet — return empty
      return NextResponse.json({ snapshot: null });
    }

    const text = await (data as Blob).text();
    const snapshot = JSON.parse(text);
    return NextResponse.json({ snapshot });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Save whiteboard snapshot */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { snapshot } = (await request.json()) as { snapshot: unknown };
    if (!snapshot) return NextResponse.json({ error: "snapshot is required" }, { status: 400 });

    await ensureBucket();

    const admin = supabaseAdmin as any;
    const path = `${userId}/board.json`;
    const json = JSON.stringify(snapshot);
    const bytes = new TextEncoder().encode(json);

    const { error } = await admin.storage
      .from(WHITEBOARD_BUCKET)
      .upload(path, bytes, { contentType: "application/json", upsert: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
