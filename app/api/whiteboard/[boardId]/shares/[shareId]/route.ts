import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId } from "@/lib/notes-auth";
import { resolveWhiteboardAccess } from "@/lib/whiteboard-auth";
import { createNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/whiteboard/:boardId/shares/:shareId  (owner only)
 *   → revokes the share. Notifies the recipient (in-app only — emails
 *     for unshare events would be noisy).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; shareId: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { boardId, shareId } = await params;

    const access = await resolveWhiteboardAccess(userId, boardId, userId);
    if (access.kind !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = supabaseAdmin as any;
    const { data: existing, error: fetchErr } = await admin
      .from("whiteboard_share")
      .select("id, board_id, owner_id, shared_with_id, board_name")
      .eq("id", shareId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }
    if (existing.board_id !== boardId) {
      return NextResponse.json(
        { error: "Share does not belong to this board" },
        { status: 400 },
      );
    }

    const { error: delErr } = await admin
      .from("whiteboard_share")
      .delete()
      .eq("id", shareId);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    // In-app notification only.
    void createNotification({
      userId: existing.shared_with_id,
      type: "whiteboard_unshared",
      title: "A whiteboard share was revoked",
      body: existing.board_name
        ? `Your access to "${existing.board_name}" was removed.`
        : "Your access to a whiteboard was removed.",
      payload: { boardId: existing.board_id, ownerId: existing.owner_id },
    }).catch((e) =>
      console.error("[whiteboard-share] unshare notify failed:", e),
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
