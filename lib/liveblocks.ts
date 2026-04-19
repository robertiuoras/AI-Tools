import { Liveblocks } from "@liveblocks/node";

/**
 * Server-side Liveblocks client (Node SDK). Used by /api/liveblocks/auth
 * to mint short-lived access tokens for the current user, scoped to the
 * specific note room they're allowed to access.
 *
 * Required env vars (set in Vercel + .env.local):
 *   LIVEBLOCKS_SECRET_KEY=sk_dev_...   (or sk_prod_...)
 *
 * Sign up at https://liveblocks.io — the free tier covers 100 MAU which
 * is plenty for a hobby project. No public key needed; we use the
 * `authEndpoint` flow so the secret never reaches the browser.
 */

const secretKey = process.env.LIVEBLOCKS_SECRET_KEY ?? "";

export const liveblocks = secretKey
  ? new Liveblocks({ secret: secretKey })
  : null;

export function isLiveblocksConfigured(): boolean {
  return liveblocks !== null;
}

/** Stable room id for a given note. Keep in sync with the client. */
export function noteRoomId(noteId: string): string {
  return `note:${noteId}`;
}

/** Stable room id for a given whiteboard. Keep in sync with the client. */
export function whiteboardRoomId(boardId: string): string {
  return `whiteboard:${boardId}`;
}
