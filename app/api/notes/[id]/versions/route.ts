import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId, resolveNoteAccess } from "@/lib/notes-auth";

/**
 * GET /api/notes/:id/versions
 * Returns the version history for a note, newest first. Capped at 100 rows.
 * Requires the caller to be the owner OR have an accepted share for the note.
 *
 * Each row includes the author's display name + avatar so the UI can
 * render "Version by Alex • 2 minutes ago" without N+1 lookups.
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
    if (access.kind === "none") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const admin = supabaseAdmin as any;
    const { data: versions, error } = await admin
      .from("note_version")
      .select("id, author_id, title, created_at")
      .eq("note_id", id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Resolve author names in one batch.
    const authorIds = Array.from(
      new Set((versions ?? []).map((v: any) => v.author_id).filter(Boolean)),
    );
    let authors: Record<string, { name: string; email: string | null }> = {};
    if (authorIds.length > 0) {
      const { data: users } = await admin
        .from("user")
        .select("id, email, name")
        .in("id", authorIds);
      for (const u of users ?? []) {
        authors[u.id] = {
          name: (u.name as string)?.trim() || (u.email as string)?.split("@")[0] || "User",
          email: u.email ?? null,
        };
      }
    }

    return NextResponse.json({
      versions: (versions ?? []).map((v: any) => ({
        id: v.id,
        title: v.title,
        createdAt: v.created_at,
        author: v.author_id
          ? authors[v.author_id] ?? { name: "User", email: null }
          : { name: "Unknown", email: null },
      })),
      canRevert:
        access.kind === "owner" ||
        (access.kind === "share" && access.permission === "edit"),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
