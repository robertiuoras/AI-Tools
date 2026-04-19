import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId } from "@/lib/notes-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/whiteboard/shared
 * Lists every whiteboard that has been shared with the current user.
 *
 * Returns a flat array of:
 *   { boardId, ownerId, boardName, permission, createdAt, updatedAt,
 *     owner: { id, email, name, avatar_url } | null }
 *
 * Snapshot files still live at <ownerId>/<boardId>.json in the
 * `user-whiteboard` bucket — recipients fetch them via
 *   GET /api/whiteboard?boardId=<id>&ownerId=<owner>
 * which validates the share before serving.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin as any;
    const { data: shares, error } = await admin
      .from("whiteboard_share")
      .select(
        "id, board_id, owner_id, shared_with_id, board_name, permission, created_at, updated_at",
      )
      .eq("shared_with_id", userId)
      .order("updated_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const ownerIds = Array.from(
      new Set((shares ?? []).map((s: { owner_id: string }) => s.owner_id)),
    );
    const ownerMap = new Map<
      string,
      { id: string; email: string; name: string | null; avatar_url: string | null }
    >();
    if (ownerIds.length > 0) {
      const { data: owners } = await admin
        .from("user")
        .select("id, email, name, avatar_url")
        .in("id", ownerIds);
      for (const u of owners ?? []) ownerMap.set(u.id, u);
    }

    const out = (shares ?? []).map(
      (s: {
        id: string;
        board_id: string;
        owner_id: string;
        board_name: string | null;
        permission: "view" | "edit";
        created_at: string;
        updated_at: string;
      }) => ({
        shareId: s.id,
        boardId: s.board_id,
        ownerId: s.owner_id,
        boardName: s.board_name ?? "Untitled board",
        permission: s.permission,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        owner: ownerMap.get(s.owner_id) ?? null,
      }),
    );

    return NextResponse.json({ boards: out });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
