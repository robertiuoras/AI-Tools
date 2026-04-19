"use client";

import { ReactNode, useCallback } from "react";
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react";
import { useAuthSession } from "@/components/AuthSessionProvider";

/**
 * Wraps children in a Liveblocks <RoomProvider> for a single whiteboard
 * room. Auth flows through /api/liveblocks/auth, with the supabase
 * access token attached so the server can verify
 * ownership/share access.
 *
 * Pass `ownerId` (the user who owns the snapshot) when joining a board
 * shared with you — it short-circuits the lookup on the auth route.
 *
 * No-ops if the user isn't signed in yet — children render outside any
 * Liveblocks context, so the whiteboard falls back to its non-collab
 * codepath (still saves locally to Supabase storage).
 */
export function WhiteboardRoomMount({
  boardId,
  ownerId,
  children,
}: {
  boardId: string;
  ownerId?: string | null;
  children: ReactNode;
}) {
  const { accessToken } = useAuthSession();

  const authCallback = useCallback(
    async (room?: string) => {
      const roomId = room ?? `whiteboard:${boardId}`;
      const res = await fetch("/api/liveblocks/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          room: roomId,
          ownerId: ownerId ?? undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Liveblocks auth failed (${res.status}): ${text}`);
      }
      return await res.json();
    },
    [accessToken, boardId, ownerId],
  );

  // We always mount the provider (the parent only renders us when the
  // user is signed in). If the access token isn't ready yet the auth
  // callback will fail, Liveblocks will retry once it is — children
  // render normally (no remote presence) in the meantime.
  return (
    <LiveblocksProvider authEndpoint={authCallback}>
      <RoomProvider
        id={`whiteboard:${boardId}`}
        initialPresence={{
          pointer: null,
          button: "up",
          selectedElementIds: {},
        }}
      >
        {children}
      </RoomProvider>
    </LiveblocksProvider>
  );
}
