"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import * as Y from "yjs";
import { LiveblocksYjsProvider } from "@liveblocks/yjs";
import { useRoom, useOthers, useSelf } from "@liveblocks/react";
import { useAuthSession } from "@/components/AuthSessionProvider";

/**
 * Real-time collaborative editor for shared notes.
 *
 * Uses Tiptap (ProseMirror) bound to a Y.Doc that's synced through
 * Liveblocks. All connected clients see each other's edits + cursors
 * with sub-second latency, and presence avatars show who's currently in
 * the doc.
 *
 * Persistence model:
 *   - Liveblocks holds the live Yjs state (their backend).
 *   - This component also debounce-saves the rendered HTML back to
 *     Supabase on local edits (~1.5s after the user stops typing) so the
 *     non-collab read paths (initial page load, sharing previews,
 *     version snapshots) keep working.
 *   - The first user to enter an empty room seeds the Y.Doc from the
 *     existing note HTML; subsequent users receive that state via Yjs
 *     sync (no double-seed).
 */

const SAVE_DEBOUNCE_MS = 1500;

interface CollaborativeNoteEditorProps {
  noteId: string;
  /** Initial HTML loaded from the note row. Used to seed an empty Y.Doc. */
  initialHtml: string;
  /** Whether the current user can edit (false = view-only share). */
  canEdit: boolean;
  /** Called after a successful save so the parent can refresh side panels. */
  onSaved?: (html: string) => void;
  /** Optional placeholder text shown when the doc is empty. */
  placeholder?: string;
  /** Optional class name forwarded to the root scroll container. */
  className?: string;
}

