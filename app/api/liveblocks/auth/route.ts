import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId, resolveNoteAccess } from "@/lib/notes-auth";
import { resolveWhiteboardAccess } from "@/lib/whiteboard-auth";
import {
  liveblocks,
  noteRoomId,
  whiteboardRoomId,
  isLiveblocksConfigured,
} from "@/lib/liveblocks";

/**
 * POST /api/liveblocks/auth
 * Body: { room: "note:<noteId>" | "whiteboard:<boardId>" }
 *
 * Issues a Liveblocks access token scoped to the requested room, but
 * ONLY if the Supabase-authenticated user is the owner OR has an
 * accepted share for that resource. The token grants:
 *   - "FULL" (read + write) when access is owner or share+edit
 *   - "READ" when access is share+view
 */
export async function POST(request: NextRequest) {
  try {
    if (!isLiveblocksConfigured() || !liveblocks) {
      return NextResponse.json(
        { error: "Liveblocks not configured (missing LIVEBLOCKS_SECRET_KEY)" },
        { status: 503 },
      );
    }

    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const room = typeof body?.room === "string" ? body.room : "";

    let resourceRoomId: string;
    let canEdit: boolean;

    if (room.startsWith("note:")) {
      const noteId = room.slice("note:".length);
      if (!noteId) {
        return NextResponse.json({ error: "Invalid room" }, { status: 400 });
      }
      const access = await resolveNoteAccess(userId, noteId);
      if (access.kind === "none") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      canEdit =
        access.kind === "owner" ||
        (access.kind === "share" && access.permission === "edit");
      resourceRoomId = noteRoomId(noteId);
    } else if (room.startsWith("whiteboard:")) {
      const boardId = room.slice("whiteboard:".length);
      if (!boardId) {
        return NextResponse.json({ error: "Invalid room" }, { status: 400 });
      }
      // ownerHint comes from the client when joining a board they don't
      // own, to short-circuit the lookup. Optional — resolve still works
      // without it.
      const ownerHintId =
        typeof body?.ownerId === "string" && body.ownerId.length > 0
          ? body.ownerId
          : null;
      const access = await resolveWhiteboardAccess(userId, boardId, ownerHintId);
      if (access.kind === "none") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      canEdit =
        access.kind === "owner" ||
        (access.kind === "share" && access.permission === "edit");
      resourceRoomId = whiteboardRoomId(boardId);
    } else {
      return NextResponse.json({ error: "Invalid room" }, { status: 400 });
    }

    // Lookup user metadata for the presence card (name + email + colour
    // + avatar). The name + avatar can be customized via the Profile
    // settings dialog; we read the latest values here so any user
    // joining a room sees the up-to-date identity.
    const admin = supabaseAdmin as any;
    // Try the extended select first (post-migration). If the
    // preferences columns aren't there yet, retry with the base
    // columns so users who haven't run
    // supabase-migration-user-preferences.sql can still join rooms.
    let { data: userRow, error: userErr } = await admin
      .from("user")
      .select("id, email, name, avatar_url, cursor_color, bio")
      .eq("id", userId)
      .maybeSingle();
    if (
      userErr &&
      (userErr.code === "42703" ||
        /column .* does not exist/i.test(userErr.message ?? ""))
    ) {
      ({ data: userRow } = await admin
        .from("user")
        .select("id, email, name, avatar_url")
        .eq("id", userId)
        .maybeSingle());
    }

    const displayName =
      (userRow?.name as string | undefined)?.trim() ||
      (userRow?.email as string | undefined)?.split("@")[0] ||
      "Anonymous";
    // Prefer the user's chosen accent colour from Profile settings.
    // Fall back to the deterministic palette so legacy users without a
    // saved colour keep the same look.
    const customColour = (userRow?.cursor_color as string | null | undefined)?.trim();
    const colour =
      customColour && customColour.length > 0
        ? customColour
        : colourForUserId(userId);
    const bio = (userRow?.bio as string | null | undefined)?.trim() || undefined;

    const session = liveblocks.prepareSession(userId, {
      userInfo: {
        name: displayName,
        email: userRow?.email ?? null,
        color: colour,
        avatar: (userRow?.avatar_url as string | null | undefined) ?? undefined,
        bio,
      },
    });
    session.allow(resourceRoomId, canEdit ? session.FULL_ACCESS : session.READ_ACCESS);

    const { status, body: tokenBody } = await session.authorize();
    return new NextResponse(tokenBody, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/** Stable per-user colour for the presence cursor. Picks from a curated palette. */
const PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#f43f5e", // rose
  "#14b8a6", // teal
];
function colourForUserId(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
