"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, RotateCcw, X, Eye, Loader2 } from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";

/**
 * Slide-in drawer showing every saved version of a note (newest first)
 * with one-click revert. Snapshots are deduped to ~1/min server-side, so
 * the list stays browsable even after long editing sessions.
 *
 * Revert permission mirrors the policy decided up-front:
 *   - The owner can always revert.
 *   - Users with edit-level share access can also revert.
 *   - View-only recipients see history but no revert button.
 */

interface VersionRow {
  id: string;
  title: string;
  createdAt: string;
  author: { name: string; email: string | null };
}

interface VersionHistoryProps {
  noteId: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful revert with the updated note row. */
  onReverted?: (note: any) => void;
}

export function NoteVersionHistory({
  noteId,
  open,
  onClose,
  onReverted,
}: VersionHistoryProps) {
  const { accessToken } = useAuthSession();
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [canRevert, setCanRevert] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");

  const headers = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (accessToken) h.Authorization = `Bearer ${accessToken}`;
    return h;
  }, [accessToken]);

  const refresh = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/versions`, { headers });
      if (!res.ok) {
        setVersions([]);
        setCanRevert(false);
        return;
      }
      const data = await res.json();
      setVersions(data.versions ?? []);
      setCanRevert(Boolean(data.canRevert));
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [headers, noteId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const previewVersion = useCallback(
    async (versionId: string) => {
      setPreviewing(versionId);
      setPreviewHtml("");
      try {
        const res = await fetch(`/api/notes/${noteId}/versions/${versionId}`, {
          headers,
        });
        if (res.ok) {
          const data = await res.json();
          setPreviewHtml(data.content ?? "");
        }
      } catch {
        // ignore
      }
    },
    [headers, noteId],
  );

  const revertTo = useCallback(
    async (versionId: string) => {
      const proceed = window.confirm(
        "Revert the note to this version? The current state will be saved as a new version first, so this action is undoable.",
      );
      if (!proceed) return;
      setReverting(versionId);
      try {
        const res = await fetch(`/api/notes/${noteId}/versions/${versionId}`, {
          method: "POST",
          headers,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          alert(`Revert failed: ${text || res.statusText}`);
          return;
        }
        const data = await res.json();
        onReverted?.(data.note);
        await refresh();
        setPreviewing(null);
        setPreviewHtml("");
      } finally {
        setReverting(null);
      }
    },
    [headers, noteId, onReverted, refresh],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Version history</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close history"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : versions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No saved versions yet. Versions are recorded automatically as you
              edit, deduplicated to one snapshot per minute.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {versions.map((v, idx) => {
                const isCurrent = idx === 0;
                const isOpen = previewing === v.id;
                return (
                  <li key={v.id} className={isOpen ? "bg-muted/40" : ""}>
                    <div className="flex items-start gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {v.title || "Untitled Note"}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {formatRelative(v.createdAt)} · {v.author.name}
                          {isCurrent ? (
                            <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                              Latest
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => void previewVersion(v.id)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Preview"
                          aria-label="Preview version"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {canRevert && !isCurrent ? (
                          <button
                            onClick={() => void revertTo(v.id)}
                            disabled={reverting === v.id}
                            className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                            title="Revert to this version"
                          >
                            {reverting === v.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            Revert
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {isOpen ? (
                      <div className="px-4 pb-4">
                        <div className="rounded border border-border bg-background p-3 text-xs">
                          <div
                            className="prose prose-sm dark:prose-invert max-w-none"
                            dangerouslySetInnerHTML={{ __html: previewHtml || "<em>Loading…</em>" }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          {canRevert
            ? "You can revert to any earlier version. Reverts are themselves saved as a new version, so they're undoable."
            : "View-only access — ask the owner for edit permission to revert."}
        </div>
      </aside>
    </div>
  );
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleString();
}
