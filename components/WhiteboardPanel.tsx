"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Settings as SettingsIcon,
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelBottom,
  Share2,
  Users,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import { WhiteboardRoomMount } from "@/components/WhiteboardRoomMount";
import { WhiteboardShareDialog } from "@/components/WhiteboardShareDialog";
import { markBoardDeleted } from "@/lib/whiteboard-deleted-ids";

/** Where the Excalidraw shape toolbar sits relative to the canvas. */
export type ToolbarPosition = "top" | "bottom" | "left" | "right";

const TOOLBAR_POSITION_STORAGE_KEY = "whiteboard:toolbarPosition";
const FULLSCREEN_STORAGE_KEY = "whiteboard:fullscreen";

function readToolbarPositionFromStorage(): ToolbarPosition {
  if (typeof window === "undefined") return "top";
  const v = window.localStorage.getItem(TOOLBAR_POSITION_STORAGE_KEY);
  return v === "bottom" || v === "left" || v === "right" ? v : "top";
}

interface BoardMeta {
  id: string;
  name: string;
  updatedAt: string;
}

interface SharedBoardMeta {
  shareId: string;
  boardId: string;
  ownerId: string;
  boardName: string;
  permission: "view" | "edit";
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
  } | null;
}

/**
 * Discriminated state for which board the canvas is currently showing.
 * Using a tagged union (instead of two parallel ids) makes it impossible
 * to forget the ownerId/permission when rendering a shared board.
 */
