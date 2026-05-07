"use client";

import { ReactNode } from "react";
import { RoomProvider } from "@liveblocks/react";
import { useAuthSession } from "@/components/AuthSessionProvider";

/**
 * Wraps children in a Liveblocks <RoomProvider> scoped to a single whiteboard
 * room. Auth is handled by the ancestor <NotesLiveblocksProvider> — this
 * component deliberately does NOT add its own <LiveblocksProvider> to avoid
 * the "cannot nest multiple LiveblocksProvider instances" crash.
 *
 * No-ops until the auth session is ready (guards against mounting RoomProvider
 * before its ancestor LiveblocksProvider is active).
 *
 * `ownerId` is kept in the interface so callers don't need to change; the auth
 * route resolves shared-board access without it (it is an optional speed hint).
 */
export function WhiteboardRoomMount({
  boardId,
  children,
}: {
  boardId: string;
  ownerId?: string | null;
  children: ReactNode;
}) {
  const { accessToken, isReady } = useAuthSession();

  if (!isReady || !accessToken) return <>{children}</>;

  return (
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
  );
}
