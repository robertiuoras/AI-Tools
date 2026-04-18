import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId, resolveNoteAccess } from "@/lib/notes-auth";

/**
 * PATCH /api/notes/:id/shares/:shareId — change permission (owner)
 *   Body: { permission: "view" | "edit" }
 * DELETE /api/notes/:id/shares/:shareId — revoke share (owner OR recipient
 *   removing the note from their own library)
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, shareId } = await params;
    const body = await request.json().catch(() => ({}));
    const permission = body?.permission === "edit" ? "edit" : "view";

    const access = await resolveNoteAccess(userId, id);
    if (access.kind !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = supabaseAdmin as any;
    const { data, error } = await admin
      .from("note_share")
      .update({ permission })
      .eq("id", shareId)
      .eq("noteId", id)
      .eq("ownerId", userId)
      .select("id, noteId, ownerId, sharedWithId, permission, createdAt, updatedAt")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, shareId } = await params;

    const admin = supabaseAdmin as any;
    // Allow either the owner OR the recipient to delete their own share row.
    const { data: share } = await admin
      .from("note_share")
      .select("id, ownerId, sharedWithId")
      .eq("id", shareId)
      .eq("noteId", id)
      .maybeSingle();
    if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (share.ownerId !== userId && share.sharedWithId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await admin.from("note_share").delete().eq("id", shareId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
