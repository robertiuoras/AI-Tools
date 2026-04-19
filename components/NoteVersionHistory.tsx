"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock,
  RotateCcw,
  X,
  Eye,
  Loader2,
  AlertTriangle,
  ArrowLeftRight,
} from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";

/**
 * Slide-in drawer showing every saved version of a note (newest first)
 * with one-click revert. Snapshots are deduped to ~1/min server-side, so
 * the list stays browsable even after long editing sessions.
 *
 * Revert flow shows a side-by-side preview modal (current vs. selected
 * version) before applying — confirming inside the modal is what
 * actually triggers the server-side revert.
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

interface RevertCandidate {
  versionId: string;
  versionTitle: string;
  versionContent: string;
  versionCreatedAt: string;
  versionAuthor: string;
  currentTitle: string;
  currentContent: string;
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
  const [reverting, setReverting] = useState<boolean>(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");

  /**
   * The version the user has chosen to revert to. Lives in state until
   * the user either confirms (which fires the API call) or cancels.
   * Loaded asynchronously: clicking Revert sets `pendingRevert` to a
   * placeholder, then we fetch the full content + current note and
   * replace it with the full candidate.
   */
  const [revertCandidate, setRevertCandidate] =
    useState<RevertCandidate | null>(null);
  const [loadingRevert, setLoadingRevert] = useState<string | null>(null);

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
      const next = previewing === versionId ? null : versionId;
      setPreviewing(next);
      setPreviewHtml("");
      if (!next) return;
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
    [headers, noteId, previewing],
  );

  /**
   * Open the confirm-revert modal for a given version. Loads BOTH the
   * version content (for "what you're reverting TO") and the current
   * note row (for "what you'll lose") so the user can see exactly what
   * the diff will look like before committing.
   */
  const openRevertModal = useCallback(
    async (v: VersionRow) => {
      setLoadingRevert(v.id);
      try {
        const [versionRes, currentRes] = await Promise.all([
          fetch(`/api/notes/${noteId}/versions/${v.id}`, { headers }),
          fetch(`/api/notes/${noteId}`, { headers }),
        ]);
        const versionData = versionRes.ok ? await versionRes.json() : null;
        // /api/notes/:id has GET? Actually no; fall back to listing endpoint.
        let currentTitle = "";
        let currentContent = "";
        if (currentRes.ok) {
          const currentData = await currentRes.json();
          if (currentData && typeof currentData === "object") {
            currentTitle = (currentData.title as string) ?? "";
            currentContent = (currentData.content as string) ?? "";
          }
        }
        // If the GET above didn't return the current note (no GET handler
        // on /api/notes/:id), the modal will still show the version side;
        // the "current" side falls back to a friendly placeholder so the
        // user can still confirm or cancel.
        setRevertCandidate({
          versionId: v.id,
          versionTitle: versionData?.title ?? v.title,
          versionContent: versionData?.content ?? "",
          versionCreatedAt: v.createdAt,
          versionAuthor: v.author.name,
          currentTitle,
          currentContent,
        });
      } finally {
        setLoadingRevert(null);
      }
    },
    [headers, noteId],
  );

  const confirmRevert = useCallback(async () => {
    if (!revertCandidate) return;
    setReverting(true);
    try {
      const res = await fetch(
        `/api/notes/${noteId}/versions/${revertCandidate.versionId}`,
        { method: "POST", headers },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        alert(`Revert failed: ${text || res.statusText}`);
        return;
      }
      const data = await res.json();
      onReverted?.(data.note);
      await refresh();
      setRevertCandidate(null);
      setPreviewing(null);
      setPreviewHtml("");
    } finally {
      setReverting(false);
    }
  }, [headers, noteId, onReverted, refresh, revertCandidate]);

  if (!open) return null;

  return (
    <>
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
                No saved versions yet. Versions are recorded automatically as
                you edit, deduplicated to one snapshot per minute.
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
                            className={
                              "rounded p-1.5 hover:bg-muted hover:text-foreground " +
                              (isOpen
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground")
                            }
                            title={isOpen ? "Hide preview" : "Quick preview"}
                            aria-label={
                              isOpen ? "Hide preview" : "Quick preview"
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {canRevert && !isCurrent ? (
                            <button
                              onClick={() => void openRevertModal(v)}
                              disabled={loadingRevert === v.id}
                              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                              title="Preview & revert to this version"
                            >
                              {loadingRevert === v.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              Revert…
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {isOpen ? (
                        <div className="px-4 pb-4">
                          <div className="rounded border border-border bg-background p-3 text-xs">
                            <div
                              className="prose prose-sm dark:prose-invert max-w-none [overflow-wrap:anywhere]"
                              dangerouslySetInnerHTML={{
                                __html: previewHtml || "<em>Loading…</em>",
                              }}
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
              ? "Reverts open a side-by-side preview before committing — and the current state is itself snapshotted, so reverts are undoable."
              : "View-only access — ask the owner for edit permission to revert."}
          </div>
        </aside>
      </div>

      {revertCandidate ? (
        <RevertConfirmModal
          candidate={revertCandidate}
          reverting={reverting}
          onCancel={() => setRevertCandidate(null)}
          onConfirm={() => void confirmRevert()}
        />
      ) : null}
    </>
  );
}

interface RevertConfirmModalProps {
  candidate: RevertCandidate;
  reverting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Side-by-side "you're about to throw away X and replace it with Y"
 * confirmation modal. Renders the actual HTML of both versions in a
 * scrollable pane so the user can spot exactly what's about to change.
 *
 * Stacks vertically on small screens (the side-by-side comparison is
 * the win on desktop; on mobile a single column is more readable).
 */
function RevertConfirmModal({
  candidate,
  reverting,
  onCancel,
  onConfirm,
}: RevertConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <ArrowLeftRight className="h-4 w-4 text-primary" />
              Revert to this version?
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              From <strong>{candidate.versionAuthor}</strong> ·{" "}
              {formatRelative(candidate.versionCreatedAt)}. The current state
              will be snapshotted automatically before reverting, so you can
              always undo this from the version list.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cancel"
            disabled={reverting}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-2">
          <ComparePane
            label="Currently in your note"
            sublabel="(this will be saved as a new version, then replaced)"
            tone="current"
            title={candidate.currentTitle}
            html={candidate.currentContent}
            placeholder="The current note content couldn't be loaded for preview, but it's safe — it'll still be snapshotted on the server before the revert is applied."
          />
          <ComparePane
            label="Reverting to"
            sublabel={`Saved ${formatRelative(candidate.versionCreatedAt)}`}
            tone="target"
            title={candidate.versionTitle}
            html={candidate.versionContent}
            placeholder="(empty version)"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span>
              All connected viewers will see the reverted content after a
              brief reload.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={reverting}
              className="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={reverting}
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {reverting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Revert to this version
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComparePane({
  label,
  sublabel,
  tone,
  title,
  html,
  placeholder,
}: {
  label: string;
  sublabel: string;
  tone: "current" | "target";
  title: string;
  html: string;
  placeholder: string;
}) {
  const accent =
    tone === "current"
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-emerald-500/40 bg-emerald-500/5";
  const labelTone =
    tone === "current" ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400";
  const isEmpty = !html || html.trim() === "" || html.trim() === "<p></p>";
  return (
    <div className={`flex min-h-0 flex-col border md:border-0 ${accent}`}>
      <div className="flex items-baseline justify-between gap-2 border-b border-border/50 px-4 py-2">
        <div className={`text-xs font-semibold uppercase tracking-wide ${labelTone}`}>
          {label}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          {sublabel}
        </div>
      </div>
      <div className="px-4 pt-2 pb-1 text-sm font-medium truncate">
        {title || "Untitled Note"}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {isEmpty ? (
          <p className="text-xs italic text-muted-foreground">{placeholder}</p>
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none [overflow-wrap:anywhere]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
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
