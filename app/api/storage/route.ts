import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

const STORAGE_BUCKET = "user-storage";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

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
  const exists = (buckets ?? []).some((b: { name: string }) => b.name === STORAGE_BUCKET);
  if (!exists) {
    await admin.storage.createBucket(STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: MAX_FILE_SIZE,
    });
  }
}

/** List files for authenticated user */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = supabaseAdmin as any;
    const { data, error } = await admin.storage
      .from(STORAGE_BUCKET)
      .list(userId, { limit: 500, sortBy: { column: "created_at", order: "desc" } });

    if (error) {
      if (/bucket/i.test(error.message ?? "")) {
        return NextResponse.json({ files: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const files = (data ?? []).map((f: { name: string; metadata?: { size?: number; mimetype?: string; lastModified?: string } }) => {
      const path = `${userId}/${f.name}`;
      const { data: pub } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      return {
        name: f.name,
        path,
        url: pub.publicUrl as string,
        size: f.metadata?.size ?? 0,
        type: f.metadata?.mimetype ?? "application/octet-stream",
        createdAt: f.metadata?.lastModified ?? new Date().toISOString(),
      };
    });

    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Upload a file */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 400 });
    }

    await ensureBucket();

    const admin = supabaseAdmin as any;
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, "_");
    const path = `${userId}/${Date.now()}-${safeName}`;
    const bytes = await file.arrayBuffer();

    const { error } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: pub } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return NextResponse.json({
      name: file.name,
      path,
      url: pub.publicUrl as string,
      size: file.size,
      type: file.type,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Delete a file */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { path } = (await request.json()) as { path: string };
    if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });

    // Security: ensure the path belongs to this user
    if (!path.startsWith(`${userId}/`)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = supabaseAdmin as any;
    const { error } = await admin.storage.from(STORAGE_BUCKET).remove([path]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
