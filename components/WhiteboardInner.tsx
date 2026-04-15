"use client";

import { useCallback, useRef, useState } from "react";
import { Tldraw, getSnapshot, loadSnapshot } from "tldraw";
import type { Editor } from "tldraw";
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
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const unsubRef = useRef<(() => void) | null>(null);

  /**
   * Called once by tldraw when the editor is ready.
   * 1. Load saved snapshot for this board
   * 2. Only AFTER loading completes, attach the store listener for auto-save
   * This prevents loadSnapshot from triggering the "saving" state.
   */
  const handleMount = useCallback(
    (editor: Editor) => {
      // Clean up any previous listener (shouldn't happen, but just in case)
      unsubRef.current?.();

      const attachListener = () => {
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
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ action: "save", boardId, snapshot }),
                });
                setSaveStatus(res.ok ? "saved" : "error");
              } catch {
                setSaveStatus("error");
              }
            }, 2000);
          },
          { scope: "document" },
        );
        unsubRef.current = unsub;
      };

      // Load the board snapshot, then attach the listener
      fetch(`/api/whiteboard?boardId=${encodeURIComponent(boardId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { snapshot: unknown } | null) => {
          if (data?.snapshot) {
            try {
              loadSnapshot(editor.store, data.snapshot as Parameters<typeof loadSnapshot>[1]);
            } catch {
              // Ignore snapshot migration errors — start with empty board
            }
          }
        })
        .catch(() => {/* Network error — start with empty board */})
        .finally(() => {
          // Listener attaches here, AFTER loadSnapshot has fully run.
          // Any store events from loadSnapshot have already fired and are gone.
          attachListener();
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // Intentionally empty — token/boardId don't change while mounted (key forces remount)
  );

  return (
    // position:absolute + inset:0 fills the relative parent in WhiteboardPanel exactly
    <div style={{ position: "absolute", inset: 0 }}>
      <Tldraw inferDarkMode onMount={handleMount} />

      {/* Save indicator */}
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
