"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Link2,
  Link2Off,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Undo2,
  Redo2,
  Copy as CopyIcon,
  Scissors,
  ClipboardPaste,
  Type,
} from "lucide-react";
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
  // Right-click menu position. `null` when closed; `{x, y}` (viewport coords)
  // when the user has requested it inside the editor surface.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

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
            // StarterKit's history is disabled — Yjs provides multiplayer-aware
            // undo/redo via @tiptap/extension-collaboration's UndoManager.
            StarterKit.configure({ history: false }),
            Underline,
            Highlight.configure({ multicolor: false }),
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Link.configure({ openOnClick: false, autolink: true }),
            Placeholder.configure({
              placeholder: placeholder ?? "Start typing… others will see your edits live.",
            }),
            Collaboration.configure({ document: ydoc }),
            CollaborationCursor.configure({
              provider: providerRef.current,
              user: { name: userName, color: userColour },
              render: (user) => {
                const safeName = String(user.name ?? "Anonymous");
                const safeColour =
                  typeof user.color === "string" && /^#[0-9a-f]{3,8}$/i.test(user.color)
                    ? user.color
                    : "#6366f1";

                const cursor = document.createElement("span");
                cursor.classList.add("collab-caret");
                cursor.style.borderColor = safeColour;

                const label = document.createElement("span");
                label.classList.add("collab-caret-label");
                label.style.backgroundColor = safeColour;
                label.textContent = firstWord(safeName);
                label.setAttribute("data-fullname", safeName);

                cursor.appendChild(label);
                return cursor;
              },
            }),
          ]
        : [
            StarterKit.configure({ history: false }),
            Underline,
            Highlight.configure({ multicolor: false }),
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Link.configure({ openOnClick: false, autolink: true }),
            Placeholder.configure({
              placeholder: placeholder ?? "Connecting to live session…",
            }),
            Collaboration.configure({ document: ydoc }),
          ],
      editorProps: {
        attributes: {
          class:
            "prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-none min-h-[300px] px-2 py-3 collab-prose",
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
      {canEdit && editor ? <EditorToolbar editor={editor} /> : null}
      <div
        className="collab-editor-shell relative rounded-xl border border-border/50 bg-gradient-to-b from-background to-muted/10 shadow-sm focus-within:border-primary/40 focus-within:shadow-md"
        onContextMenu={(e) => {
          if (!canEdit || !editor) return;
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <EditorContent editor={editor} />
      </div>
      {!canEdit ? (
        <div className="mt-2 text-xs text-muted-foreground">
          You have view-only access. Ask the owner to grant edit permission to
          make changes.
        </div>
      ) : null}
      {ctxMenu && editor ? (
        <CollabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          editor={editor}
          onClose={() => setCtxMenu(null)}
        />
      ) : null}
      {/*
       * Editor styles. Scoped via .collab-editor-shell so they can't leak
       * into other ProseMirror instances on the page.
       *
       * Includes:
       *   - I-beam text cursor on hover over editable content.
       *   - Premium prose touches: spacing, list bullets/numbers, heading
       *     scale, link underlines that don't fight the colour.
       *   - Remote-cursor pill (carried over from the cursor restyle).
       */
      }
      <style jsx global>{`
        .collab-editor-shell .ProseMirror {
          cursor: text;
          min-height: 220px;
          line-height: 1.65;
        }
        .collab-editor-shell .ProseMirror:focus { outline: none; }
        .collab-editor-shell .collab-prose p { margin: 0 0 0.6em; }
        .collab-editor-shell .collab-prose h1 { font-size: 1.6em; line-height: 1.25; margin: 0.6em 0 0.4em; font-weight: 700; }
        .collab-editor-shell .collab-prose h2 { font-size: 1.3em; line-height: 1.3;  margin: 0.5em 0 0.35em; font-weight: 700; }
        .collab-editor-shell .collab-prose h3 { font-size: 1.1em; line-height: 1.35; margin: 0.45em 0 0.3em; font-weight: 600; }
        .collab-editor-shell .collab-prose ul { padding-left: 1.4em; list-style: disc; }
        .collab-editor-shell .collab-prose ol { padding-left: 1.4em; list-style: decimal; }
        .collab-editor-shell .collab-prose blockquote {
          border-left: 3px solid hsl(var(--primary) / 0.6);
          padding: 0.05em 0.9em;
          margin: 0.5em 0;
          color: hsl(var(--muted-foreground));
          background: hsl(var(--muted) / 0.35);
          border-radius: 0 6px 6px 0;
        }
        .collab-editor-shell .collab-prose code {
          background: hsl(var(--muted) / 0.7);
          padding: 0.12em 0.4em;
          border-radius: 4px;
          font-size: 0.92em;
        }
        .collab-editor-shell .collab-prose pre {
          background: hsl(var(--muted) / 0.7);
          padding: 0.85em 1em;
          border-radius: 8px;
          overflow-x: auto;
        }
        .collab-editor-shell .collab-prose pre code { background: transparent; padding: 0; }
        .collab-editor-shell .collab-prose a {
          color: hsl(var(--primary));
          text-decoration: underline;
          text-underline-offset: 3px;
          text-decoration-thickness: 1.5px;
        }
        .collab-editor-shell .collab-prose mark {
          background: linear-gradient(transparent 55%, rgba(250, 204, 21, 0.55) 55%);
          color: inherit;
          padding: 0 1px;
          border-radius: 1px;
        }
        .collab-editor-shell .collab-prose hr {
          border: 0;
          border-top: 1px solid hsl(var(--border));
          margin: 1.2em 0;
        }
        /* Task list checkboxes */
        .collab-editor-shell .collab-prose ul[data-type="taskList"] {
          list-style: none;
          padding-left: 0.4em;
        }
        .collab-editor-shell .collab-prose ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 0.5em;
        }
        .collab-editor-shell .collab-prose ul[data-type="taskList"] li > label {
          margin-top: 0.35em;
          flex-shrink: 0;
          user-select: none;
        }
        .collab-editor-shell .collab-prose ul[data-type="taskList"] li > div {
          flex: 1;
          min-width: 0;
        }
        .collab-editor-shell .collab-prose p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground) / 0.65);
          float: left;
          height: 0;
          pointer-events: none;
        }
        /* Remote cursor pill */
        .collab-editor-shell .collab-caret {
          position: relative;
          display: inline-block;
          margin-left: -1px;
          margin-right: -1px;
          border-left: 2px solid;
          border-right: 0;
          word-break: normal;
          pointer-events: none;
        }
        .collab-editor-shell .collab-caret-label {
          position: absolute;
          top: -1.4em;
          left: -2px;
          padding: 1px 6px;
          font-size: 10px;
          font-weight: 600;
          line-height: 1.3;
          color: #fff;
          border-radius: 9999px;
          white-space: nowrap;
          user-select: none;
          pointer-events: auto;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
          letter-spacing: 0.01em;
          opacity: 0.95;
          transform-origin: bottom left;
          transition: opacity 220ms ease-out, transform 220ms ease-out;
          animation: collab-caret-pop 220ms ease-out;
        }
        .collab-editor-shell .collab-caret-label::before {
          content: "";
          position: absolute;
          left: 4px;
          bottom: -3px;
          width: 6px;
          height: 6px;
          background: inherit;
          transform: rotate(45deg);
          border-radius: 1px;
        }
        .collab-editor-shell .collab-caret:hover .collab-caret-label,
        .collab-editor-shell .collab-caret-label:hover {
          opacity: 1;
          transform: scale(1.04);
        }
        @keyframes collab-caret-pop {
          0%   { opacity: 0; transform: translateY(2px) scale(0.85); }
          100% { opacity: 0.95; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

/** First word of a name, capped to ~14 chars so the pill stays compact. */
function firstWord(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "Anon";
  const first = trimmed.split(/\s+/)[0];
  return first.length > 14 ? first.slice(0, 13) + "…" : first;
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

/* ────────────────────────────────────────────────────────────────────── */
/*  Toolbar                                                                */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Premium floating toolbar shown above the collaborative editor.
 * Mirrors the legacy editor's most-used formatting actions and adds a
 * few collab-friendly extras (task lists, alignment). Active commands
 * pulse with the primary colour so users always know what's on.
 */
function EditorToolbar({ editor }: { editor: Editor }) {
  // Force re-render whenever the editor's selection / marks change so
  // toolbar buttons reflect the current state ("active" highlights).
  const [, force] = useState(0);
  useEffect(() => {
    const tick = () => force((n) => n + 1);
    editor.on("selectionUpdate", tick);
    editor.on("transaction", tick);
    editor.on("focus", tick);
    return () => {
      editor.off("selectionUpdate", tick);
      editor.off("transaction", tick);
      editor.off("focus", tick);
    };
  }, [editor]);

  const promptForLink = useCallback(() => {
    if (typeof window === "undefined") return;
    const previous = (editor.getAttributes("link") as { href?: string }).href ?? "";
    const url = window.prompt("Link URL (leave blank to remove)", previous);
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    let href = url.trim();
    if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) href = `https://${href}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }, [editor]);

  const headingValue: "p" | "h1" | "h2" | "h3" = editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
      ? "h2"
      : editor.isActive("heading", { level: 3 })
        ? "h3"
        : "p";

  const setHeading = (v: string) => {
    const chain = editor.chain().focus();
    if (v === "p") chain.setParagraph().run();
    else chain.toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
  };

  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-gradient-to-b from-background to-muted/40 px-1.5 py-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/70"
      role="toolbar"
      aria-label="Editor toolbar"
    >
      <ToolbarSelect
        value={headingValue}
        onChange={setHeading}
        title="Text style"
        options={[
          { value: "p", label: "Paragraph", icon: <Pilcrow className="h-3.5 w-3.5" /> },
          { value: "h1", label: "Heading 1", icon: <Heading1 className="h-3.5 w-3.5" /> },
          { value: "h2", label: "Heading 2", icon: <Heading2 className="h-3.5 w-3.5" /> },
          { value: "h3", label: "Heading 3", icon: <Heading3 className="h-3.5 w-3.5" /> },
        ]}
      />

      <ToolbarSep />

      <ToolbarButton
        title="Bold (Ctrl/⌘ B)"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Italic (Ctrl/⌘ I)"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Underline (Ctrl/⌘ U)"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Highlight"
        active={editor.isActive("highlight")}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <Highlighter className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Type className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarSep />

      <ToolbarButton
        title="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Task list"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListChecks className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarSep />

      <ToolbarButton
        title="Align left"
        active={editor.isActive({ textAlign: "left" })}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Align center"
        active={editor.isActive({ textAlign: "center" })}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Align right"
        active={editor.isActive({ textAlign: "right" })}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <AlignRight className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarSep />

      <ToolbarButton
        title={editor.isActive("link") ? "Edit link" : "Add link"}
        active={editor.isActive("link")}
        onClick={promptForLink}
      >
        <Link2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      {editor.isActive("link") ? (
        <ToolbarButton
          title="Remove link"
          onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
        >
          <Link2Off className="h-3.5 w-3.5" />
        </ToolbarButton>
      ) : null}
      <ToolbarButton
        title="Horizontal rule"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarSep />

      <ToolbarButton
        title="Undo (Ctrl/⌘ Z)"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Redo (Ctrl/⌘ Shift Z)"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo2 className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}

/** Pill-shaped toolbar button with an "active" state that uses the theme's primary colour. */
function ToolbarButton({
  children,
  onClick,
  active,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ? true : undefined}
      disabled={disabled}
      // onMouseDown preventDefault so clicking the button doesn't blur the
      // editor and lose the current selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-primary/15 text-primary ring-1 ring-primary/30"
          : "text-foreground/80 hover:bg-muted hover:text-foreground",
        disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-foreground/80" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/** Small native-select wrapped to look toolbar-native (icon-prefixed). */
function ToolbarSelect({
  value,
  onChange,
  options,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; icon?: ReactNode }>;
  title?: string;
}) {
  return (
    <label
      title={title}
      className="relative inline-flex h-7 items-center rounded-md text-xs text-foreground/80 hover:bg-muted hover:text-foreground"
    >
      <span className="pointer-events-none flex items-center pl-1.5">
        {options.find((o) => o.value === value)?.icon}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        className="h-7 cursor-pointer appearance-none bg-transparent pl-1.5 pr-1 text-xs font-medium focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToolbarSep() {
  return <span className="mx-0.5 h-5 w-px bg-border/70" aria-hidden />;
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Right-click menu                                                       */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Premium right-click menu for the collaborative editor.
 *
 * Renders at the cursor position, auto-clamps to the viewport, and
 * dismisses on outside-click, Escape, or scroll. Mirrors the most-used
 * commands in the toolbar plus standard editing primitives so users
 * never feel like they "lost features" compared to the legacy editor.
 */
function CollabContextMenu({
  x,
  y,
  editor,
  onClose,
}: {
  x: number;
  y: number;
  editor: Editor;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside-click / Escape / scroll. Stays open while interacting
  // with the menu itself (clicks inside don't dismiss).
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  // Clamp into the viewport after first paint (so we can read rect width/height).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y]);

  const close = onClose;

  // Selection helpers used by cut/copy/paste/select-all.
  const selectionText = useCallback(() => {
    const { from, to, empty } = editor.state.selection;
    if (empty) return "";
    return editor.state.doc.textBetween(from, to, "\n");
  }, [editor]);

  const doCopy = useCallback(async () => {
    const text = selectionText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard may be denied; ignore silently */
    }
  }, [selectionText]);

  const doCut = useCallback(async () => {
    const text = selectionText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
    editor.chain().focus().deleteSelection().run();
  }, [editor, selectionText]);

  const doPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) editor.chain().focus().insertContent(text).run();
    } catch {
      /* clipboard read may be denied; the user can still use Ctrl+V */
    }
  }, [editor]);

  const Item = ({
    icon,
    label,
    shortcut,
    onClick,
    disabled,
    danger,
  }: {
    icon: ReactNode;
    label: string;
    shortcut?: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (disabled) return;
        onClick();
        close();
      }}
      className={[
        "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        disabled
          ? "cursor-not-allowed text-muted-foreground/60"
          : danger
            ? "text-destructive hover:bg-destructive/10"
            : "text-foreground/90 hover:bg-muted",
      ].join(" ")}
    >
      <span className="flex items-center gap-2">
        <span className="flex h-3.5 w-3.5 items-center justify-center text-muted-foreground">
          {icon}
        </span>
        {label}
      </span>
      {shortcut ? (
        <span className="text-[10px] tabular-nums text-muted-foreground">{shortcut}</span>
      ) : null}
    </button>
  );

  const Sep = () => <div className="my-1 h-px bg-border/70" role="separator" />;

  const hasSelection = !editor.state.selection.empty;

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[140] w-60 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border/70 bg-popover/95 p-1 shadow-2xl ring-1 ring-black/5 backdrop-blur"
      style={{ left: x, top: y }}
    >
      <Item
        icon={<Undo2 className="h-3.5 w-3.5" />}
        label="Undo"
        shortcut="Ctrl Z"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <Item
        icon={<Redo2 className="h-3.5 w-3.5" />}
        label="Redo"
        shortcut="Ctrl ⇧ Z"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      />
      <Sep />
      <Item
        icon={<Scissors className="h-3.5 w-3.5" />}
        label="Cut"
        shortcut="Ctrl X"
        disabled={!hasSelection}
        onClick={() => void doCut()}
      />
      <Item
        icon={<CopyIcon className="h-3.5 w-3.5" />}
        label="Copy"
        shortcut="Ctrl C"
        disabled={!hasSelection}
        onClick={() => void doCopy()}
      />
      <Item
        icon={<ClipboardPaste className="h-3.5 w-3.5" />}
        label="Paste"
        shortcut="Ctrl V"
        onClick={() => void doPaste()}
      />
      <Sep />
      <Item
        icon={<Bold className="h-3.5 w-3.5" />}
        label="Bold"
        shortcut="Ctrl B"
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <Item
        icon={<Italic className="h-3.5 w-3.5" />}
        label="Italic"
        shortcut="Ctrl I"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <Item
        icon={<UnderlineIcon className="h-3.5 w-3.5" />}
        label="Underline"
        shortcut="Ctrl U"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <Item
        icon={<Strikethrough className="h-3.5 w-3.5" />}
        label="Strikethrough"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <Item
        icon={<Highlighter className="h-3.5 w-3.5" />}
        label="Highlight"
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      />
      <Sep />
      <Item
        icon={<List className="h-3.5 w-3.5" />}
        label="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <Item
        icon={<ListOrdered className="h-3.5 w-3.5" />}
        label="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <Item
        icon={<ListChecks className="h-3.5 w-3.5" />}
        label="Task list"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />
      <Item
        icon={<Quote className="h-3.5 w-3.5" />}
        label="Quote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <Item
        icon={<Code2 className="h-3.5 w-3.5" />}
        label="Code block"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <Sep />
      <Item
        icon={<Link2 className="h-3.5 w-3.5" />}
        label={editor.isActive("link") ? "Edit link" : "Add link"}
        onClick={() => {
          if (typeof window === "undefined") return;
          const previous = (editor.getAttributes("link") as { href?: string }).href ?? "";
          const url = window.prompt("Link URL (leave blank to remove)", previous);
          if (url === null) return;
          if (url.trim() === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
          }
          let href = url.trim();
          if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) href = `https://${href}`;
          editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
        }}
      />
      {editor.isActive("link") ? (
        <Item
          icon={<Link2Off className="h-3.5 w-3.5" />}
          label="Remove link"
          onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
        />
      ) : null}
      <Sep />
      <Item
        icon={<Type className="h-3.5 w-3.5" />}
        label="Select all"
        shortcut="Ctrl A"
        onClick={() => editor.chain().focus().selectAll().run()}
      />
    </div>
  );
}
