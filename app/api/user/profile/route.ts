import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET  /api/user/profile  → returns the current user's profile row.
 * PATCH /api/user/profile  → updates the current user's `name` (and optionally
 *                            clears `avatar_url` when `clearAvatar: true`).
 *
 * Auth: standard supabase access token in the Authorization header.
 *
 * Avatar uploads go through POST /api/user/avatar (multipart form).
 */

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

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const admin = supabaseAdmin as any;
    const { data, error } = await admin
      .from("user")
      .select("id, email, name, avatar_url, role")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ user: data ?? null });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      clearAvatar?: unknown;
    };

    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const trimmed = body.name.trim();
      if (trimmed.length === 0 || trimmed.length > 80) {
        return NextResponse.json(
          { error: "Name must be 1–80 characters." },
          { status: 400 },
        );
      }
      updates.name = trimmed;
    }
    if (body.clearAvatar === true) {
      updates.avatar_url = null;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const admin = supabaseAdmin as any;
    const { data, error } = await admin
      .from("user")
      .update(updates)
      .eq("id", userId)
      .select("id, email, name, avatar_url, role")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ user: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
