"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Loader2, Eye } from "lucide-react";
import {
  useBroadcastEvent,
  useEventListener,
  useOthers,
  useUpdateMyPresence,
} from "@liveblocks/react";
import { useUserProfile } from "@/components/UserProfileProvider";
import { isBoardMarkedDeleted } from "@/lib/whiteboard-deleted-ids";

export type ToolbarPosition = "top" | "bottom" | "left" | "right";

interface Props {
  token: string;
  boardId: string;
  /** Where the Excalidraw shape toolbar sits. Defaults to "top". */
  toolbarPosition?: ToolbarPosition;
  /**
   * For shared boards, the id of the user who owns the snapshot. The
   * save endpoint uses this to know whose folder to write to. Omit for
   * your own boards.
   */
  ownerId?: string | null;
  /** "view" → Excalidraw is locked (view-only). "edit" → full collab. */
  permission?: "view" | "edit";
}

const AUTOSAVE_INTERVAL_MS = 30_000;
const AUTOSAVE_DEBOUNCE_MS = 1_500;
const SCENE_BROADCAST_DEBOUNCE_MS = 75;
const POINTER_THROTTLE_MS = 60;

// `isBoardMarkedDeleted` lives in lib/whiteboard-deleted-ids.ts so the
// marker set can be imported by WhiteboardPanel without dragging
// Excalidraw's window-touching bundle into the panel's tree.

type ExcalidrawElement = Readonly<{ id: string; [k: string]: unknown }>;
type ExcalidrawAppState = { [k: string]: unknown };
type ExcalidrawBinaryFiles = { [k: string]: unknown };

interface PersistedSnapshot {
  v: 2;
  source: "excalidraw";
  elements: ExcalidrawElement[];
  appState: ExcalidrawAppState;
  files: ExcalidrawBinaryFiles;
}

const PERSISTED_APP_STATE_KEYS = [
  "viewBackgroundColor",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemOpacity",
  "currentItemRoundness",
  "gridSize",
  "theme",
  "zenModeEnabled",
] as const;

function pickAppState(state: ExcalidrawAppState): ExcalidrawAppState {
  const out: ExcalidrawAppState = {};
  for (const k of PERSISTED_APP_STATE_KEYS) {
    if (k in state) out[k] = state[k];
  }
  return out;
}

async function postSave(
  token: string,
  boardId: string,
  snapshot: PersistedSnapshot,
  ownerId: string | null,
): Promise<{ gone: boolean }> {
  const res = await fetch("/api/whiteboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: "save",
      boardId,
      snapshot,
      ...(ownerId ? { ownerId } : {}),
    }),
  });
  if (res.status === 410) {
    // Board was deleted on the server. Caller will mark it dead so we
    // don't keep trying to autosave (and worse, recreating it).
    return { gone: true };
  }
  if (!res.ok) console.warn("[whiteboard] Save failed:", res.status);
  return { gone: false };
}

/**
 * Compute a cheap fingerprint of element ids+versions so we can
 * skip work / suppress echoes when the scene didn't actually change.
 */
function fingerprint(elements: readonly ExcalidrawElement[]): string {
  if (elements.length === 0) return "0";
  const parts: string[] = [String(elements.length)];
  for (const el of elements) {
    parts.push(
      `${el.id}.${(el as { version?: number }).version ?? ""}.${(el as { versionNonce?: number }).versionNonce ?? ""}`,
    );
  }
  return parts.join("|");
}

/**
 * Reconcile remote elements with local elements using Excalidraw's
 * version-based last-write-wins semantics. We pick the higher version
 * for each id; ties broken by versionNonce. New ids on either side
 * are kept. This avoids stomping local edits with stale remote ones
 * when broadcasts cross paths.
 */
