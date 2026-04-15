"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Pencil, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BoardMeta {
  id: string;
  name: string;
  updatedAt: string;
}

const WhiteboardCanvas = dynamic(() => import("./WhiteboardInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading whiteboard…</p>
      </div>
    </div>
  ),
});

interface Props {
  token: string;
}

export function WhiteboardPanel({ token }: Props) {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const fetchBoards = useCallback(async () => {
    try {
      const res = await fetch("/api/whiteboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { boards: BoardMeta[] };
        const list = data.boards ?? [];
        setBoards(list);
        if (list.length > 0 && !activeBoardId) {
          setActiveBoardId(list[0].id);
        }
      }
    } catch {/* */}
    finally { setLoading(false); }
  }, [token, activeBoardId]);

  useEffect(() => { void fetchBoards(); }, [fetchBoards]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const createBoard = useCallback(async () => {
    const res = await fetch("/api/whiteboard", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "create", name: "Untitled Board" }),
    });
    if (res.ok) {
      const data = (await res.json()) as { board: BoardMeta };
      setBoards((prev) => [...prev, data.board]);
      setActiveBoardId(data.board.id);
    }
  }, [token]);

  const startRename = useCallback((board: BoardMeta) => {
    setRenamingId(board.id);
    setRenameVal(board.name);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingId || !renameVal.trim()) { setRenamingId(null); return; }
    const name = renameVal.trim();
    setBoards((prev) => prev.map((b) => (b.id === renamingId ? { ...b, name } : b)));
    setRenamingId(null);
    await fetch("/api/whiteboard", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "rename", boardId: renamingId, name }),
    });
  }, [renamingId, renameVal, token]);

  const deleteBoard = useCallback(async (boardId: string) => {
    if (boards.length <= 1) return; // keep at least one
    const next = boards.filter((b) => b.id !== boardId);
    setBoards(next);
    if (activeBoardId === boardId) setActiveBoardId(next[0]?.id ?? null);
    await fetch("/api/whiteboard", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "delete", boardId }),
    });
  }, [boards, activeBoardId, token]);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 220px)", minHeight: 520 }}>
      {/* Board tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2 py-1.5 shrink-0">
        {loading ? (
          <div className="flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading boards…
          </div>
        ) : (
          boards.map((board) => (
            <div
              key={board.id}
              className={cn(
                "group flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-sm transition-all",
                activeBoardId === board.id
                  ? "border-primary/40 bg-background text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground cursor-pointer",
              )}
              onClick={() => activeBoardId !== board.id && setActiveBoardId(board.id)}
            >
              {renamingId === board.id ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={renameInputRef}
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="w-32 rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary/50"
                  />
                  <button type="button" onClick={() => void commitRename()} className="text-emerald-500 hover:text-emerald-600">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => setRenamingId(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="max-w-[140px] truncate">{board.name}</span>
                  {activeBoardId === board.id && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        title="Rename"
                        onClick={(e) => { e.stopPropagation(); startRename(board); }}
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      {boards.length > 1 && (
                        <button
                          type="button"
                          title="Delete board"
                          onClick={(e) => { e.stopPropagation(); void deleteBoard(board.id); }}
                          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}

        <button
          type="button"
          title="New board"
          onClick={() => void createBoard()}
          className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Canvas — use key to force remount when switching boards */}
      <div className="relative flex-1 overflow-hidden rounded-b-xl border-x border-b border-border">
        {activeBoardId ? (
          <WhiteboardCanvas key={activeBoardId} token={token} boardId={activeBoardId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
      </div>
    </div>
  );
}
