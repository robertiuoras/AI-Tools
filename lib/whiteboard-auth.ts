import { supabaseAdmin } from "@/lib/supabase";

/**
 * Whiteboard access model:
 *   - "owner"  — the user is the board's owner (board id appears in their
 *                __boards__.json metadata file).
 *   - "share"  — the user has an explicit row in `whiteboard_share` for
 *                this (board_id, shared_with_id) pair.
 *   - "none"   — neither.
 *
 * Snapshots are stored at `<ownerId>/<boardId>.json` in the
 * `user-whiteboard` storage bucket; `ownerId` is part of the access
 * record so a recipient can locate the snapshot without it being
 * encoded in the URL.
 */
export type WhiteboardAccess =
  | { kind: "owner"; ownerId: string }
  | { kind: "share"; ownerId: string; permission: "view" | "edit" }
  | { kind: "none" };

const WHITEBOARD_BUCKET = "user-whiteboard";

interface BoardMeta {
  id: string;
  name: string;
  updatedAt: string;
}

async function readOwnerBoardsMeta(ownerId: string): Promise<BoardMeta[]> {
  const admin = supabaseAdmin as any;
  try {
    const { data, error } = await admin.storage
      .from(WHITEBOARD_BUCKET)
      .download(`${ownerId}/__boards__.json`);
    if (error || !data) return [];
    const text = await (data as Blob).text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as BoardMeta[]) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve what access `userId` has to a board, optionally given a hint
 * about who the owner is (`ownerHintId` from the request). Lookup order:
 *
 *   1. If ownerHintId === userId AND boardId is in their meta → "owner".
 *      Also accept boardId === "default" (the seeded virtual board) so
 *      brand-new accounts can edit before persisting.
 *   2. Otherwise look up `whiteboard_share` for an explicit share row
 *      → "share" with that owner_id + permission.
 *   3. Otherwise check whether boardId is in userId's own meta (catches
 *      the case where the client didn't supply ownerHintId).
 *
 * Returns "none" when no match.
 */
export async function resolveWhiteboardAccess(
  userId: string,
  boardId: string,
  ownerHintId?: string | null,
): Promise<WhiteboardAccess> {
  if (!boardId) return { kind: "none" };

  // 1) Try the hinted owner first.
  if (ownerHintId && ownerHintId === userId) {
    if (boardId === "default") return { kind: "owner", ownerId: userId };
    const meta = await readOwnerBoardsMeta(userId);
    if (meta.some((b) => b.id === boardId)) {
      return { kind: "owner", ownerId: userId };
    }
  }

  // 2) Share table lookup.
  const admin = supabaseAdmin as any;
  const { data: share } = await admin
    .from("whiteboard_share")
    .select("owner_id, permission")
    .eq("board_id", boardId)
    .eq("shared_with_id", userId)
    .maybeSingle();
  if (share?.owner_id) {
    return {
      kind: "share",
      ownerId: share.owner_id as string,
      permission: share.permission === "edit" ? "edit" : "view",
    };
  }

  // 3) Fallback — caller didn't pass ownerHintId; check our own meta.
  if (!ownerHintId || ownerHintId !== userId) {
    if (boardId === "default") return { kind: "owner", ownerId: userId };
    const meta = await readOwnerBoardsMeta(userId);
    if (meta.some((b) => b.id === boardId)) {
      return { kind: "owner", ownerId: userId };
    }
  }

  return { kind: "none" };
}

export const WHITEBOARD_BUCKET_NAME = WHITEBOARD_BUCKET;
