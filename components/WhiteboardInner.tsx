"use client";

import { useEffect, useRef, useState } from "react";
import { Tldraw, useEditor, getSnapshot, loadSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Placed inside <Tldraw> to access the editor via useEditor().
 * Loads the board snapshot once, then auto-saves on changes (2 s debounce).
 */
function BoardSync({
  token,
  boardId,
  onStatusChange,
}: {
  token: string;
  boardId: string;
  onStatusChange: (s: SaveStatus) => void;
}) {
  const editor = useEditor();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const loadedRef = useRef(false);

  useEffect(() => {
    // Load saved snapshot for this board
    (async () => {
      try {
        const res = await fetch(`/api/whiteboard?boardId=${encodeURIComponent(boardId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { snapshot: unknown };
          if (data.snapshot) {
            loadSnapshot(editor.store, data.snapshot as Parameters<typeof loadSnapshot>[1]);
          }
        }
      } catch {/* */}
      finally {
        loadedRef.current = true;
      }
    })();

    // Auto-save on changes with 2 s debounce
    const unsub = editor.store.listen(
      () => {
        if (!loadedRef.current) return;
        clearTimeout(timerRef.current);
        onStatusChange("saving");
        timerRef.current = setTimeout(async () => {
          try {
            const snapshot = getSnapshot(editor.store);
            const res = await fetch("/api/whiteboard", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ action: "save", boardId, snapshot }),
            });
            onStatusChange(res.ok ? "saved" : "error");
          } catch {
            onStatusChange("error");
          }
        }, 2000);
      },
      { scope: "document" },
    );

    return () => {
      unsub();
      clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — editor/token/boardId don't change after mount

  return null;
}

interface Props {
  token: string;
  boardId: string;
}

export default function WhiteboardInner({ token, boardId }: Props) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  return (
    // tldraw needs position:relative + explicit dimensions on its direct parent
    <div style={{ position: "absolute", inset: 0 }}>
      <Tldraw inferDarkMode>
        <BoardSync token={token} boardId={boardId} onStatusChange={setSaveStatus} />
      </Tldraw>

      {/* Save indicator — matches the Notes-style "Saving… / Saved" badge */}
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
