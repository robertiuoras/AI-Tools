"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tldraw, getSnapshot } from "tldraw";
import type { Editor, TLEditorSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Props {
  token: string;
  boardId: string;
}

export default function WhiteboardInner({ token, boardId }: Props) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  /**
   * undefined  = still fetching initial snapshot
   * null       = fetch done, no saved snapshot (blank canvas)
   * object     = fetch done, use as initial snapshot
   *
   * Tldraw only renders once this is no longer undefined.
   * This eliminates the race condition where loadSnapshot was called
   * asynchronously after the editor was already mounted.
   */
  const [initialSnapshot, setInitialSnapshot] = useState<
    TLEditorSnapshot | null | undefined
  >(undefined);

  const timerRef   = useRef<ReturnType<typeof setTimeout>>();
  // Use refs so the onMount closure always sees the latest values,
  // even after a token refresh — without re-running onMount.
  const tokenRef   = useRef(token);
  const boardIdRef = useRef(boardId);
  tokenRef.current   = token;
  boardIdRef.current = boardId;

  // Fetch snapshot ONCE per mount (boardId is stable per mount via key={boardId}).
  // We intentionally omit token from deps — token is always valid at mount time
  // (the parent notes page only renders when token is non-null), and we don't
  // want a token refresh to remount tldraw and lose unsaved work.
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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — boardId/token stable per mount lifecycle

  /**
   * Called once by tldraw when the editor is ready.
   * At this point the editor already has the initial snapshot loaded
   * (passed via the `snapshot` prop), so we only need to set up auto-save.
   * Returns a cleanup function that tldraw calls on unmount.
   */
  const handleMount = useCallback((editor: Editor) => {
    const unsub = editor.store.listen(
      () => {
        clearTimeout(timerRef.current);
        setSaveStatus("saving");
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
            setSaveStatus(res.ok ? "saved" : "error");
          } catch {
            setSaveStatus("error");
          }
        }, 2000);
      },
      { scope: "document" },
    );

    // Return cleanup — tldraw calls this when the editor unmounts
    return () => {
      unsub();
      clearTimeout(timerRef.current);
    };
  }, []); // stable — reads token/boardId via refs

  // Show a spinner while the initial snapshot is being fetched
  if (initialSnapshot === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ position: "absolute", inset: 0 }}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    // tldraw fills 100% of its parent; position:absolute+inset:0 fills
    // the relative flex-1 canvas wrapper in WhiteboardPanel exactly.
    <div style={{ position: "absolute", inset: 0 }}>
      <Tldraw
        inferDarkMode
        onMount={handleMount}
        // Pass snapshot as a prop so tldraw initialises with it immediately —
        // no need to call loadSnapshot() asynchronously after mount.
        snapshot={initialSnapshot ?? undefined}
      />

      {/* Save status indicator */}
      {saveStatus !== "idle" && (
        <div
          className={cn(
            "pointer-events-none absolute bottom-3 right-14 z-[400] flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm transition-all",
            saveStatus === "saving" && "bg-card/90 text-muted-foreground ring-1 ring-border/40 backdrop-blur-sm",
            saveStatus === "saved"  && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            saveStatus === "error"  && "bg-destructive/10 text-destructive",
          )}
        >
          {saveStatus === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
          {saveStatus === "saved"  && <Check  className="h-3 w-3" />}
          {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "Save failed"}
        </div>
      )}
    </div>
  );
}
