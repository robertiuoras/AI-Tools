import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId, resolveNoteAccess } from "@/lib/notes-auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await request.json();

    const access = await resolveNoteAccess(userId, id);
    if (access.kind === "none") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (typeof body?.title === "string") updateData.title = body.title.trim() || "Untitled Note";
    if (typeof body?.content === "string") updateData.content = body.content;
    if (typeof body?.favorite === "boolean") updateData.favorite = body.favorite;

    if (access.kind === "share") {
      // Recipients can only edit content/title (and only if they have edit
      // permission). Favorite is owner-only and they can't change ownership.
      if (access.permission !== "edit") {
        return NextResponse.json(
          { error: "Forbidden: view-only access" },
          { status: 403 },
        );
      }
      delete updateData.favorite;
    }

    const admin = supabaseAdmin as any;
    let query = admin.from("note").update(updateData).eq("id", id);
    if (access.kind === "owner") query = query.eq("userId", userId);
    const { data, error } = await query.select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const admin = supabaseAdmin as any;
    // Only the owner can delete the underlying note. Recipients should remove
    // the note from their library by deleting their share row, not the note.
    const { error } = await admin
      .from("note")
      .delete()
      .eq("id", id)
      .eq("userId", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
