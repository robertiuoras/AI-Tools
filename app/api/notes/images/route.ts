import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

const NOTE_IMAGE_BUCKET = "note-images";

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

function extensionForMime(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "png";
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image uploads are allowed" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Image exceeds 10MB limit" }, { status: 400 });
    }

    const admin = supabaseAdmin as any;
    const ext = extensionForMime(file.type);
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const bytes = await file.arrayBuffer();

    let upload = await admin.storage
      .from(NOTE_IMAGE_BUCKET)
      .upload(path, bytes, {
        contentType: file.type,
        upsert: false,
      });

    if (upload.error && /bucket/i.test(upload.error.message ?? "")) {
      await admin.storage.createBucket(NOTE_IMAGE_BUCKET, {
        public: true,
        fileSizeLimit: 10485760,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      });
      upload = await admin.storage
        .from(NOTE_IMAGE_BUCKET)
        .upload(path, bytes, {
          contentType: file.type,
          upsert: false,
        });
    }

    if (upload.error) {
      return NextResponse.json({ error: upload.error.message }, { status: 500 });
    }

    const { data: pub } = admin.storage.from(NOTE_IMAGE_BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: pub.publicUrl, path });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

