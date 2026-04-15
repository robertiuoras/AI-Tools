"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Tldraw, getSnapshot } from "tldraw";
import type { Editor, TLEditorSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { Loader2 } from "lucide-react";

interface Props {
  token: string;
  boardId: string;
}

/**
 * Persisted snapshots can include `session.isFocusMode: true` (tldraw “focus mode”),
 * which hides the toolbar and chrome — the canvas looks like a blank void with no way
 * to exit. Always load and save with focus mode off for this embedded editor.
 */
function normalizeWhiteboardSnapshot(
  s: TLEditorSnapshot | null,
): TLEditorSnapshot | undefined {
  if (!s) return undefined;
  const session = s.session ?? { version: 1 as const };
  return {
    document: s.document,
    session: {
      ...session,
      isFocusMode: false,
    },
  };
}

function snapshotForPersist(editor: Editor) {
  const snap = getSnapshot(editor.store) as TLEditorSnapshot;
  const session = snap.session ?? { version: 1 as const };
  return {
    ...snap,
    session: {
      ...session,
      isFocusMode: false,
    },
  };
}

/**
 * Isolated from parent state so autosave never re-renders the editor subtree.
 */
const TldrawEditor = memo(function TldrawEditor({
  snapshot,
  onMount,
}: {
  snapshot: TLEditorSnapshot | undefined;
  onMount: (editor: Editor) => void | (() => void);
}) {
  return (
    <Tldraw
      inferDarkMode
      hideUi={false}
      snapshot={snapshot}
      onMount={onMount}
    />
  );
});

export default function WhiteboardInner({ token, boardId }: Props) {
  const [initialSnapshot, setInitialSnapshot] = useState<
    TLEditorSnapshot | null | undefined
  >(undefined);

  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const tokenRef = useRef(token);
  const boardIdRef = useRef(boardId);
  tokenRef.current = token;
  boardIdRef.current = boardId;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/whiteboard?boardId=${encodeURIComponent(boardId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { snapshot: TLEditorSnapshot } | null) => {
        if (cancelled) return;
        const raw = data?.snapshot ?? null;
        setInitialSnapshot(raw);
      })
      .catch(() => {
        if (!cancelled) setInitialSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMount = useCallback((editor: Editor) => {
    // Belt-and-suspenders: ensure UI is visible even if snapshot missed a field.
    editor.updateInstanceState({ isFocusMode: false });
    requestAnimationFrame(() => {
      editor.updateInstanceState({ isFocusMode: false });
    });

    const unsub = editor.store.listen(
      () => {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
          try {
            const snapshot = snapshotForPersist(editor);
            const res = await fetch("/api/whiteboard", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenRef.current}`,
              },
              body: JSON.stringify({
                action: "save",
                boardId: boardIdRef.current,
                snapshot,
              }),
            });
            if (!res.ok) {
              console.warn("[whiteboard] Save failed:", res.status);
            }
          } catch (e) {
            console.warn("[whiteboard] Save error:", e);
          }
        }, 2000);
      },
      { scope: "document", source: "user" },
    );

    return () => {
      unsub();
      clearTimeout(timerRef.current);
    };
  }, []);

  if (initialSnapshot === undefined) {
    return (
      <div
        className="flex h-full min-h-[400px] w-full items-center justify-center"
        style={{ position: "absolute", inset: 0 }}
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const snapshotForEditor = normalizeWhiteboardSnapshot(initialSnapshot);

  return (
    <div
      className="h-full min-h-[400px] w-full"
      style={{ position: "absolute", inset: 0 }}
    >
      <TldrawEditor snapshot={snapshotForEditor} onMount={handleMount} />
    </div>
  );
}
