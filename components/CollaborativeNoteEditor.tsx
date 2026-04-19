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

  /*
   * Seed the empty Y.Doc with the existing note HTML on first sync.
   *
   * SAFETY MODEL — content is irreplaceable, so we go to extra lengths:
   *
   * 1. We wait for the Liveblocks Yjs provider to finish syncing with the
   *    server before deciding anything. Without this the doc looks "empty"
   *    for a few hundred ms even when other clients have populated it,
   *    which would cause us to seed on top of existing content.
   *
   * 2. We use a Y.Map flag (`__meta.seeded`) to deterministically pick
   *    exactly ONE seeder across all concurrent clients. The first client
   *    to claim the flag inside a Yjs transaction also writes the seed;
   *    any other client racing it sees the flag set and bails out. Yjs
   *    guarantees one of the concurrent writes wins and all clients
   *    converge on the same boolean.
   *
   * 3. After seeding we mark `hasRealContentRef` so the save guard below
   *    knows real content exists in this session.
   */
  const seededRef = useRef(false);
  /**
   * Set to true the moment we've ever observed non-empty content in the
   * editor (either via seed, remote sync, or local typing). Drives the
   * never-save-empty guard in flushSave.
   */
  const hasRealContentRef = useRef(false);
  /** Resolves to true once the provider's first sync round-trip completes. */
  const [providerSynced, setProviderSynced] = useState(false);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    if ((provider as any).synced) {
      setProviderSynced(true);
      return;
    }
    const onSync = () => setProviderSynced(true);
    (provider as any).on?.("sync", onSync);
    return () => {
      (provider as any).off?.("sync", onSync);
    };
  }, []);

  useEffect(() => {
    if (!editor || !providerSynced) return;
    if (seededRef.current) return;

    const meta = ydoc.getMap("__meta");

    // Decide who seeds inside a single Yjs transaction. The check + flag
    // are atomic from the doc's perspective; Yjs deterministically picks
    // one winner across concurrent transactions and replays the others.
    let shouldSeed = false;
    ydoc.transact(() => {
      if (meta.get("seeded") === true) return;
      const isEmpty = editor.state.doc.content.size <= 2;
      if (isEmpty && initialHtml && initialHtml.trim().length > 0) {
        meta.set("seeded", true);
        shouldSeed = true;
      } else {
        // Either there's content already (we joined a populated room) or
        // there genuinely is nothing to seed. Either way, mark seeded so
        // future re-evaluations skip this branch.
        meta.set("seeded", true);
      }
    });

    seededRef.current = true;

    if (shouldSeed) {
      // setContent runs its own ProseMirror transaction; defer one tick so
      // we're not nesting transactions.
      queueMicrotask(() => {
        if (!editor.isDestroyed) {
          editor.commands.setContent(initialHtml, false);
          hasRealContentRef.current = true;
        }
      });
    } else if (editor.state.doc.content.size > 2) {
      // Joined a populated room — we already have real content via sync.
      hasRealContentRef.current = true;
    }
  }, [editor, initialHtml, providerSynced, ydoc]);

  // Track whether we've ever observed real content. Combined with the
  // never-save-empty guard, this is the seatbelt that prevents accidental
  // wipes from save-during-startup races.
  useEffect(() => {
    if (!editor) return;
    const onAnyUpdate = () => {
      if (editor.state.doc.content.size > 2) hasRealContentRef.current = true;
    };
    editor.on("update", onAnyUpdate);
    editor.on("create", onAnyUpdate);
    return () => {
      editor.off("update", onAnyUpdate);
      editor.off("create", onAnyUpdate);
    };
  }, [editor]);

  // Debounced save back to Supabase on LOCAL edits only.
  const saveTimer = useRef<number | null>(null);
  const saveAbort = useRef<AbortController | null>(null);
  const lastSavedHtmlRef = useRef<string>(initialHtml);
  const initialHtmlRef = useRef<string>(initialHtml);
  initialHtmlRef.current = initialHtml;

  const flushSave = useCallback(async () => {
    if (!editor || !canEdit) return;
    const html = editor.getHTML();

    /*
     * NEVER-SAVE-EMPTY GUARD.
     *
     * ProseMirror serialises an empty doc to "<p></p>". If we're about
     * to save that and we have ANY reason to suspect the editor hasn't
     * actually been populated this session, we refuse the save instead
     * of overwriting whatever's in Supabase. Conditions for refusal:
     *   (a) The current HTML looks empty.
     *   (b) The note had real initial content (so empty here is suspicious).
     *   (c) We have not yet observed real content in this session
     *       (no successful seed, no remote sync, no typing).
     *   (d) The provider never finished syncing (extra paranoia for
     *       offline / network-failure scenarios — better to drop the
     *       save than risk a wipe).
     *
     * If (b) is false (the note legitimately starts empty), we allow the
     * save — clearing your own empty note remains supported.
     */
    const isEmptyHtml = html.trim() === "" || html.trim() === "<p></p>";
    const initialHadContent = (initialHtmlRef.current ?? "").trim().length > 0;
    if (
      isEmptyHtml &&
      initialHadContent &&
      (!hasRealContentRef.current || !providerSynced)
    ) {
      console.warn(
        "[collab] refusing to save empty doc on top of existing content (startup race?)",
      );
      return;
    }

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
  }, [accessToken, canEdit, editor, noteId, onSaved, providerSynced]);

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
