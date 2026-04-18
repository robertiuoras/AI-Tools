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

const AUTOSAVE_INTERVAL_MS = 45_000;

/**
 * Walks `document.store` and forces `isReadonly: false` on any tldraw
 * `instance`-typed record. tldraw's schema marks `isReadonly` as a
 * "preserved" instance field, which means snapshots round-trip the value
 * across loads. If a snapshot was ever saved with `isReadonly: true` (e.g.
 * because tldraw briefly toggled it during a load race), every subsequent
 * mount would re-hydrate the canvas as read-only — that's the "uneditable
 * after a few seconds" bug. We strip it on the way in AND on the way out.
 */
function stripReadonlyFromStore(store: Record<string, unknown> | undefined): void {
  if (!store) return;
  for (const key of Object.keys(store)) {
    const rec = store[key] as { typeName?: string; isReadonly?: boolean } | null;
    if (rec && typeof rec === "object" && rec.typeName === "instance" && rec.isReadonly) {
      (rec as { isReadonly: boolean }).isReadonly = false;
    }
  }
}

function snapshotForPersist(editor: Editor): TLEditorSnapshot {
  const snap = getSnapshot(editor.store) as TLEditorSnapshot & {
    document?: { store?: Record<string, unknown> };
  };
  const session = snap.session ?? { version: 1 as const };
  const docStore = snap.document?.store ? { ...snap.document.store } : undefined;
  stripReadonlyFromStore(docStore);
  const document = snap.document
    ? { ...snap.document, ...(docStore ? { store: docStore } : {}) }
    : snap.document;
  return {
    ...snap,
    session: { ...session, isFocusMode: false },
    ...(document ? { document } : {}),
  } as TLEditorSnapshot;
}

function prepareForLoad(snap: TLEditorSnapshot): TLEditorSnapshot {
  const s = snap as TLEditorSnapshot & { document?: { store?: Record<string, unknown> } };
  const session = s.session ?? { version: 1 as const };
  const docStore = s.document?.store ? { ...s.document.store } : undefined;
  stripReadonlyFromStore(docStore);
  const document = s.document
    ? { ...s.document, ...(docStore ? { store: docStore } : {}) }
    : s.document;
  return {
    ...s,
    session: { ...session, isFocusMode: false },
    ...(document ? { document } : {}),
  } as TLEditorSnapshot;
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

  const [initialSnapshot, setInitialSnapshot] = useState<TLEditorSnapshot | null | undefined>(undefined);

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
  }, []);

  const handleMount = useCallback((editor: Editor) => {
    let disposed = false;
    editorRef.current = editor;

    editor.updateInstanceState({ isFocusMode: false, isReadonly: false });

    /**
     * BEFORE-change interceptor: any attempt to flip `isReadonly` to `true`
     * on the instance record is rewritten to `false`. Unlike the after-change
     * approach, this runs *before* the write commits, so we can't lose to
     * subsequent reactive writes (e.g. the snapshot hydration race or any
     * collaboration-mode reactor). This is the durable fix.
     */
    const offBefore = editor.sideEffects.registerBeforeChangeHandler(
      "instance",
      (_prev, next) => {
        const inst = next as { isReadonly?: boolean };
        if (inst.isReadonly === true) {
          return { ...inst, isReadonly: false } as typeof next;
        }
        return next;
      },
    );

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
      try {
        offBefore?.();
      } catch {
        /* ignore */
      }
      clearInterval(interval);
      void (async () => {
        try {
          await postSave(tokenRef.current, boardIdRef.current, snapshotForPersist(editor));
        } catch {
          /* ignore on unmount */
        }
      })();
    };
  }, []);

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
