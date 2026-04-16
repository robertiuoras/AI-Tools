"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tldraw, getSnapshot, loadSnapshot } from "tldraw";
import type { Editor, TLEditorSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { Loader2 } from "lucide-react";

interface Props {
  token: string;
  boardId: string;
}

/** ~45s autosave interval */
const AUTOSAVE_INTERVAL_MS = 45_000;

function snapshotForPersist(editor: Editor) {
  const snap = getSnapshot(editor.store) as TLEditorSnapshot;
  const session = snap.session ?? { version: 1 as const };
  return {
    ...snap,
    session: { ...session, isFocusMode: false },
  };
}

async function postSave(token: string, boardId: string, snapshot: TLEditorSnapshot) {
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

export default function WhiteboardInner({ token, boardId }: Props) {
  const tokenRef = useRef(token);
  const boardIdRef = useRef(boardId);
  tokenRef.current = token;
  boardIdRef.current = boardId;

  // The fetched snapshot: undefined = still loading, null = empty board, object = saved state
  const fetchedSnapshotRef = useRef<TLEditorSnapshot | null | undefined>(undefined);
  const editorRef = useRef<Editor | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);

  // Fetch the saved snapshot once on mount
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/whiteboard?boardId=${encodeURIComponent(boardId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { snapshot: TLEditorSnapshot } | null) => {
        if (cancelled) return;
        const snap = data?.snapshot ?? null;
        fetchedSnapshotRef.current = snap;
        // If editor already mounted, apply now
        if (editorRef.current && snap) {
          try {
            loadSnapshot(editorRef.current.store, snap);
            editorRef.current.updateInstanceState({ isFocusMode: false });
          } catch (e) {
            console.warn("[whiteboard] Failed to apply snapshot:", e);
          }
        }
        setOverlayVisible(false);
      })
      .catch(() => {
        if (!cancelled) {
          fetchedSnapshotRef.current = null;
          setOverlayVisible(false);
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMount = useCallback((editor: Editor) => {
    let disposed = false;
    editorRef.current = editor;
    editor.updateInstanceState({ isFocusMode: false });

    // If snapshot already fetched, apply it immediately
    const snap = fetchedSnapshotRef.current;
    if (snap !== undefined && snap !== null) {
      try {
        loadSnapshot(editor.store, snap);
        editor.updateInstanceState({ isFocusMode: false });
      } catch (e) {
        console.warn("[whiteboard] Failed to apply snapshot on mount:", e);
      }
    }

    // Interval autosave
    const interval = window.setInterval(() => {
      if (disposed) return;
      void (async () => {
        try {
          await postSave(tokenRef.current, boardIdRef.current, snapshotForPersist(editor));
        } catch (e) {
          console.warn("[whiteboard] Save error:", e);
        }
      })();
    }, AUTOSAVE_INTERVAL_MS);

    return () => {
      disposed = true;
      editorRef.current = null;
      clearInterval(interval);
      void (async () => {
        try {
          await postSave(tokenRef.current, boardIdRef.current, snapshotForPersist(editor));
        } catch {
          /* ignore on unmount */
        }
      })();
    };
  }, []); // stable — uses refs only

  return (
    <div className="h-full min-h-[400px] w-full" style={{ position: "absolute", inset: 0 }}>
      {overlayVisible && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-background"
          style={{ zIndex: 10 }}
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      <Tldraw
        inferDarkMode
        onMount={handleMount}
      />
    </div>
  );
}