function reconcile(
  local: readonly ExcalidrawElement[],
  remote: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  const map = new Map<string, ExcalidrawElement>();
  for (const el of local) map.set(el.id, el);
  for (const el of remote) {
    const existing = map.get(el.id);
    if (!existing) {
      map.set(el.id, el);
      continue;
    }
    const lv = (existing as { version?: number }).version ?? 0;
    const rv = (el as { version?: number }).version ?? 0;
    if (rv > lv) {
      map.set(el.id, el);
    } else if (rv === lv) {
      const ln = (existing as { versionNonce?: number }).versionNonce ?? 0;
      const rn = (el as { versionNonce?: number }).versionNonce ?? 0;
      if (rn > ln) map.set(el.id, el);
    }
  }
  // Preserve a stable order matching the union of inputs (remote-first
  // for new ids, local-first for shared ones — Excalidraw uses array
  // order for z-index so we follow the most recent broadcast).
  const ordered: ExcalidrawElement[] = [];
  const seen = new Set<string>();
  for (const el of remote) {
    const v = map.get(el.id);
    if (v && !seen.has(el.id)) {
      ordered.push(v);
      seen.add(el.id);
    }
  }
  for (const el of local) {
    const v = map.get(el.id);
    if (v && !seen.has(el.id)) {
      ordered.push(v);
      seen.add(el.id);
    }
  }
  return ordered;
}

interface SceneEvent {
  type: "scene";
  elements: ExcalidrawElement[];
  fp: string;
}

type LiveblocksEvent = SceneEvent;

type ExcalidrawAPI = {
  getSceneElementsIncludingDeleted: () => readonly ExcalidrawElement[];
  updateScene: (scene: {
    elements?: readonly ExcalidrawElement[];
    appState?: Partial<ExcalidrawAppState>;
    collaborators?: Map<string, RemoteCollaborator>;
  }) => void;
};

interface RemoteCollaborator {
  username?: string;
  color?: { background: string; stroke: string };
  avatarUrl?: string | null;
  pointer?: { x: number; y: number; tool?: "pointer" | "laser" } | null;
  button?: "up" | "down";
  selectedElementIds?: { [id: string]: true };
  userState?: "active" | "away" | "idle";
}