export function CollaborativeNoteEditor(props: CollaborativeNoteEditorProps) {
  const { noteId, initialHtml, canEdit, onSaved, placeholder, className } = props;
  const room = useRoom();
  const self = useSelf();
  const { accessToken } = useAuthSession();

  const ydocRef = useRef<Y.Doc | null>(null);
  if (ydocRef.current === null) ydocRef.current = new Y.Doc();
  const ydoc = ydocRef.current;

  const providerRef = useRef<LiveblocksYjsProvider | null>(null);
  const [isProviderReady, setIsProviderReady] = useState(false);

  // Initialise the Liveblocks Yjs provider exactly once per room mount.
  useEffect(() => {
    const provider = new LiveblocksYjsProvider(room as any, ydoc);
    providerRef.current = provider;
    setIsProviderReady(true);

    return () => {
      provider.destroy();
      providerRef.current = null;
    };
    // Room and ydoc are stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const userColour = (self?.info as any)?.color ?? "#6366f1";
  const userName =
    (self?.info as any)?.name ?? (self?.info as any)?.email ?? "Anonymous";

  const editor = useEditor(
    {
      editable: canEdit,
      immediatelyRender: false,
      extensions: providerRef.current
        ? [
            StarterKit.configure({ history: false }),
            Link.configure({ openOnClick: false }),
            Placeholder.configure({
              placeholder: placeholder ?? "Start typing… others will see your edits live.",
            }),
            Collaboration.configure({ document: ydoc }),
            CollaborationCursor.configure({
              provider: providerRef.current,
              user: { name: userName, color: userColour },
            }),
          ]
        : [
            StarterKit.configure({ history: false }),
            Link.configure({ openOnClick: false }),
            Placeholder.configure({
              placeholder: placeholder ?? "Connecting to live session…",
            }),
            Collaboration.configure({ document: ydoc }),
          ],
      editorProps: {
        attributes: {
          class:
            "prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-none min-h-[300px] px-1 py-2",
        },
      },
    },
    // Re-create the editor once the provider is ready (so CollaborationCursor is wired up)
    // and whenever editability changes (view-only ↔ edit).
    [isProviderReady, canEdit, userColour, userName],
  );

  // Seed empty Y.Doc with initial HTML on first sync. Other clients arriving
  // later will receive this state through Yjs and skip the seed.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!editor || !providerRef.current) return;
    const provider = providerRef.current;
    const trySeed = () => {
      if (seededRef.current) return;
      seededRef.current = true;
      // ProseMirror counts an "empty" doc as one with a single empty paragraph
      // (size 2). Anything larger means another client already populated it.
      const isEmpty = editor.state.doc.content.size <= 2;
      if (isEmpty && initialHtml && initialHtml.trim().length > 0) {
        editor.commands.setContent(initialHtml, false);
      }
    };
    if ((provider as any).synced) {
      trySeed();
    } else {
      const onSync = () => trySeed();
      (provider as any).on?.("sync", onSync);
      return () => (provider as any).off?.("sync", onSync);
    }
  }, [editor, initialHtml]);

  // Debounced save back to Supabase on LOCAL edits only.
  const saveTimer = useRef<number | null>(null);
  const saveAbort = useRef<AbortController | null>(null);
  const lastSavedHtmlRef = useRef<string>(initialHtml);

  const flushSave = useCallback(async () => {
    if (!editor || !canEdit) return;
    const html = editor.getHTML();
    if (html === lastSavedHtmlRef.current) return;
    lastSavedHtmlRef.current = html;

    saveAbort.current?.abort();
    const ctrl = new AbortController();
    saveAbort.current = ctrl;

    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PUT",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ content: html }),
      });
      if (res.ok) onSaved?.(html);
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        console.error("[collab] save failed", err);
      }
    }
  }, [accessToken, canEdit, editor, noteId, onSaved]);

  useEffect(() => {
    if (!editor) return;
    const handler = ({ transaction }: any) => {
      // y-prosemirror tags remote-applied transactions with this meta key.
      // Only schedule a save when the change originated locally.
      const isRemote = transaction.getMeta("y-sync$") !== undefined;
      if (isRemote) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, flushSave]);

  // Best-effort flush on unmount + tab close.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void flushSave();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        void flushSave();
      }
    };
  }, [flushSave]);

  return (
    <div className={className}>
      <PresenceBar />
      <div className="rounded-md border border-border/40 bg-background/60 px-3 py-2">
        <EditorContent editor={editor} />
      </div>
      {!canEdit ? (
        <div className="mt-2 text-xs text-muted-foreground">
          You have view-only access. Ask the owner to grant edit permission to
          make changes.
        </div>
      ) : null}
    </div>
  );
}

/**
 * Strip of avatar bubbles for everyone currently in the room. Each bubble
 * shows the user's initials and their assigned cursor colour, so you can
 * see at a glance who's editing and match them to the cursors in the doc.
 */
function PresenceBar() {
  const others = useOthers();
  const self = useSelf();

  const all = useMemo(() => {
    const list: Array<{ id: string; name: string; color: string; isSelf: boolean }> = [];
    if (self) {
      list.push({
        id: String((self as any).connectionId ?? "self"),
        name: (self.info as any)?.name ?? "You",
        color: (self.info as any)?.color ?? "#6366f1",
        isSelf: true,
      });
    }
    for (const o of others) {
      list.push({
        id: String(o.connectionId),
        name: (o.info as any)?.name ?? "Anonymous",
        color: (o.info as any)?.color ?? "#94a3b8",
        isSelf: false,
      });
    }
    return list;
  }, [others, self]);

  if (all.length === 0) return null;

  return (
    <div className="mb-2 flex items-center gap-2">
      <div className="flex -space-x-2">
        {all.slice(0, 6).map((p) => (
          <div
            key={p.id}
            title={p.isSelf ? `${p.name} (you)` : p.name}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold text-white shadow-sm"
            style={{ backgroundColor: p.color }}
          >
            {initials(p.name)}
          </div>
        ))}
        {all.length > 6 ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[11px] font-semibold text-foreground">
            +{all.length - 6}
          </div>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">
        {all.length === 1 ? "Just you" : `${all.length} editing`}
      </span>
    </div>
  );
}

function initials(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
