"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tldraw, useEditor, getSnapshot, loadSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { Check, Cloud, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SaveStatus = "saved" | "saving" | "unsaved" | "error";

function AutoSaver({ token, saveStatus, setSaveStatus }: {
  token: string;
  saveStatus: SaveStatus;
  setSaveStatus: (s: SaveStatus) => void;
}) {
  const editor = useEditor();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(false);

  useEffect(() => {
    // On mount, load the saved snapshot
    (async () => {
      try {
        const res = await fetch("/api/whiteboard", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { snapshot: unknown };
          if (data.snapshot) {
            loadSnapshot(editor.store, data.snapshot as Parameters<typeof loadSnapshot>[1]);
          }
        }
      } catch {
        /* ignore */
      } finally {
        mountedRef.current = true;
      }
    })();

    // Listen for any changes and auto-save with debounce
    const unsub = editor.store.listen(
      () => {
        if (!mountedRef.current) return;
        setSaveStatus("unsaved");
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
          setSaveStatus("saving");
          try {
            const snapshot = getSnapshot(editor.store);
            const res = await fetch("/api/whiteboard", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ snapshot }),
            });
            setSaveStatus(res.ok ? "saved" : "error");
          } catch {
            setSaveStatus("error");
          }
        }, 2000);
      },
      { scope: "document" },
    );

    return () => {
      unsub();
      clearTimeout(timerRef.current);
    };
  }, [editor, token, setSaveStatus]);

  return null;
}

interface Props {
  token: string;
}

export default function WhiteboardInner({ token }: Props) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  const handleMount = useCallback(() => {
    // Editor is available through useEditor inside children
  }, []);

  return (
    <div className="relative h-full w-full">
      <Tldraw
        onMount={handleMount}
        inferDarkMode
        className="tldraw-workspace"
      >
        <AutoSaver token={token} saveStatus={saveStatus} setSaveStatus={setSaveStatus} />
      </Tldraw>

      {/* Save status badge */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shadow transition-all",
          saveStatus === "saved" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          saveStatus === "saving" && "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
          saveStatus === "unsaved" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          saveStatus === "error" && "bg-destructive/10 text-destructive",
        )}
      >
        {saveStatus === "saved" && <><Check className="h-3 w-3" /> Saved</>}
        {saveStatus === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>}
        {saveStatus === "unsaved" && <><Cloud className="h-3 w-3" /> Unsaved</>}
        {saveStatus === "error" && <><CloudOff className="h-3 w-3" /> Save failed</>}
      </div>
    </div>
  );
}