export default function WhiteboardInner({
  token,
  boardId,
  toolbarPosition = "top",
  ownerId = null,
  permission = "edit",
}: Props) {
  const tokenRef = useRef(token);
  const boardIdRef = useRef(boardId);
  const ownerIdRef = useRef<string | null>(ownerId);
  tokenRef.current = token;
  boardIdRef.current = boardId;
  ownerIdRef.current = ownerId;
  const isViewOnly = permission === "view";

  const [initial, setInitial] = useState<PersistedSnapshot | null | undefined>(undefined);
  const latestRef = useRef<PersistedSnapshot | null>(null);
  const debounceRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  // Set when the server tells us the board is gone (410). Suppresses
  // every future save / beacon for this boardId so trailing autosaves
  // can't resurrect a deleted board.
  const goneRef = useRef(false);

  // ── Liveblocks bindings ─────────────────────────────────────────
  const broadcast = useBroadcastEvent();
  const updatePresence = useUpdateMyPresence();
  const others = useOthers();
  const { profile } = useUserProfile();

  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawAPI | null>(null);
  // Last fingerprint we either broadcast or applied from remote — used
  // to suppress no-op work and avoid re-broadcasting echoes.
  const lastSyncedFingerprintRef = useRef<string>("");
  const sceneBroadcastTimerRef = useRef<number | null>(null);
  const lastPointerSentAtRef = useRef<number>(0);

  // ── Snapshot load (initial) ────────────────────────────────────
  // Loads from the OWNER's folder when ownerId is set.
  useEffect(() => {
    let cancelled = false;
    setInitial(undefined);
    const params = new URLSearchParams({ boardId });
    if (ownerId) params.set("ownerId", ownerId);
    fetch(`/api/whiteboard?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { snapshot: unknown } | null) => {
        if (cancelled) return;
        const raw = data?.snapshot as PersistedSnapshot | null | undefined;
        if (raw && Array.isArray(raw.elements)) {
          setInitial(raw);
          lastSyncedFingerprintRef.current = fingerprint(raw.elements);
        } else {
          setInitial(null);
        }
      })
      .catch(() => {
        if (!cancelled) setInitial(null);
      });
    return () => { cancelled = true; };
  }, [token, boardId, ownerId]);

  // ── Local debounced save (Supabase storage) ─────────────────────
  const flush = useCallback(async () => {
    if (!latestRef.current || !dirtyRef.current) return;
    // Skip if view-only, server already said gone, or the user has
    // initiated a delete for this board (set by WhiteboardPanel before
    // unmount). The delete-set check is what closes the race window
    // that used to resurrect "Untitled" after deletion.
    if (
      isViewOnly ||
      goneRef.current ||
      isBoardMarkedDeleted(boardIdRef.current)
    ) {
      dirtyRef.current = false;
      return;
    }
    dirtyRef.current = false;
    const snap = latestRef.current;
    try {
      const res = await postSave(
        tokenRef.current,
        boardIdRef.current,
        snap,
        ownerIdRef.current,
      );
      if (res.gone) goneRef.current = true;
    } catch (e) {
      console.warn("[whiteboard] Save error:", e);
    }
  }, [isViewOnly]);

  useEffect(() => {
    const interval = window.setInterval(() => { void flush(); }, AUTOSAVE_INTERVAL_MS);
    const onBeforeUnload = () => {
      if (
        latestRef.current &&
        dirtyRef.current &&
        !isViewOnly &&
        !goneRef.current &&
        !isBoardMarkedDeleted(boardIdRef.current)
      ) {
        try {
          const blob = new Blob(
            [
              JSON.stringify({
                action: "save",
                boardId: boardIdRef.current,
                snapshot: latestRef.current,
                ...(ownerIdRef.current ? { ownerId: ownerIdRef.current } : {}),
              }),
            ],
            { type: "application/json" },
          );
          navigator.sendBeacon?.("/api/whiteboard", blob);
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flush();
    };
  }, [flush, boardId, isViewOnly]);

  // ── Local change handler: persist + broadcast ──────────────────
  const handleChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: ExcalidrawAppState,
      files: ExcalidrawBinaryFiles,
    ) => {
      const snap: PersistedSnapshot = {
        v: 2,
        source: "excalidraw",
        elements: elements as ExcalidrawElement[],
        appState: pickAppState(appState),
        files,
      };

      const fp = fingerprint(elements);
      const prevFp = lastSyncedFingerprintRef.current;
      if (fp === prevFp) {
        // No actual scene change — but DO update local snapshot ref so
        // appState changes (theme/zen-mode) are saved on the next flush.
        latestRef.current = snap;
        return;
      }
      lastSyncedFingerprintRef.current = fp;
      latestRef.current = snap;
      dirtyRef.current = true;

      // Persist (debounced).
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => { void flush(); }, AUTOSAVE_DEBOUNCE_MS);

      // Broadcast scene to other participants (debounced + skip in view-only).
      if (!isViewOnly) {
        if (sceneBroadcastTimerRef.current) {
          window.clearTimeout(sceneBroadcastTimerRef.current);
        }
        sceneBroadcastTimerRef.current = window.setTimeout(() => {
          try {
            broadcast({
              type: "scene",
              elements: snap.elements,
              fp,
            } as unknown as never);
          } catch {
            /* broadcast can fail if room not yet connected — fine, next change retries */
          }
        }, SCENE_BROADCAST_DEBOUNCE_MS);
      }

      // Update presence with selected element ids so remote selection
      // boxes appear around what each user is focused on.
      const selectedIds = (appState as { selectedElementIds?: Record<string, true> })
        .selectedElementIds;
      try {
        updatePresence({ selectedElementIds: selectedIds ?? {} } as never);
      } catch {/* presence can briefly fail before connect */ }
    },
    [flush, isViewOnly, broadcast, updatePresence],
  );

  // ── Receive remote scene updates ───────────────────────────────
  useEventListener(({ event }) => {
    const ev = event as unknown as LiveblocksEvent;
    if (ev?.type !== "scene" || !excalidrawAPI) return;
    if (ev.fp === lastSyncedFingerprintRef.current) return; // own echo

    const local = excalidrawAPI.getSceneElementsIncludingDeleted();
    const merged = reconcile(local, ev.elements);
    const mergedFp = fingerprint(merged);
    if (mergedFp === lastSyncedFingerprintRef.current) return;
    lastSyncedFingerprintRef.current = mergedFp;
    excalidrawAPI.updateScene({ elements: merged });
  });

  // ── Pointer presence (throttled) ────────────────────────────────
  const onPointerUpdate = useCallback(
    (payload: {
      pointer: { x: number; y: number; tool?: "pointer" | "laser" };
      button: "up" | "down";
      pointersMap?: unknown;
    }) => {
      const now = Date.now();
      if (now - lastPointerSentAtRef.current < POINTER_THROTTLE_MS) return;
      lastPointerSentAtRef.current = now;
      try {
        updatePresence({
          pointer: payload.pointer,
          button: payload.button,
        } as never);
      } catch {/* not connected yet */}
    },
    [updatePresence],
  );

  // ── Project remote presence into Excalidraw collaborators map ─
  useEffect(() => {
    if (!excalidrawAPI) return;
    const collaborators = new Map<string, RemoteCollaborator>();
    for (const o of others) {
      const presence = (o as { presence: Record<string, unknown> }).presence;
      const info = (o as { info: Record<string, unknown> }).info;
      const colour = (info?.color as string) ?? "#6366f1";
      const username = (info?.name as string) ?? "Anonymous";
      collaborators.set(String((o as { connectionId: number }).connectionId), {
        username,
        color: { background: colour, stroke: colour },
        avatarUrl: (info?.avatar as string | undefined) ?? null,
        pointer: (presence?.pointer as RemoteCollaborator["pointer"]) ?? null,
        button: (presence?.button as RemoteCollaborator["button"]) ?? "up",
        selectedElementIds:
          (presence?.selectedElementIds as RemoteCollaborator["selectedElementIds"]) ?? {},
        userState: "active",
      });
    }
    excalidrawAPI.updateScene({ collaborators });
  }, [others, excalidrawAPI]);

  // ── Initial-data shape for Excalidraw ──────────────────────────
  const initialData = useMemo(() => {
    if (!initial) {
      return {
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      } as const;
    }
    return {
      elements: initial.elements,
      appState: initial.appState,
      files: initial.files,
    };
  }, [initial]);

  if (initial === undefined) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Push our up-to-date display name + avatar into presence so other
  // participants see the latest values without waiting for a reconnect.
  // Done once per profile change, not on every render.
  return (
    <div
      className="excalidraw-host h-full w-full"
      data-toolbar-position={toolbarPosition}
      style={{ position: "absolute", inset: 0 }}
    >
      <ProfilePresenceSync />
      <Excalidraw
        initialData={initialData as any}
        onChange={handleChange as any}
        onPointerUpdate={onPointerUpdate as any}
        excalidrawAPI={(api: unknown) => {
          setExcalidrawAPI(api as ExcalidrawAPI);
        }}
        viewModeEnabled={isViewOnly}
        UIOptions={{
          canvasActions: {
            saveToActiveFile: false,
            loadScene: false,
            export: { saveFileToDisk: true },
            ...(isViewOnly ? { saveAsImage: true } : {}),
          },
        }}
      />
      {/* Live participants pill (top-left). Subtle so it doesn't fight
          Excalidraw's own UI; shows the avatar/initials + name of every
          other connected user. */}
      <RemoteParticipantsBadge profile={profile} />
      {isViewOnly ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/60 bg-background/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
          <Eye className="h-3 w-3" />
          View only
        </div>
      ) : null}
      <style jsx global>{`
        /* ────────────────────────────────────────────────────────────────
           Excalidraw shape-toolbar repositioning.
           Excalidraw's main shape toolbar lives inside .App-toolbar wrapped
           in .App-toolbar-content. By default it's docked top-center. We
           override its outer container (.layer-ui__wrapper__top-right's
           sibling = .App-menu_top center column) to move the toolbar to a
           different edge.

           We deliberately scope these to .excalidraw-host[data-toolbar-position=…]
           so they can't leak across the page if multiple Excalidraw
           instances ever coexist.
           ──────────────────────────────────────────────────────────────── */

        /* BOTTOM */
        .excalidraw-host[data-toolbar-position="bottom"] .App-toolbar {
          position: fixed;
          left: 50%;
          bottom: 16px;
          top: auto;
          transform: translateX(-50%);
          z-index: 5;
        }
        /* Hide the default top-center slot when we've moved it. */
        .excalidraw-host[data-toolbar-position="bottom"] .App-menu_top
          > .Stack.Stack_horizontal:has(.App-toolbar) {
          visibility: hidden;
        }

        /* LEFT — vertical orientation. */
        .excalidraw-host[data-toolbar-position="left"] .App-toolbar,
        .excalidraw-host[data-toolbar-position="right"] .App-toolbar {
          position: fixed;
          top: 50%;
          transform: translateY(-50%);
          flex-direction: column;
          z-index: 5;
        }
        .excalidraw-host[data-toolbar-position="left"] .App-toolbar {
          left: 16px;
          right: auto;
        }
        .excalidraw-host[data-toolbar-position="right"] .App-toolbar {
          right: 16px;
          left: auto;
        }
        .excalidraw-host[data-toolbar-position="left"] .App-toolbar .App-toolbar-content,
        .excalidraw-host[data-toolbar-position="right"] .App-toolbar .App-toolbar-content {
          flex-direction: column;
        }
        .excalidraw-host[data-toolbar-position="left"] .App-menu_top
          > .Stack.Stack_horizontal:has(.App-toolbar),
        .excalidraw-host[data-toolbar-position="right"] .App-menu_top
          > .Stack.Stack_horizontal:has(.App-toolbar) {
          visibility: hidden;
        }
      `}</style>
    </div>
  );
}

/**
 * Pushes the local display name + avatar URL into Liveblocks presence
 * whenever the cached profile changes, so OTHER clients see the new
 * values without waiting for our auth token to be re-issued.
 */
function ProfilePresenceSync() {
  const { profile } = useUserProfile();
  const updatePresence = useUpdateMyPresence();
  useEffect(() => {
    if (!profile) return;
    try {
      updatePresence({
        // These are presence fields readers can pick up from `o.presence`.
        // We DON'T overwrite info.* — that's set server-side at auth time.
        // But supplementing presence with the latest name/avatar lets the
        // collaborators map below stay in sync mid-session.
        displayName: profile.name,
        avatarUrl: profile.avatar_url,
      } as never);
    } catch {/* not yet connected */}
  }, [profile?.name, profile?.avatar_url, updatePresence]);
  return null;
}

/**
 * Small floating pill in the top-left listing other participants by
 * avatar/initials. Hidden when alone in the room.
 */
function RemoteParticipantsBadge({
  profile,
}: {
  profile: { name: string; avatar_url: string | null } | null;
}) {
  const others = useOthers();
  if (others.length === 0) return null;

  const list = others.slice(0, 5).map((o) => {
    const info = (o as { info: Record<string, unknown> }).info;
    const presence = (o as { presence: Record<string, unknown> }).presence;
    const name =
      (presence?.displayName as string | undefined) ??
      (info?.name as string | undefined) ??
      "Anon";
    const avatar =
      (presence?.avatarUrl as string | null | undefined) ??
      (info?.avatar as string | null | undefined) ??
      null;
    const colour = (info?.color as string | undefined) ?? "#6366f1";
    return {
      id: String((o as { connectionId: number }).connectionId),
      name,
      avatar,
      colour,
    };
  });

  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-border/60 bg-background/90 py-1 pl-1 pr-2.5 text-[11px] font-medium text-foreground shadow-sm backdrop-blur">
      <div className="flex -space-x-1.5">
        {list.map((p) => (
          <div
            key={p.id}
            title={p.name}
            className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-background text-[9px] font-semibold text-white shadow-sm"
            style={{ backgroundColor: p.colour }}
          >
            {p.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.avatar}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span aria-hidden>{quickInitials(p.name)}</span>
            )}
          </div>
        ))}
      </div>
      <span className="text-muted-foreground">
        {others.length === 1 ? `${list[0].name}` : `${others.length} editing`}
      </span>
      {profile ? (
        <span className="hidden text-[10px] text-muted-foreground/70 sm:inline">
          · you {profile.name ? `(${profile.name})` : ""}
        </span>
      ) : null}
    </div>
  );
}

function quickInitials(name: string): string {
  const t = (name || "").trim();
  if (!t) return "?";
  const parts = t.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
