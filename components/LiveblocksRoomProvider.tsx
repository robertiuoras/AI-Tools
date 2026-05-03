"use client";

import { ReactNode, useCallback } from "react";
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react";
import { useAuthSession } from "@/components/AuthSessionProvider";

/**
 * Notes-page Liveblocks setup, split in two so the WebSocket connection
 * survives note switches:
 *
 *   <NotesLiveblocksProvider>     ← mounted ONCE near the top of the
 *                                    notes page. Owns the auth callback
 *                                    and the underlying WebSocket.
 *     ...
 *     <LiveblocksRoomProvider     ← mounted PER note (key={noteId}).
 *       noteId={selectedNote.id}    Only swaps the inner RoomProvider,
 *       key={selectedNote.id}>      reusing the existing connection.
 *       <CollaborativeNoteEditor />
 *     </LiveblocksRoomProvider>
 *
 * Auth flows through /api/liveblocks/auth, with the supabase access
 * token attached so the server can verify ownership/share access.
 */

export function NotesLiveblocksProvider({ children }: { children: ReactNode }) {
  const { accessToken, isReady } = useAuthSession();

  // Liveblocks passes the room id to the auth callback, so a single
  // provider can serve every per-note RoomProvider mounted under it.
  const authCallback = useCallback(
    async (room?: string) => {
      const res = await fetch("/api/liveblocks/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ room }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Liveblocks auth failed (${res.status}): ${text}`);
      }
      return await res.json();
    },
    [accessToken],
  );

  // Until the user is signed in, render children outside any Liveblocks
  // context — RoomProvider will simply not connect, and the editor falls
  // back to its non-collab codepath via the `fallback` prop below.
  if (!isReady || !accessToken) return <>{children}</>;

  return (
    <LiveblocksProvider authEndpoint={authCallback}>{children}</LiveblocksProvider>
  );
}

export function LiveblocksRoomProvider({
  noteId,
  children,
  fallback,
}: {
  noteId: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { accessToken, isReady } = useAuthSession();
  // Same gate as NotesLiveblocksProvider — without auth there's no
  // connection, so just render the static fallback (saved HTML preview).
  if (!isReady || !accessToken) return <>{fallback ?? children}</>;

  return (
    <RoomProvider id={`note:${noteId}`} initialPresence={EMPTY_PRESENCE}>
      {children}
    </RoomProvider>
  );
}

// Stable reference so RoomProvider doesn't see a "new" presence object
// on every parent re-render.
const EMPTY_PRESENCE = Object.freeze({});
