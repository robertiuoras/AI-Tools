"use client";

import { ReactNode, useCallback } from "react";
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react";
import { useAuthSession } from "@/components/AuthSessionProvider";

/**
 * Wraps children in a Liveblocks <RoomProvider> for a single note room.
 * Auth flows through our /api/liveblocks/auth endpoint, with the supabase
 * access token attached so the server can verify ownership/share access.
 *
 * No-ops if the user isn't signed in yet — children render outside any
 * Liveblocks context, so the editor shell falls back to its non-collab
 * codepath.
 */
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

  const authCallback = useCallback(
    async (room?: string) => {
      const roomId = room ?? `note:${noteId}`;
      const res = await fetch("/api/liveblocks/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ room: roomId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Liveblocks auth failed (${res.status}): ${text}`);
      }
      return await res.json();
    },
    [accessToken, noteId],
  );

  if (!isReady || !accessToken) return <>{fallback ?? children}</>;

  return (
    <LiveblocksProvider authEndpoint={authCallback}>
      <RoomProvider id={`note:${noteId}`} initialPresence={{}}>
        {children}
      </RoomProvider>
    </LiveblocksProvider>
  );
}