type ActiveBoard =
  | { kind: "own"; boardId: string }
  | {
      kind: "shared";
      boardId: string;
      ownerId: string;
      permission: "view" | "edit";
      ownerName: string;
    };

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
  const [sharedBoards, setSharedBoards] = useState<SharedBoardMeta[]>([]);
  const [active, setActive] = useState<ActiveBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Two-step delete: clicking trash sets this; modal confirms.
  const [confirmDelete, setConfirmDelete] = useState<BoardMeta | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Share dialog: tracks which OWNED board is being shared.
  const [shareDialogBoard, setShareDialogBoard] = useState<BoardMeta | null>(
    null,
  );
  const { addToast } = useToast();

  // ── Layout preferences (persisted) ──────────────────────────────────
  // Fullscreen makes the whole panel cover the viewport (Miro-style).
  // Toolbar position lets users put Excalidraw's shape toolbar where
  // they prefer (top/bottom/left/right). Both persist in localStorage.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition>("top");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Hydrate prefs after mount (avoid SSR mismatch).
  useEffect(() => {
    setToolbarPosition(readToolbarPositionFromStorage());
    if (typeof window !== "undefined") {
      setIsFullscreen(
        window.localStorage.getItem(FULLSCREEN_STORAGE_KEY) === "1",
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TOOLBAR_POSITION_STORAGE_KEY, toolbarPosition);
  }, [toolbarPosition]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FULLSCREEN_STORAGE_KEY, isFullscreen ? "1" : "0");
    // Lock body scroll while in fullscreen so the canvas can use 100dvh
    // without the page scrolling underneath it.
    if (isFullscreen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isFullscreen]);

  // Esc exits fullscreen (and closes the settings popover).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (settingsOpen) {
        setSettingsOpen(false);
      } else if (isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen, settingsOpen]);

  // Click-away for the settings popover.
  useEffect(() => {
    if (!settingsOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!settingsRef.current) return;
      if (!settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [settingsOpen]);

  // Fetch own + shared boards once on mount, plus a refresh helper that
  // can be called from the share dialog and notification listeners.
  // token is guaranteed non-null here — the notes page only renders
  // WhiteboardPanel when token is truthy. We use [] deps so a token
  // refresh (TOKEN_REFRESHED from Supabase) doesn't re-run this effect.
  const refreshSharedBoards = useCallback(async () => {
    try {
      const res = await fetch("/api/whiteboard/shared", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { boards: SharedBoardMeta[] };
      setSharedBoards(data.boards ?? []);
    } catch {
      /* non-fatal */
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ownRes, sharedRes] = await Promise.all([
          fetch("/api/whiteboard", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch("/api/whiteboard/shared", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
        ]);
        if (cancelled) return;

        let ownList: BoardMeta[] = [];
        let sharedList: SharedBoardMeta[] = [];
        if (ownRes.ok) {
          const data = (await ownRes.json()) as { boards: BoardMeta[] };
          ownList = data.boards ?? [];
          setBoards(ownList);
        }
        if (sharedRes.ok) {
          const data = (await sharedRes.json()) as { boards: SharedBoardMeta[] };
          sharedList = data.boards ?? [];
          setSharedBoards(sharedList);
        }

        // Pick a sensible default active board: first own board, falling
        // back to the first shared one if the user owns nothing yet.
        if (ownList.length > 0) {
          setActive({ kind: "own", boardId: ownList[0].id });
        } else if (sharedList.length > 0) {
          const sb = sharedList[0];
          setActive({
            kind: "shared",
            boardId: sb.boardId,
            ownerId: sb.ownerId,
            permission: sb.permission,
            ownerName:
              sb.owner?.name?.trim() ||
              sb.owner?.email?.split("@")[0] ||
              "Owner",
          });
        }
      } catch {/* */}
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — token is stable at mount time

  // Auto-refresh shared boards list when a notification arrives so a
  // newly-shared board appears without the user manually reloading.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onNew = (e: Event) => {
      const detail = (e as CustomEvent<{ types?: string[] }>).detail;
      const types = detail?.types ?? [];
      const relevant = types.some((t) =>
        t === "whiteboard_shared" ||
        t === "whiteboard_unshared" ||
        t === "whiteboard_share_permission_changed",
      );
      if (relevant || types.length === 0) {
        void refreshSharedBoards();
      }
    };
    window.addEventListener("ai-tools:new-notifications", onNew);
    return () => {
      window.removeEventListener("ai-tools:new-notifications", onNew);
    };
  }, [refreshSharedBoards]);

  // Deep-link: when the current URL contains ?board=...&owner=... select
  // the corresponding shared board automatically (used by share emails).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!sharedBoards.length) return;
    const params = new URLSearchParams(window.location.search);
    const boardId = params.get("board");
    const ownerId = params.get("owner");
    if (!boardId || !ownerId) return;
    const match = sharedBoards.find(
      (b) => b.boardId === boardId && b.ownerId === ownerId,
    );
    if (match) {
      setActive({
        kind: "shared",
        boardId: match.boardId,
        ownerId: match.ownerId,
        permission: match.permission,
        ownerName:
          match.owner?.name?.trim() ||
          match.owner?.email?.split("@")[0] ||
          "Owner",
      });
    }
  }, [sharedBoards]);

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
      setActive({ kind: "own", boardId: data.board.id });
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

  /**
   * Delete is server-authoritative: we wait for the API to respond, then
   * sync local state from the returned list. This avoids two classic bugs:
   *   1. Optimistic delete + silent API failure → board "comes back" on
   *      next reload because we never noticed the failure.
   *   2. Race with the active board's autosave on unmount → server
   *      could resurrect the board if we trusted local state alone.
   */
  const deleteBoard = useCallback(
    async (boardId: string) => {
      if (deletingId) return;
      setDeletingId(boardId);

      // Tell WhiteboardInner to short-circuit any trailing autosave for
      // this board. Done BEFORE the optimistic state change so the
      // upcoming unmount-flush can't race the DELETE call on the
      // server and resurrect the board entry. (See
      // lib/whiteboard-deleted-ids.ts for the rationale.)
      markBoardDeleted(boardId);

      // Optimistic local removal so the user sees the board disappear
      // immediately. We sync with the server's authoritative list once
      // it responds, but never RE-INSERT a board (the server no longer
      // resurrects "default" entries, so this is always safe now).
      const wasActiveOwn =
        active?.kind === "own" && active.boardId === boardId;
      const optimistic = boards.filter((b) => b.id !== boardId);
      setBoards(optimistic);
      if (wasActiveOwn) {
        // Move active off the deleted board immediately. Prefer the next
        // own board, then the first shared one, else nothing.
        const nextOwn = optimistic[0];
        if (nextOwn) {
          setActive({ kind: "own", boardId: nextOwn.id });
        } else if (sharedBoards[0]) {
          const sb = sharedBoards[0];
          setActive({
            kind: "shared",
            boardId: sb.boardId,
            ownerId: sb.ownerId,
            permission: sb.permission,
            ownerName:
              sb.owner?.name?.trim() ||
              sb.owner?.email?.split("@")[0] ||
              "Owner",
          });
        } else {
          setActive(null);
        }
      }

      try {
        const res = await fetch("/api/whiteboard", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "delete", boardId }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Server returned ${res.status}`);
        }
        const data = (await res.json()) as { ok: true; boards?: BoardMeta[] };
        // Sync with the server's list so other clients/tabs converge.
        let next: BoardMeta[] | null = Array.isArray(data.boards) ? data.boards : null;
        if (!next) {
          const r = await fetch("/api/whiteboard", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          if (r.ok) {
            const d = (await r.json()) as { boards: BoardMeta[] };
            next = d.boards ?? [];
          }
        }
        if (next) {
          setBoards(next);
          // If our active board got removed externally too, pick a fallback.
          const activeOwnId =
            active?.kind === "own" ? active.boardId : null;
          if (activeOwnId && !next.some((b) => b.id === activeOwnId)) {
            const nextFirst = next[0]?.id;
            setActive(nextFirst ? { kind: "own", boardId: nextFirst } : null);
          }
        }
        addToast({
          title: "Board deleted",
          variant: "success",
          duration: 2500,
        });
      } catch (err) {
        addToast({
          title: "Couldn't delete board",
          description:
            err instanceof Error
              ? err.message
              : "Please try again in a moment.",
          variant: "error",
          duration: 6000,
        });
      } finally {
        setDeletingId(null);
        setConfirmDelete(null);
      }
    },
    [token, active, boards, sharedBoards, deletingId, addToast],
  );

  return (
    <div
      className={cn(
        "flex flex-col",
        isFullscreen
          ? "fixed inset-0 z-[120] bg-background p-2 sm:p-3"
          : "",
      )}
      style={
        isFullscreen
          ? { height: "100dvh", minHeight: "100dvh" }
          : { height: "calc(100vh - 220px)", minHeight: 520 }
      }
    >
      {/* Board tabs + layout controls */}
      <div className="flex items-center gap-1 overflow-x-auto border border-border rounded-t-xl bg-muted/30 px-2 py-1.5 shrink-0">
        {loading ? (
          <div className="flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading boards…
          </div>
        ) : (
          boards.map((board) => (
            <div
              key={board.id}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-sm transition-all",
                active?.kind === "own" && active.boardId === board.id
                  ? "border-primary/40 bg-background text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground cursor-pointer",
              )}
              onClick={() => {
                if (active?.kind === "own" && active.boardId === board.id) return;
                setActive({ kind: "own", boardId: board.id });
              }}
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
                  <span className="max-w-[120px] truncate">{board.name}</span>
                  {/* Always visible — no need to select a tab first to delete/rename */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="Share board"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShareDialogBoard(board);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    >
                      <Share2 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Rename board"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActive({ kind: "own", boardId: board.id });
                        startRename(board);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {/* Always allow deletion. Hiding the button when only
                        one board remained was confusing — users couldn't
                        remove a phantom "Untitled" board left over from
                        the old auto-seed bug. They get an empty state if
                        they delete the last one and can create a new one
                        from there. */}
                    <button
                        type="button"
                        title="Delete board"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(board);
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                  </div>
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

        {/* ── Shared with me ─────────────────────────────────────── */}
        {sharedBoards.length > 0 ? (
          <>
            <div
              className="mx-2 h-5 w-px shrink-0 bg-border/70"
              aria-hidden
            />
            <div className="flex shrink-0 items-center gap-1 pr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Users className="h-3 w-3" /> Shared
            </div>
            {sharedBoards.map((sb) => {
              const isActive =
                active?.kind === "shared" &&
                active.boardId === sb.boardId &&
                active.ownerId === sb.ownerId;
              const ownerLabel =
                sb.owner?.name?.trim() ||
                sb.owner?.email?.split("@")[0] ||
                "Owner";
              return (
                <div
                  key={sb.shareId}
                  title={`From ${ownerLabel} · ${sb.permission === "edit" ? "Can edit" : "View only"}`}
                  onClick={() => {
                    if (isActive) return;
                    setActive({
                      kind: "shared",
                      boardId: sb.boardId,
                      ownerId: sb.ownerId,
                      permission: sb.permission,
                      ownerName: ownerLabel,
                    });
                  }}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition-all cursor-pointer",
                    isActive
                      ? "border-primary/40 bg-background text-foreground shadow-sm"
                      : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  )}
                >
                  {sb.permission === "view" ? (
                    <Eye className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <Users className="h-3 w-3 text-primary" />
                  )}
                  <span className="max-w-[140px] truncate">{sb.boardName}</span>
                  <span className="text-[10px] text-muted-foreground/80">
                    · {ownerLabel}
                  </span>
                </div>
              );
            })}
          </>
        ) : null}

        {/* Right-aligned layout controls: settings popover + fullscreen toggle. */}
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              title="Whiteboard settings"
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((s) => !s)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground",
                settingsOpen &&
                  "bg-background/80 text-foreground ring-1 ring-primary/30",
              )}
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </button>
            {settingsOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-[130] mt-1.5 w-60 overflow-hidden rounded-xl border border-border/70 bg-popover/95 shadow-2xl ring-1 ring-black/5 backdrop-blur"
              >
                <div className="border-b border-border/60 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Toolbar position
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                    Where Excalidraw&apos;s shape toolbar sits.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1 p-2">
                  {(
                    [
                      { value: "top", label: "Top", icon: <PanelTop className="h-3.5 w-3.5" /> },
                      { value: "bottom", label: "Bottom", icon: <PanelBottom className="h-3.5 w-3.5" /> },
                      { value: "left", label: "Left", icon: <PanelLeft className="h-3.5 w-3.5" /> },
                      { value: "right", label: "Right", icon: <PanelRight className="h-3.5 w-3.5" /> },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setToolbarPosition(opt.value)}
                      className={cn(
                        "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                        toolbarPosition === opt.value
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/60 text-foreground/80 hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                  Tip: press{" "}
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">
                    Esc
                  </kbd>{" "}
                  to exit fullscreen.
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            aria-pressed={isFullscreen}
            onClick={() => setIsFullscreen((v) => !v)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground",
              isFullscreen && "bg-background/80 text-foreground ring-1 ring-primary/30",
            )}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/*
        Canvas wrapper — NO overflow-hidden here.
        overflow-hidden clips tldraw's floating menus/toolbar popups
        which makes the UI appear blank when interacting.
        Use relative+flex-1 so the absolutely-positioned canvas fills the space.
      */}
      <div
        className={cn(
          "relative flex-1 border-x border-b border-border",
          isFullscreen ? "rounded-b-xl" : "rounded-b-xl",
        )}
        style={{ minHeight: 0 }}
      >
        {active ? (
          // Mount a Liveblocks room scoped to this board so any number of
          // participants can join in real time. The room is keyed by
          // boardId so switching boards remounts the provider with a
          // fresh room (avoids leaking presence/state across boards).
          <WhiteboardRoomMount
            key={`${active.boardId}:${active.kind === "shared" ? active.ownerId : "self"}`}
            boardId={active.boardId}
            ownerId={active.kind === "shared" ? active.ownerId : null}
          >
            <WhiteboardCanvas
              token={token}
              boardId={active.boardId}
              toolbarPosition={toolbarPosition}
              ownerId={active.kind === "shared" ? active.ownerId : null}
              permission={
                active.kind === "shared" ? active.permission : "edit"
              }
            />
          </WhiteboardRoomMount>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          // Truly empty state — no own boards, no shared boards.
          // Replaces the old "always seed a default" workaround that
          // caused the persistent "Untitled Board" bug.
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Plus className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                No whiteboards yet
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Create your first board to start sketching, brainstorming
                and collaborating in real time.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void createBoard()}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              New whiteboard
            </button>
          </div>
        )}
      </div>

      {confirmDelete ? (
        <DeleteBoardConfirm
          board={confirmDelete}
          deleting={deletingId === confirmDelete.id}
          onCancel={() => {
            if (deletingId) return;
            setConfirmDelete(null);
          }}
          onConfirm={() => void deleteBoard(confirmDelete.id)}
        />
      ) : null}

      {shareDialogBoard ? (
        <WhiteboardShareDialog
          open
          onClose={() => setShareDialogBoard(null)}
          boardId={shareDialogBoard.id}
          boardName={shareDialogBoard.name}
        />
      ) : null}
    </div>
  );
}

/**
 * Two-step delete confirmation modal. Esc / backdrop click cancels (when
 * not actively deleting); the confirm button shows a spinner while the
 * API call is in flight so the user can't double-fire it.
 */
function DeleteBoardConfirm({
  board,
  deleting,
  onCancel,
  onConfirm,
}: {
  board: BoardMeta;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) onCancel();
      if (e.key === "Enter" && !deleting) onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleting, onCancel, onConfirm]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-board-title"
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !deleting) onCancel();
      }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-popover shadow-2xl ring-1 ring-black/10">
        <div className="flex items-start gap-3 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="delete-board-title" className="text-sm font-semibold text-foreground">
              Delete this whiteboard?
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">“{board.name}”</span>{" "}
              will be permanently removed, including all of its drawings. This
              can&apos;t be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-500 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {deleting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                Delete board
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
