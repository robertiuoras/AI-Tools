"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tldraw, getSnapshot } from "tldraw";
import type { Editor, TLEditorSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { Loader2 } from "lucide-react";

interface Props {
  token: string;
  boardId: string;
}

/** ~45s — avoids tying saves to the old 2s debounce and keeps work off the interaction path */
const AUTOSAVE_INTERVAL_MS = 45_000;

/**
 * Persisted snapshots can include `session.isFocusMode: true`, which hides chrome.
 * Always load and save with focus mode off.
 */
function normalizeWhiteboardSnapshot(
  s: TLEditorSnapshot | null | undefined,
): TLEditorSnapshot | undefined {
  if (s == null) return undefined;
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

async function postSave(
  token: string,
  boardId: string,
  snapshot: TLEditorSnapshot,
) {
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
    }),
  });
  if (!res.ok) console.warn("[whiteboard] Save failed:", res.status);
}

/**
 * CRITICAL: `snapshot` must be referentially stable whenever `initialSnapshot` is unchanged.
 * Building a new object every parent re-render made `memo` useless and forced Tldraw to
 * re-apply the snapshot on every Notes page re-render (~2s when bootstrap/auth settles).
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

  const snapshotForEditor = useMemo(
    () => normalizeWhiteboardSnapshot(initialSnapshot),
    [initialSnapshot],
  );

  const handleMount = useCallback((editor: Editor) => {
    editor.updateInstanceState({ isFocusMode: false });
    requestAnimationFrame(() => {
      editor.updateInstanceState({ isFocusMode: false });
    });

    // Interval autosave only — no store.listen (avoids coupling saves to edit events).
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          await postSave(
            tokenRef.current,
            boardIdRef.current,
            snapshotForPersist(editor),
          );
        } catch (e) {
          console.warn("[whiteboard] Save error:", e);
        }
      })();
    }, AUTOSAVE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      void (async () => {
        try {
          await postSave(
            tokenRef.current,
            boardIdRef.current,
            snapshotForPersist(editor),
          );
        } catch {
          /* ignore on unmount */
        }
      })();
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

  return (
    <div
      className="h-full min-h-[400px] w-full"
      style={{ position: "absolute", inset: 0 }}
    >
      <TldrawEditor snapshot={snapshotForEditor} onMount={handleMount} />
    </div>
  );
}
