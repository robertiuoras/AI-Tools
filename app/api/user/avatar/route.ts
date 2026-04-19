import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const BUCKET = "user-avatars";
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

function bearerToken(request: NextRequest): string | null {
  const h = request.headers.get("authorization");
  if (!h) return null;
  return h.replace(/^Bearer\s+/i, "");
}

async function getUserId(request: NextRequest): Promise<string | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await client.auth.getUser(token);
  return data.user?.id ?? null;
}

async function ensureBucket() {
  const admin = supabaseAdmin as any;
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = (buckets ?? []).some(
    (b: { name: string }) => b.name === BUCKET,
  );
  if (!exists) {
    await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
    });
  }
}

/**
 * POST /api/user/avatar  (multipart form, field "file")
 *   → uploads/replaces the user's avatar and updates user.avatar_url.
 *
 * DELETE /api/user/avatar
 *   → removes the avatar file + clears user.avatar_url.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing 'file' field" },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` },
        { status: 400 },
      );
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported type ${file.type}. Use PNG, JPEG, WebP, or GIF.` },
        { status: 400 },
      );
    }

    await ensureBucket();
    const admin = supabaseAdmin as any;

    // Use a stable path with a cache-busting suffix so previous uploads
    // are replaced (upsert) and CDN/browser caches don't show a stale
    // image.
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const safeExt = /^(png|jpe?g|webp|gif)$/.test(ext) ? ext : "png";
    const path = `${userId}/avatar.${safeExt}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: true,
        cacheControl: "3600",
      });
    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const baseUrl = pub?.publicUrl as string | undefined;
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Could not resolve public URL for avatar" },
        { status: 500 },
      );
    }
    // Append a version query so browsers refresh the new avatar even
    // though the path is stable.
    const versioned = `${baseUrl}?v=${Date.now()}`;

    // Persist on the user row.
    const { data: userRow, error: updateErr } = await admin
      .from("user")
      .update({ avatar_url: versioned })
      .eq("id", userId)
      .select("id, email, name, avatar_url, role")
      .single();
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ user: userRow, avatarUrl: versioned });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const admin = supabaseAdmin as any;

    // Best-effort: try removing all known extensions. Stable filename
    // pattern means at most one will exist.
    const candidates = ["png", "jpg", "jpeg", "webp", "gif"].map(
      (ext) => `${userId}/avatar.${ext}`,
    );
    await admin.storage.from(BUCKET).remove(candidates).catch(() => {});

    const { data: userRow, error } = await admin
      .from("user")
      .update({ avatar_url: null })
      .eq("id", userId)
      .select("id, email, name, avatar_url, role")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ user: userRow });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
