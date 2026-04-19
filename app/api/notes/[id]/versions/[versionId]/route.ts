import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId, resolveNoteAccess } from "@/lib/notes-auth";
import { snapshotNoteVersion } from "@/lib/note-versions";

/**
 * GET /api/notes/:id/versions/:versionId
 * Returns the full content of a specific version (for preview before
 * reverting). Read access mirrors the note: owner or any accepted share.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, versionId } = await params;

    const access = await resolveNoteAccess(userId, id);
    if (access.kind === "none") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const admin = supabaseAdmin as any;
    const { data: version, error } = await admin
      .from("note_version")
      .select("id, note_id, title, content, created_at, author_id")
      .eq("id", versionId)
      .eq("note_id", id)
      .single();

    if (error || !version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: version.id,
      title: version.title,
      content: version.content,
      createdAt: version.created_at,
      authorId: version.author_id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/notes/:id/versions/:versionId
 * Reverts the note to the contents of the specified version. Permitted for
 * the owner OR users with edit-level share access (matches the user's
 * stated policy: "owner + anyone with edit permission").
 *
 * Implementation: we snapshot the *current* state first (so the revert
 * itself is undoable), then overwrite the live note with the version's
 * title/content. Liveblocks-connected clients will receive the new server
 * state when they next reload the note (or via the client-side reload we
 * trigger after a successful revert).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, versionId } = await params;

    const access = await resolveNoteAccess(userId, id);
    if (access.kind === "none") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const canRevert =
      access.kind === "owner" ||
      (access.kind === "share" && access.permission === "edit");
    if (!canRevert) {
      return NextResponse.json(
        { error: "Forbidden: view-only access" },
        { status: 403 },
      );
    }

    const admin = supabaseAdmin as any;

    // Load target version (must belong to this note).
    const { data: version, error: vErr } = await admin
      .from("note_version")
      .select("id, title, content")
      .eq("id", versionId)
      .eq("note_id", id)
      .single();
    if (vErr || !version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Snapshot current state before clobbering it.
    const { data: current } = await admin
      .from("note")
      .select("title, content")
      .eq("id", id)
      .single();
    if (current) {
      try {
        await snapshotNoteVersion({
          noteId: id,
          authorId: userId,
          title: current.title ?? "Untitled Note",
          content: current.content ?? "",
        });
      } catch (err) {
        console.error("[notes] pre-revert snapshot failed", err);
      }
    }

    // Apply the revert.
    const { data: updated, error: uErr } = await admin
      .from("note")
      .update({ title: version.title, content: version.content })
      .eq("id", id)
      .select("*")
      .single();
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    return NextResponse.json({ note: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
