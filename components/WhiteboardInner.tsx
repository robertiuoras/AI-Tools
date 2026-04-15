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
 * Isolated from parent state so autosave / toasts never re-render the editor.
 * Re-rendering `<Tldraw>` after mount can collapse or reset the UI (toolbar disappears).
 */
const TldrawEditor = memo(function TldrawEditor({
  snapshot,
  onMount,
}: {
  snapshot: TLEditorSnapshot | undefined;
  onMount: (editor: Editor) => void | (() => void);
}) {
  return (
    <Tldraw inferDarkMode snapshot={snapshot} onMount={onMount} />
  );
});

export default function WhiteboardInner({ token, boardId }: Props) {
  /**
   * undefined  = still fetching initial snapshot
   * null       = fetch done, no saved snapshot (blank canvas)
   * object     = fetch done, use as initial snapshot
   */
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
        if (!cancelled) setInitialSnapshot(data?.snapshot ?? null);
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
    const unsub = editor.store.listen(
      () => {
        clearTimeout(timerRef.current);
        // No setState here — runs on every stroke. Persist in background only.
        timerRef.current = setTimeout(async () => {
          try {
            const snapshot = getSnapshot(editor.store);
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
        className="flex h-full w-full items-center justify-center"
        style={{ position: "absolute", inset: 0 }}
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <TldrawEditor
        snapshot={initialSnapshot ?? undefined}
        onMount={handleMount}
      />
    </div>
  );
}
