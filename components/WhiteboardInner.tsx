"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Loader2 } from "lucide-react";

export type ToolbarPosition = "top" | "bottom" | "left" | "right";

interface Props {
  token: string;
  boardId: string;
  /** Where the Excalidraw shape toolbar sits. Defaults to "top". */
  toolbarPosition?: ToolbarPosition;
}

const AUTOSAVE_INTERVAL_MS = 30_000;
const AUTOSAVE_DEBOUNCE_MS = 1_500;

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

/**
 * Strip ephemeral state from `appState` before persisting. Excalidraw includes
 * collaborators (a Map), drag/selection state, viewport offsets, etc. that
 * either don't serialize cleanly or cause weirdness when restored on a
 * different viewport size. We keep only the user-meaningful settings.
 */
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

async function postSave(token: string, boardId: string, snapshot: PersistedSnapshot) {
  const res = await fetch("/api/whiteboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "save", boardId, snapshot }),
  });
  if (!res.ok) console.warn("[whiteboard] Save failed:", res.status);
}

export default function WhiteboardInner({
  token,
  boardId,
  toolbarPosition = "top",
}: Props) {
  const tokenRef = useRef(token);
  const boardIdRef = useRef(boardId);
  tokenRef.current = token;
  boardIdRef.current = boardId;

  const [initial, setInitial] = useState<PersistedSnapshot | null | undefined>(undefined);
  const latestRef = useRef<PersistedSnapshot | null>(null);
  const debounceRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  // Load saved snapshot for this board.
  useEffect(() => {
    let cancelled = false;
    setInitial(undefined);
    fetch(`/api/whiteboard?boardId=${encodeURIComponent(boardId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { snapshot: unknown } | null) => {
        if (cancelled) return;
        const raw = data?.snapshot as PersistedSnapshot | null | undefined;
        if (raw && Array.isArray(raw.elements)) {
          setInitial(raw);
        } else {
          setInitial(null);
        }
      })
      .catch(() => {
        if (!cancelled) setInitial(null);
      });
    return () => { cancelled = true; };
  }, [token, boardId]);

  const flush = useCallback(async () => {
    if (!latestRef.current || !dirtyRef.current) return;
    dirtyRef.current = false;
    const snap = latestRef.current;
    try {
      await postSave(tokenRef.current, boardIdRef.current, snap);
    } catch (e) {
      console.warn("[whiteboard] Save error:", e);
    }
  }, []);

  // Periodic autosave + flush on unmount/board switch.
  useEffect(() => {
    const interval = window.setInterval(() => { void flush(); }, AUTOSAVE_INTERVAL_MS);
    const onBeforeUnload = () => {
      if (latestRef.current && dirtyRef.current) {
        // Best-effort sync save with sendBeacon (no auth header — ignored if unauthorized).
        try {
          const blob = new Blob(
            [JSON.stringify({ action: "save", boardId: boardIdRef.current, snapshot: latestRef.current })],
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
  }, [flush, boardId]);

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
      // Cheap dirty check: compare element + file count + last id rather than
      // deep-equal. Excalidraw fires onChange on every pointer move, so this
      // matters for performance.
      const prev = latestRef.current;
      const changed =
        !prev ||
        prev.elements.length !== snap.elements.length ||
        Object.keys(prev.files).length !== Object.keys(snap.files).length ||
        JSON.stringify(prev.elements.map((e) => e.id + (e.version ?? "") + (e.versionNonce ?? ""))) !==
          JSON.stringify(snap.elements.map((e) => e.id + (e.version ?? "") + (e.versionNonce ?? "")));
      latestRef.current = snap;
      if (!changed) return;
      dirtyRef.current = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => { void flush(); }, AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

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

  return (
    <div
      className="excalidraw-host h-full w-full"
      data-toolbar-position={toolbarPosition}
      style={{ position: "absolute", inset: 0 }}
    >
      {/* Excalidraw renders its own toolbar/menus inside this container.
          We size it absolutely so it fills the panel; no parent overflow:hidden
          should be applied at the panel level (would clip the popovers).

          The data-toolbar-position attribute drives the CSS overrides below
          which reposition the main shape toolbar (.App-toolbar) so users
          can put it on any edge of the canvas — Miro-style preference. */}
      <Excalidraw
        initialData={initialData as any}
        onChange={handleChange as any}
        UIOptions={{
          canvasActions: {
            saveToActiveFile: false,
            loadScene: false,
            export: { saveFileToDisk: true },
          },
        }}
      />
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
