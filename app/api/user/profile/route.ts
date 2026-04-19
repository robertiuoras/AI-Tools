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

// Postgres "undefined column" error code returned by PostgREST when a
// column referenced in `select` doesn't exist (i.e. the user hasn't
// applied the new preferences migration yet). We use this to fall back
// to the base columns so the dialog still loads on partially-migrated
// installs.
const PG_UNDEFINED_COLUMN = "42703";

const BASE_COLUMNS = "id, email, name, avatar_url, role";
const EXTENDED_COLUMNS =
  "id, email, name, avatar_url, role, bio, cursor_color, theme_pref, email_notifications";

function isUndefinedColumn(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === PG_UNDEFINED_COLUMN) return true;
  return /column .* does not exist/i.test(e.message ?? "");
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const admin = supabaseAdmin as any;

    // Try the extended select first (post-migration). If the new
    // columns aren't there yet, retry with the base set so the page
    // doesn't break for users who haven't run
    // supabase-migration-user-preferences.sql yet.
    let { data, error } = await admin
      .from("user")
      .select(EXTENDED_COLUMNS)
      .eq("id", userId)
      .maybeSingle();
    if (error && isUndefinedColumn(error)) {
      ({ data, error } = await admin
        .from("user")
        .select(BASE_COLUMNS)
        .eq("id", userId)
        .maybeSingle());
    }
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
      bio?: unknown;
      cursorColor?: unknown;
      themePref?: unknown;
      emailNotifications?: unknown;
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
    if (body.bio === null || typeof body.bio === "string") {
      const trimmed =
        typeof body.bio === "string" ? body.bio.trim() : null;
      if (trimmed && trimmed.length > 280) {
        return NextResponse.json(
          { error: "Bio must be 280 characters or fewer." },
          { status: 400 },
        );
      }
      updates.bio = trimmed && trimmed.length > 0 ? trimmed : null;
    }
    if (body.cursorColor === null || typeof body.cursorColor === "string") {
      const raw =
        typeof body.cursorColor === "string" ? body.cursorColor.trim() : null;
      // Accept hex (#abc, #abcdef) or hsl(...) — anything reasonable up
      // to 32 chars. Sanitize obviously bad input.
      if (raw && raw.length > 32) {
        return NextResponse.json(
          { error: "Cursor colour string is too long." },
          { status: 400 },
        );
      }
      updates.cursor_color = raw && raw.length > 0 ? raw : null;
    }
    if (typeof body.themePref === "string") {
      const v = body.themePref.toLowerCase();
      if (v !== "light" && v !== "dark" && v !== "system") {
        return NextResponse.json(
          { error: "themePref must be 'light', 'dark', or 'system'." },
          { status: 400 },
        );
      }
      updates.theme_pref = v;
    }
    if (typeof body.emailNotifications === "boolean") {
      updates.email_notifications = body.emailNotifications;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const admin = supabaseAdmin as any;

    // Same migration-tolerance as GET: if any of the new preference
    // columns don't exist yet, retry with only the base columns so
    // partially-migrated installs can still update their name/avatar.
    let attemptUpdates = updates;
    let { data, error } = await admin
      .from("user")
      .update(attemptUpdates)
      .eq("id", userId)
      .select(EXTENDED_COLUMNS)
      .single();
    if (error && isUndefinedColumn(error)) {
      const allowed = new Set([
        "name",
        "avatar_url",
        "email",
        "role",
      ]);
      attemptUpdates = Object.fromEntries(
        Object.entries(updates).filter(([k]) => allowed.has(k)),
      );
      if (Object.keys(attemptUpdates).length === 0) {
        return NextResponse.json(
          {
            error:
              "Profile customisations require the user-preferences migration. Run supabase-migration-user-preferences.sql in Supabase SQL editor.",
          },
          { status: 503 },
        );
      }
      ({ data, error } = await admin
        .from("user")
        .update(attemptUpdates)
        .eq("id", userId)
        .select(BASE_COLUMNS)
        .single());
    }
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
