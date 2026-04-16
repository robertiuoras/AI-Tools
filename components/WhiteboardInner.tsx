"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tldraw, getSnapshot } from "tldraw";
import type { Editor, TLEditorSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { Loader2 } from "lucide-react";

interface Props {
  token: string;
  boardId: string;
}

/** ~45s autosave interval */
const AUTOSAVE_INTERVAL_MS = 45_000;

/** Strip focus/readonly from the session before saving so they're never persisted. */
function snapshotForPersist(editor: Editor) {
  const snap = getSnapshot(editor.store) as TLEditorSnapshot;
  const session = snap.session ?? { version: 1 as const };
  return {
    ...snap,
    session: { ...session, isFocusMode: false },
  };
}

/** Strip focus mode from a fetched snapshot before passing it as initial data. */
function prepareForLoad(snap: TLEditorSnapshot): TLEditorSnapshot {
  const session = snap.session ?? { version: 1 as const };
  return { ...snap, session: { ...session, isFocusMode: false } };
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

  const editorRef = useRef<Editor | null>(null);

  // undefined = still loading  |  null = new empty board  |  snapshot = saved state
  const [initialSnapshot, setInitialSnapshot] = useState<TLEditorSnapshot | null | undefined>(undefined);

  // Fetch BEFORE mounting Tldraw so we never need loadSnapshot imperatively
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/whiteboard?boardId=${encodeURIComponent(boardId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { snapshot: TLEditorSnapshot } | null) => {
        if (cancelled) return;
        const snap = data?.snapshot ?? null;
        setInitialSnapshot(snap ? prepareForLoad(snap) : null);
      })
      .catch(() => {
        if (!cancelled) setInitialSnapshot(null);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — boardId/token are stable at mount

  const handleMount = useCallback((editor: Editor) => {
    let disposed = false;
    editorRef.current = editor;

    // Always ensure the editor is interactive regardless of what the snapshot had
    editor.updateInstanceState({ isFocusMode: false, isReadonly: false });

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

  // Show loading spinner until the fetch resolves
  if (initialSnapshot === undefined) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-[400px] w-full" style={{ position: "absolute", inset: 0 }}>
      <Tldraw
        inferDarkMode
        snapshot={initialSnapshot ?? undefined}
        onMount={handleMount}
      />
    </div>
  );
}
