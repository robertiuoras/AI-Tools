import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId, resolveNoteAccess } from "@/lib/notes-auth";

/**
 * GET  /api/notes/:id/shares — list all shares for a note (owner only).
 * POST /api/notes/:id/shares — share a note with another user by email.
 *   Body: { email: string, permission: "view" | "edit" }
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const access = await resolveNoteAccess(userId, id);
    if (access.kind !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = supabaseAdmin as any;
    const { data: shares, error } = await admin
      .from("note_share")
      .select("id, noteId, ownerId, sharedWithId, permission, createdAt, updatedAt")
      .eq("noteId", id)
      .order("createdAt", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const recipientIds = Array.from(
      new Set((shares ?? []).map((s: { sharedWithId: string }) => s.sharedWithId)),
    );
    let userMap = new Map<string, { id: string; email: string; name: string | null }>();
    if (recipientIds.length > 0) {
      const { data: users } = await admin
        .from("user")
        .select("id, email, name")
        .in("id", recipientIds);
      for (const u of users ?? []) userMap.set(u.id, u);
    }
    const enriched = (shares ?? []).map((s: any) => ({
      ...s,
      sharedWith: userMap.get(s.sharedWithId) ?? null,
    }));
    return NextResponse.json(enriched);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const permission =
      body?.permission === "edit" ? "edit" : body?.permission === "view" ? "view" : "view";
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const access = await resolveNoteAccess(userId, id);
    if (access.kind !== "owner") {
      return NextResponse.json({ error: "Only the owner can share" }, { status: 403 });
    }

    const admin = supabaseAdmin as any;
    const { data: targetUser, error: findErr } = await admin
      .from("user")
      .select("id, email, name")
      .ilike("email", email)
      .maybeSingle();
    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
    if (!targetUser) {
      return NextResponse.json(
        { error: "No account found for that email" },
        { status: 404 },
      );
    }
    if (targetUser.id === userId) {
      return NextResponse.json(
        { error: "You can't share a note with yourself" },
        { status: 400 },
      );
    }

    // Upsert by (noteId, sharedWithId)
    const { data: existing } = await admin
      .from("note_share")
      .select("id")
      .eq("noteId", id)
      .eq("sharedWithId", targetUser.id)
      .maybeSingle();

    let row;
    if (existing?.id) {
      const { data, error } = await admin
        .from("note_share")
        .update({ permission })
        .eq("id", existing.id)
        .select("id, noteId, ownerId, sharedWithId, permission, createdAt, updatedAt")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      row = data;
    } else {
      const { data, error } = await admin
        .from("note_share")
        .insert([
          { noteId: id, ownerId: userId, sharedWithId: targetUser.id, permission },
        ])
        .select("id, noteId, ownerId, sharedWithId, permission, createdAt, updatedAt")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      row = data;
    }

    return NextResponse.json(
      { ...row, sharedWith: targetUser },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
