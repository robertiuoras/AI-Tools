import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId, resolveNoteAccess } from "@/lib/notes-auth";
import { liveblocks, noteRoomId, isLiveblocksConfigured } from "@/lib/liveblocks";

/**
 * POST /api/liveblocks/auth
 * Body: { room: "note:<noteId>" }
 *
 * Issues a Liveblocks access token scoped to the requested note room,
 * but ONLY if the Supabase-authenticated user is the owner OR has an
 * accepted share for that note. The token grants:
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
    if (!room.startsWith("note:")) {
      return NextResponse.json({ error: "Invalid room" }, { status: 400 });
    }
    const noteId = room.slice("note:".length);
    if (!noteId) return NextResponse.json({ error: "Invalid room" }, { status: 400 });

    const access = await resolveNoteAccess(userId, noteId);
    if (access.kind === "none") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const canEdit =
      access.kind === "owner" ||
      (access.kind === "share" && access.permission === "edit");

    // Lookup user metadata for the presence card (name + email + colour
    // + avatar). The name + avatar can be customized via the Profile
    // settings dialog; we read the latest values here so any user
    // joining a room sees the up-to-date identity.
    const admin = supabaseAdmin as any;
    const { data: userRow } = await admin
      .from("user")
      .select("id, email, name, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    const displayName =
      (userRow?.name as string | undefined)?.trim() ||
      (userRow?.email as string | undefined)?.split("@")[0] ||
      "Anonymous";
    const colour = colourForUserId(userId);

    const session = liveblocks.prepareSession(userId, {
      userInfo: {
        name: displayName,
        email: userRow?.email ?? null,
        color: colour,
        avatar: (userRow?.avatar_url as string | null | undefined) ?? undefined,
      },
    });
    session.allow(noteRoomId(noteId), canEdit ? session.FULL_ACCESS : session.READ_ACCESS);

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
