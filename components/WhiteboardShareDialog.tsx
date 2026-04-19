"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Mail,
  Pencil,
  Eye,
  X,
  Check,
  Trash2,
  UserPlus,
  Users,
  AlertTriangle,
} from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { userInitials, avatarColor } from "@/components/UserProfileProvider";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface ShareUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

interface ShareRow {
  id: string;
  board_id: string;
  owner_id: string;
  shared_with_id: string;
  board_name: string | null;
  permission: "view" | "edit";
  created_at: string;
  updated_at: string;
  sharedWith: ShareUser | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  boardId: string;
  boardName: string;
}

/**
 * Slide-in modal that lets the owner of a whiteboard share it with other
 * registered users by email. Mirrors the notes share dialog UX:
 *   - Add recipients with view/edit permission
 *   - List + revoke existing shares
 *   - Toast feedback on success/error
 *
 * The dialog assumes the caller is the board's owner — share APIs return
 * 403 otherwise.
 */
export function WhiteboardShareDialog({
  open,
  onClose,
  boardId,
  boardName,
}: Props) {
  const { accessToken } = useAuthSession();
  const { addToast } = useToast();

  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("edit");
  const [adding, setAdding] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/whiteboard/${encodeURIComponent(boardId)}/shares`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      if (!res.ok) {
        if (res.status !== 403) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Server returned ${res.status}`);
        }
        setShares([]);
        return;
      }
      const data = (await res.json()) as ShareRow[];
      setShares(data);
    } catch (err) {
      addToast({
        title: "Couldn't load shares",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [accessToken, boardId, addToast]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !adding && !revokingId) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, adding, revokingId]);

  if (!open) return null;

  const addShare = async () => {
    if (!accessToken) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      addToast({ title: "Enter an email", variant: "error" });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(
        `/api/whiteboard/${encodeURIComponent(boardId)}/shares`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            email: trimmed,
            permission,
            boardName,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = text || `Server returned ${res.status}`;
        try {
          msg = JSON.parse(text).error ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const row = (await res.json()) as ShareRow;
      setShares((prev) => {
        const others = prev.filter((s) => s.id !== row.id);
        return [...others, row];
      });
      setEmail("");
      addToast({
        title: "Whiteboard shared",
        description: row.sharedWith?.email ?? trimmed,
        variant: "success",
        duration: 3000,
      });
    } catch (err) {
      addToast({
        title: "Couldn't share whiteboard",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "error",
      });
    } finally {
      setAdding(false);
    }
  };

  const revoke = async (share: ShareRow) => {
    if (!accessToken) return;
    setRevokingId(share.id);
    try {
      const res = await fetch(
        `/api/whiteboard/${encodeURIComponent(boardId)}/shares/${encodeURIComponent(share.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Server returned ${res.status}`);
      }
      setShares((prev) => prev.filter((s) => s.id !== share.id));
      addToast({
        title: "Access revoked",
        description: share.sharedWith?.email ?? undefined,
        variant: "success",
        duration: 2500,
      });
    } catch (err) {
      addToast({
        title: "Couldn't revoke access",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "error",
      });
    } finally {
      setRevokingId(null);
    }
  };

  const updatePermission = async (
    share: ShareRow,
    next: "view" | "edit",
  ) => {
    if (!accessToken || share.permission === next) return;
    setRevokingId(share.id);
    try {
      // POST again with the same email + new permission upserts the row.
      const res = await fetch(
        `/api/whiteboard/${encodeURIComponent(boardId)}/shares`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            email: share.sharedWith?.email,
            permission: next,
            boardName,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Server returned ${res.status}`);
      }
      const row = (await res.json()) as ShareRow;
      setShares((prev) => prev.map((s) => (s.id === row.id ? row : s)));
    } catch (err) {
      addToast({
        title: "Couldn't update permission",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "error",
      });
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wb-share-title"
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !adding && !revokingId) onClose();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-2xl ring-1 ring-black/10">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div className="min-w-0">
            <h2
              id="wb-share-title"
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <Users className="h-4 w-4 text-primary" />
              Share whiteboard
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              “{boardName}”
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!revokingId || adding}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Add new */}
        <div className="space-y-3 border-b border-border/60 px-5 py-4">
          <div className="space-y-1.5">
            <label
              htmlFor="wb-share-email"
              className="flex items-center gap-1.5 text-xs font-medium text-foreground/90"
            >
              <Mail className="h-3.5 w-3.5" />
              Invite by email
            </label>
            <div className="flex gap-2">
              <input
                id="wb-share-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addShare();
                }}
                placeholder="someone@example.com"
                disabled={adding}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
              />
              <select
                value={permission}
                onChange={(e) =>
                  setPermission(e.target.value === "edit" ? "edit" : "view")
                }
                disabled={adding}
                className="rounded-md border border-border bg-background px-2 text-xs font-medium outline-none focus:border-primary/50"
              >
                <option value="edit">Can edit</option>
                <option value="view">View only</option>
              </select>
              <button
                type="button"
                onClick={() => void addShare()}
                disabled={adding || !email.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {adding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
                Invite
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              The recipient must already have an account on AI Tools.
              They&apos;ll get an in-app + email notification.
            </p>
          </div>
        </div>

        {/* Existing shares */}
        <div className="max-h-[40vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-5 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading shares…
            </div>
          ) : shares.length === 0 ? (
            <div className="flex items-center justify-center gap-1.5 px-5 py-8 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              No one has access yet.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {shares.map((s) => {
                const u = s.sharedWith;
                const display =
                  u?.name?.trim() ||
                  u?.email?.split("@")[0] ||
                  "Unknown user";
                const initials = userInitials(u?.name, u?.email);
                const bg = avatarColor(u?.id ?? u?.email);
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white shadow-sm"
                      style={{ backgroundColor: bg }}
                    >
                      {u?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span aria-hidden>{initials}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {display}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {u?.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="View only"
                        onClick={() => void updatePermission(s, "view")}
                        disabled={!!revokingId}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
                          s.permission === "view" &&
                            "bg-primary/10 text-primary ring-1 ring-primary/30",
                        )}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Can edit"
                        onClick={() => void updatePermission(s, "edit")}
                        disabled={!!revokingId}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
                          s.permission === "edit" &&
                            "bg-primary/10 text-primary ring-1 ring-primary/30",
                        )}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Revoke access"
                        onClick={() => void revoke(s)}
                        disabled={!!revokingId}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                      >
                        {revokingId === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-border/60 bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={!!revokingId || adding}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
