"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { supabase, type Note, type NotePage } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Star,
  Plus,
  Trash2,
  FileText,
  Copy,
  Check,
  Pencil,
  ChevronDown,
  Loader2,
  Palette,
  Highlighter,
  Type,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { linkifyText } from "@/lib/linkify";
import {
  migrateLegacyNoteMarkup,
  normalizeColorHex,
  isProbablyHtml,
  noteContentToEditorHtml,
  normalizeNoteHtmlForSave,
  normalizeNoteHtmlStructure,
  htmlToPlainText,
} from "@/lib/note-html";
import { NoteColorPicker } from "@/components/NoteColorPicker";

const INLINE_TOKEN_RE =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|==([^=\n]+)==|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\{\{c#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\}\}([\s\S]*?)\{\{\/c\}\}|\{\{s(\d{1,3})\}\}([\s\S]*?)\{\{\/s\}\}/g;
const BULLET_LINE_RE = /^(\s*)([-*•])\s+/;
const NUMBERED_LINE_RE = /^(\s*)\d+\.\s+/;

/** Styled via globals.css `.note-html-view mark.note-highlight` */
const NOTE_MARK_HIGHLIGHT_CLASS = "note-highlight";

const LS_LAST_PAGE_KEY = "notes:lastPageId";
const LS_LAST_NOTE_KEY = "notes:lastNoteId";

function readLs(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLs(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

function renderInlineMarkdown(text: string, depth = 0): ReactNode {
  const src = migrateLegacyNoteMarkup(text);
  if (depth > 8) {
    return <>{linkifyText(src)}</>;
  }

  const nodes: ReactNode[] = [];
  const re = new RegExp(INLINE_TOKEN_RE.source, "g");

  let lastIndex = 0;
  let partIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = re.exec(src))) {
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      nodes.push(
        <span key={`t-${partIndex++}`}>{linkifyText(src.slice(lastIndex, matchIndex))}</span>,
      );
    }

    const boldText = match[1];
    const italicText = match[2];
    const highlightText = match[3];
    const underlineText = match[4];
    const strikeText = match[5];
    const codeText = match[6];
    const colorHex = match[7];
    const colorInner = match[8];
    const sizePx = match[9];
    const sizeInner = match[10];

    if (typeof boldText === "string") {
      nodes.push(
        <strong key={`b-${partIndex++}`}>{linkifyText(boldText)}</strong>,
      );
    } else if (typeof italicText === "string") {
      nodes.push(
        <em key={`i-${partIndex++}`}>{linkifyText(italicText)}</em>,
      );
    } else if (typeof highlightText === "string") {
      nodes.push(
        <mark key={`hi-${partIndex++}`} className="note-highlight">
          {renderInlineMarkdown(highlightText, depth + 1)}
        </mark>,
      );
    } else if (typeof underlineText === "string") {
      nodes.push(
        <u key={`u-${partIndex++}`}>{linkifyText(underlineText)}</u>,
      );
    } else if (typeof strikeText === "string") {
      nodes.push(
        <s key={`s-${partIndex++}`}>{linkifyText(strikeText)}</s>,
      );
    } else if (typeof codeText === "string") {
      nodes.push(
        <code
          key={`c-${partIndex++}`}
          className="rounded bg-muted px-1 py-0.5 text-[0.9em] font-mono"
        >
          {codeText}
        </code>,
      );
    } else if (typeof colorHex === "string" && colorInner !== undefined) {
      const hex = normalizeColorHex(colorHex);
      nodes.push(
        <span
          key={`col-${partIndex++}`}
          style={{ color: `#${hex}` }}
          className="font-inherit"
        >
          {renderInlineMarkdown(colorInner, depth + 1)}
        </span>,
      );
    } else if (typeof sizePx === "string" && sizeInner !== undefined) {
      const px = Math.min(72, Math.max(8, parseInt(sizePx, 10) || 16));
      nodes.push(
        <span
          key={`sz-${partIndex++}`}
          style={{ fontSize: `${px}px` }}
          className="inline font-inherit leading-normal"
        >
          {renderInlineMarkdown(sizeInner, depth + 1)}
        </span>,
      );
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < src.length) {
    nodes.push(<span key={`t-${partIndex++}`}>{linkifyText(src.slice(lastIndex))}</span>);
  }

  return <>{nodes}</>;
}

function renderPreviewMarkdown(text: string): ReactNode {
  const body = migrateLegacyNoteMarkup(text);
  const lines = body.split(/\r?\n/);
  const out: ReactNode[] = [];
  let ulItems: ReactNode[] = [];
  let olItems: ReactNode[] = [];

  const flushUl = (key: number) => {
    if (ulItems.length === 0) return;
    out.push(
      <ul key={`ul-${key}`} className="list-disc pl-5">
        {ulItems}
      </ul>,
    );
    ulItems = [];
  };

  const flushOl = (key: number) => {
    if (olItems.length === 0) return;
    out.push(
      <ol key={`ol-${key}`} className="list-decimal pl-5">
        {olItems}
      </ol>,
    );
    olItems = [];
  };

  const flushLists = (key: number) => {
    flushUl(key);
    flushOl(key);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (NUMBERED_LINE_RE.test(line)) {
      flushUl(i);
      const itemText = line.replace(NUMBERED_LINE_RE, "");
      olItems.push(<li key={`oli-${i}`}>{renderInlineMarkdown(itemText)}</li>);
      continue;
    }

    if (BULLET_LINE_RE.test(line)) {
      flushOl(i);
      const itemText = line.replace(BULLET_LINE_RE, "");
      ulItems.push(<li key={`uli-${i}`}>{renderInlineMarkdown(itemText)}</li>);
      continue;
    }

    flushLists(i);

    if (line.trim().length === 0) {
      out.push(<div key={`sp-${i}`} className="h-2" />);
      continue;
    }

    const headingMatch = line.match(/^##\s+(.*)$/);
    if (headingMatch) {
      out.push(
        <h3
          key={`h-${i}`}
          className="scroll-m-20 text-lg font-semibold tracking-tight"
        >
          {renderInlineMarkdown(headingMatch[1] ?? "")}
        </h3>,
      );
      continue;
    }

    out.push(
      <p key={`p-${i}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(line)}
      </p>,
    );
  }

  flushLists(lines.length);
  return <>{out}</>;
}

const NOTE_HTML_VIEW_CLASS =
  "note-html-view min-h-0 space-y-2 text-sm [&_h3]:scroll-m-20 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-tight [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5";

function renderReadNoteBody(content: string): ReactNode {
  const t = content.trim();
  if (!t) {
    return (
      <span className="text-muted-foreground italic">Click here to write…</span>
    );
  }
  if (isProbablyHtml(content)) {
    return (
      <div
        className={NOTE_HTML_VIEW_CLASS}
        dangerouslySetInnerHTML={{
          __html: normalizeNoteHtmlStructure(content),
        }}
      />
    );
  }
  return renderPreviewMarkdown(content);
}

/** Handlers updated each parent render via ref so the editor subtree can stay memoized. */
type NoteEditorHandlers = {
  onInput: () => void;
  onPaste: (e: ClipboardEvent<HTMLDivElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onMouseUp: () => void;
  onKeyUp: () => void;
  onBlur: () => void;
};

type NoteBodyEditorProps = {
  editorRef: RefObject<HTMLDivElement | null>;
  noteId: string;
  editorSession: number;
  initialContent: string;
  handlersRef: MutableRefObject<NoteEditorHandlers>;
  onSessionHydrated: (normalizedBaseline: string) => void;
  className: string;
};

/**
 * Isolated from parent re-renders while typing. React reconciling a contentEditable
 * on every keystroke (parent setState) can duplicate or corrupt DOM text; this memo
 * only re-renders when the note or edit session changes.
 */
const NoteBodyEditor = memo(
  function NoteBodyEditor({
    editorRef,
    noteId,
    editorSession,
    initialContent,
    handlersRef,
    onSessionHydrated,
    className,
  }: NoteBodyEditorProps) {
    useLayoutEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = noteContentToEditorHtml(initialContent);
      onSessionHydrated(normalizeNoteHtmlForSave(el.innerHTML));
      // Only re-seed the editor when switching notes or starting a new edit session — not when parent note content updates from typing.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: initialContent read only on noteId/editorSession change
    }, [noteId, editorSession]);

    return (
      <div
        ref={editorRef as Ref<HTMLDivElement>}
        role="textbox"
        tabIndex={0}
        aria-multiline
        aria-label="Note body editor"
        contentEditable
        suppressContentEditableWarning
        className={className}
        onInput={() => handlersRef.current.onInput()}
        onPaste={(e) => handlersRef.current.onPaste(e)}
        onKeyDown={(e) => handlersRef.current.onKeyDown(e)}
        onMouseUp={() => handlersRef.current.onMouseUp()}
        onKeyUp={() => handlersRef.current.onKeyUp()}
        onBlur={() => handlersRef.current.onBlur()}
      />
    );
  },
  (prev, next) =>
    prev.noteId === next.noteId && prev.editorSession === next.editorSession,
);

export default function NotesPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pages, setPages] = useState<NotePage[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notesLoading, setNotesLoading] = useState(false);
  const [autoSaveState, setAutoSaveState] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const [isEditing, setIsEditing] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingNoteRowId, setEditingNoteRowId] = useState<string | null>(null);
  const [editingMainTitle, setEditingMainTitle] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [editorSession, setEditorSession] = useState(0);
  const [fmtActive, setFmtActive] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    highlight: false,
    unorderedList: false,
    orderedList: false,
    heading3: false,
  });
  /** Synced color well + hex field in Format panel (6-char #RRGGBB). */
  const [formatPanelColor, setFormatPanelColor] = useState("#2563eb");
  const [customFontSize, setCustomFontSize] = useState("16");
  const [newPageTitle, setNewPageTitle] = useState("");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [noteBodyFullscreen, setNoteBodyFullscreen] = useState(false);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  /** Last caret/selection inside the editor — Radix controls clear the live selection. */
  const editorSelectionRef = useRef<Range | null>(null);
  /** Normalized body last written (or baseline when editor opened); skips redundant autosave UI + PUT. */
  const lastAutoSavedBodyRef = useRef<string | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const selectedNoteIdRef = useRef<string | null>(null);
  selectedNoteIdRef.current = selectedNoteId;
  const skipNextNotesFetchForPageRef = useRef(false);

  const flashCopied = useCallback((key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 2000);
  }, []);

  const copyText = useCallback(
    async (text: string, key: string) => {
      try {
        await navigator.clipboard.writeText(text);
        flashCopied(key);
      } catch {
        // ignore
      }
    },
    [flashCopied],
  );

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  const authHeaders = useMemo<Record<string, string>>(
    () => ({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token],
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token ?? null);
    });
  }, []);

  useEffect(() => {
    setNoteBodyFullscreen(false);
  }, [selectedNoteId]);

  useEffect(() => {
    if (!noteBodyFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [noteBodyFullscreen]);

  useEffect(() => {
    if (!noteBodyFullscreen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setNoteBodyFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noteBodyFullscreen]);

  /** Initial load: pages first (fast shell), then notes; avoids duplicate notes fetch on mount. */
  useEffect(() => {
    if (!token) return;
    const ac = new AbortController();
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/notes/pages", {
          headers: authHeaders,
          signal: ac.signal,
        });
        if (!res.ok) throw new Error("pages");
        const pageData = ((await res.json()) as NotePage[]) ?? [];
        if (!alive) return;

        setPages(Array.isArray(pageData) ? pageData : []);
        const firstPageId = pageData[0]?.id ?? null;
        const pageIds = new Set(pageData.map((p) => p.id));
        const savedPageId = readLs(LS_LAST_PAGE_KEY);
        const initialPageId =
          savedPageId && pageIds.has(savedPageId) ? savedPageId : firstPageId;
        setSelectedPageId(initialPageId);
        setLoading(false);

        if (initialPageId) {
          skipNextNotesFetchForPageRef.current = true;
          setNotesLoading(true);
          const nr = await fetch(`/api/notes?pageId=${initialPageId}`, {
            headers: authHeaders,
            signal: ac.signal,
          });
          if (!alive) return;
          if (!nr.ok) {
            setNotes([]);
            setSelectedNoteId(null);
          } else {
            const data = (await nr.json()) as Note[];
            const list = Array.isArray(data) ? data : [];
            setNotes(list);
            const savedNoteId = readLs(LS_LAST_NOTE_KEY);
            const initialNoteId =
              savedNoteId && list.some((n) => n.id === savedNoteId)
                ? savedNoteId
                : list[0]?.id ?? null;
            setSelectedNoteId(initialNoteId);
          }
          setNotesLoading(false);
        } else {
          setNotes([]);
          setSelectedNoteId(null);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (alive) {
          setPages([]);
          setNotes([]);
          setSelectedPageId(null);
          setSelectedNoteId(null);
          setLoading(false);
          setNotesLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [token, authHeaders]);

  useEffect(() => {
    if (selectedPageId) writeLs(LS_LAST_PAGE_KEY, selectedPageId);
  }, [selectedPageId]);

  useEffect(() => {
    if (selectedNoteId) writeLs(LS_LAST_NOTE_KEY, selectedNoteId);
  }, [selectedNoteId]);

  /** Switch page: single notes fetch with abort if user switches again. */
  useEffect(() => {
    if (!token || !selectedPageId) return;
    if (skipNextNotesFetchForPageRef.current) {
      skipNextNotesFetchForPageRef.current = false;
      return;
    }

    const ac = new AbortController();
    let alive = true;
    setNotesLoading(true);

    (async () => {
      try {
        const res = await fetch(`/api/notes?pageId=${selectedPageId}`, {
          headers: authHeaders,
          signal: ac.signal,
        });
        if (!alive) return;
        if (!res.ok) {
          setNotes([]);
          setSelectedNoteId(null);
          return;
        }
        const data = (await res.json()) as Note[];
        const list = Array.isArray(data) ? data : [];
        setNotes(list);
        setSelectedNoteId((prev) => {
          if (prev && list.some((n) => n.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (alive) {
          setNotes([]);
          setSelectedNoteId(null);
        }
      } finally {
        if (alive) setNotesLoading(false);
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [selectedPageId, token, authHeaders]);

  useEffect(() => {
    setEditingPageId(null);
  }, [selectedPageId]);

  useEffect(() => {
    if (!selectedNoteId) return;
    setIsEditing(false);
    setFormatMenuOpen(false);
    setEditingMainTitle(false);
    setEditingNoteRowId(null);
  }, [selectedNoteId]);

  const createPage = async () => {
    if (!token) return;
    const title = newPageTitle.trim();
    if (!title) return;
    const res = await fetch("/api/notes/pages", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return;
    const created = (await res.json()) as NotePage;
    setPages((prev) => [created, ...prev]);
    setSelectedPageId(created.id);
    setSelectedNoteId(null);
    setNewPageTitle("");
  };

  const updatePage = async (
    pageId: string,
    patch: Partial<Pick<NotePage, "title" | "favorite">>,
  ) => {
    const res = await fetch(`/api/notes/pages/${pageId}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify(patch),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as NotePage;
    setPages((prev) => prev.map((p) => (p.id === pageId ? updated : p)));
  };

  const deletePage = async (pageId: string) => {
    const res = await fetch(`/api/notes/pages/${pageId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!res.ok) return;
    const remaining = pages.filter((p) => p.id !== pageId);
    setPages(remaining);
    if (selectedPageId === pageId) {
      setSelectedPageId(remaining[0]?.id ?? null);
      setSelectedNoteId(null);
    }
  };

  const createNote = async () => {
    if (!selectedPageId) return;
    const title = newNoteTitle.trim();
    if (!title) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ pageId: selectedPageId, title, content: "" }),
    });
    if (!res.ok) return;
    const created = (await res.json()) as Note;
    setNotes((prev) => [created, ...prev]);
    setSelectedNoteId(created.id);
    setNewNoteTitle("");
  };

  const updateNote = async (
    noteId: string,
    patch: Partial<Pick<Note, "title" | "content" | "favorite">>,
    opts?: { silent?: boolean },
  ) => {
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify(patch),
    });
    if (!res.ok) return false;
    const updated = (await res.json()) as Note;
    setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
    return true;
  };

  const updateNoteRef = useRef(updateNote);
  updateNoteRef.current = updateNote;

  const persistNoteBody = useCallback(
    async (noteId: string, content: string, showIndicator: boolean) => {
      const normalized = normalizeNoteHtmlForSave(content);
      if (
        lastAutoSavedBodyRef.current !== null &&
        normalized === lastAutoSavedBodyRef.current
      ) {
        return true;
      }
      if (showIndicator) setAutoSaveState("saving");
      const ok = await updateNoteRef.current(
        noteId,
        { content: normalized },
        { silent: true },
      );
      if (ok) {
        lastAutoSavedBodyRef.current = normalized;
        if (
          typeof document !== "undefined" &&
          editorRef.current &&
          selectedNoteIdRef.current === noteId &&
          normalized !== content
        ) {
          const current = editorRef.current.innerHTML;
          if (current === content) {
            editorRef.current.innerHTML = normalized
              ? normalized
              : "<p><br></p>";
            lastAutoSavedBodyRef.current = normalizeNoteHtmlForSave(
              editorRef.current.innerHTML,
            );
            // Keep React state in sync with normalized DOM so read view never shows
            // plain URL + linkified duplicate until the next full refresh.
            setNotes((prev) =>
              prev.map((n) =>
                n.id === noteId ? { ...n, content: normalized } : n,
              ),
            );
          }
        }
      }
      if (showIndicator) {
        if (ok) {
          setAutoSaveState("saved");
          window.setTimeout(() => setAutoSaveState("idle"), 1200);
        } else {
          setAutoSaveState("idle");
        }
      }
      return ok;
    },
    [],
  );

  const persistNoteBodyRef = useRef(persistNoteBody);
  persistNoteBodyRef.current = persistNoteBody;

  useEffect(() => {
    if (!isEditing || !selectedNoteId) return;
    const id = window.setInterval(() => {
      const n = notesRef.current.find((x) => x.id === selectedNoteId);
      if (!n || !editorRef.current) return;
      const raw = editorRef.current.innerHTML;
      void persistNoteBody(n.id, raw, true);
    }, 4000);
    return () => clearInterval(id);
  }, [isEditing, selectedNoteId, persistNoteBody]);

  const deleteNote = async (noteId: string) => {
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!res.ok) return;
    const remaining = notes.filter((n) => n.id !== noteId);
    setNotes(remaining);
    if (selectedNoteId === noteId) setSelectedNoteId(remaining[0]?.id ?? null);
  };

  const selectionInEditor = useCallback(() => {
    const root = editorRef.current;
    if (!root) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    return root.contains(sel.anchorNode);
  }, []);

  const selectionInsideHeading3 = useCallback(() => {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode)) return false;
    let n: Node | null = sel.anchorNode;
    if (n.nodeType === Node.TEXT_NODE) n = (n as Text).parentElement;
    while (n && n !== root) {
      if (n instanceof HTMLElement && n.tagName === "H3") return true;
      n = n.parentElement;
    }
    return false;
  }, []);

  const selectionInsideHighlight = useCallback(() => {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode)) return false;
    let n: Node | null = sel.anchorNode;
    if (n.nodeType === Node.TEXT_NODE) n = (n as Text).parentElement;
    while (n && n !== root) {
      if (n instanceof HTMLElement && n.tagName === "MARK") {
        return true;
      }
      n = n.parentElement;
    }
    return false;
  }, []);

  /** Restore selection after Radix/toolbar clicks cleared it (required for execCommand + font size). */
  const restoreEditorSelection = useCallback((): boolean => {
    const root = editorRef.current;
    if (!root) return false;
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const r = sel.getRangeAt(0);
      if (root.contains(r.commonAncestorContainer)) return true;
    }
    const saved = editorSelectionRef.current;
    if (saved && root.contains(saved.commonAncestorContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(saved.cloneRange());
      return true;
    }
    return false;
  }, []);

  const refreshFmt = useCallback(() => {
    if (!isEditing || !selectionInEditor()) return;
    try {
      let heading3 = false;
      try {
        const raw = (
          document.queryCommandValue("formatBlock") || ""
        ).toLowerCase();
        heading3 =
          raw.includes("h3") ||
          raw.includes("heading 3") ||
          raw === "3";
      } catch {
        /* ignore */
      }
      if (!heading3) heading3 = selectionInsideHeading3();
      setFmtActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strikeThrough: document.queryCommandState("strikeThrough"),
        highlight: selectionInsideHighlight(),
        unorderedList: document.queryCommandState("insertUnorderedList"),
        orderedList: document.queryCommandState("insertOrderedList"),
        heading3,
      });
    } catch {
      // ignore
    }
  }, [isEditing, selectionInEditor, selectionInsideHeading3, selectionInsideHighlight]);

  useEffect(() => {
    if (!isEditing) return;
    const onSel = () => {
      const root = editorRef.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0) {
        editorSelectionRef.current = null;
      } else {
        const r = sel.getRangeAt(0);
        if (root.contains(r.commonAncestorContainer)) {
          editorSelectionRef.current = r.cloneRange();
        } else {
          editorSelectionRef.current = null;
        }
      }
      refreshFmt();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [isEditing, refreshFmt]);

  const runFormatCommand = useCallback(
    (command: string, value?: string) => {
      const root = editorRef.current;
      root?.focus();
      restoreEditorSelection();
      try {
        document.execCommand(command, false, value);
      } catch {
        /* ignore */
      }
      root?.dispatchEvent(new Event("input", { bubbles: true }));
      refreshFmt();
    },
    [refreshFmt, restoreEditorSelection],
  );

  const normalizePanelHex = useCallback((raw: string): string | null => {
    let h = raw.replace(/^#/, "").trim();
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return `#${h.toLowerCase()}`;
  }, []);

  const applyForeColor = useCallback(
    (hex: string) => {
      const full = normalizePanelHex(hex);
      if (!full) return;
      setFormatPanelColor(full);
      editorRef.current?.focus();
      restoreEditorSelection();
      try {
        document.execCommand("styleWithCSS", false, "true");
      } catch {
        /* ignore */
      }
      try {
        document.execCommand("foreColor", false, full);
      } catch {
        /* ignore */
      }
      editorRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
      refreshFmt();
    },
    [normalizePanelHex, refreshFmt, restoreEditorSelection],
  );

  const applyHighlightColor = useCallback(() => {
    const root = editorRef.current;
    root?.focus();
    if (!restoreEditorSelection()) return;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer)) return;
    const mark = document.createElement("mark");
    mark.className = NOTE_MARK_HIGHLIGHT_CLASS;
    if (r.collapsed) {
      mark.appendChild(document.createTextNode("\u200b"));
      r.insertNode(mark);
      const z = mark.firstChild;
      if (z) {
        const nr = document.createRange();
        nr.setStart(z, 1);
        nr.collapse(true);
        sel.removeAllRanges();
        sel.addRange(nr);
      }
    } else {
      try {
        r.surroundContents(mark);
      } catch {
        const frag = r.extractContents();
        mark.appendChild(frag);
        r.insertNode(mark);
      }
      sel.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(mark);
      nr.collapse(false);
      sel.addRange(nr);
    }
    root.dispatchEvent(new Event("input", { bubbles: true }));
    refreshFmt();
  }, [refreshFmt, restoreEditorSelection]);

  const applyFontSizePx = useCallback(
    (px: number) => {
      const size = Math.min(100, Math.max(1, Math.round(Number(px)) || 16));
      const root = editorRef.current;
      root?.focus();
      if (!restoreEditorSelection()) return;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (!root.contains(r.commonAncestorContainer)) return;
      const span = document.createElement("span");
      span.style.setProperty("font-size", `${size}px`, "important");
      if (r.collapsed) {
        span.appendChild(document.createTextNode("\u200b"));
        r.insertNode(span);
        const z = span.firstChild;
        if (z) {
          const nr = document.createRange();
          nr.setStart(z, 1);
          nr.collapse(true);
          sel.removeAllRanges();
          sel.addRange(nr);
        }
      } else {
        try {
          r.surroundContents(span);
        } catch {
          const frag = r.extractContents();
          span.appendChild(frag);
          r.insertNode(span);
        }
        sel.removeAllRanges();
        const nr = document.createRange();
        nr.selectNodeContents(span);
        nr.collapse(false);
        sel.addRange(nr);
      }
      root.dispatchEvent(new Event("input", { bubbles: true }));
      refreshFmt();
    },
    [refreshFmt, restoreEditorSelection],
  );

  const wrapSelectionInCode = useCallback(() => {
    const root = editorRef.current;
    root?.focus();
    if (!restoreEditorSelection()) return;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer)) return;
    const code = document.createElement("code");
    code.className =
      "rounded bg-muted px-1 py-0.5 text-[0.9em] font-mono";
    if (r.collapsed) {
      code.textContent = "code";
      r.insertNode(code);
    } else {
      try {
        r.surroundContents(code);
      } catch {
        const frag = r.extractContents();
        code.appendChild(frag);
        r.insertNode(code);
      }
    }
    sel.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(code);
    sel.addRange(nr);
    root.dispatchEvent(new Event("input", { bubbles: true }));
    refreshFmt();
  }, [refreshFmt, restoreEditorSelection]);

  const toggleHeadingBlock = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    restoreEditorSelection();
    try {
      document.execCommand("styleWithCSS", false, "true");
    } catch {
      /* ignore */
    }
    let inH3 = false;
    try {
      const raw = (
        document.queryCommandValue("formatBlock") || ""
      ).toLowerCase();
      inH3 =
        raw.includes("h3") ||
        raw.includes("heading 3") ||
        raw === "3";
    } catch {
      /* ignore */
    }
    if (!inH3) inH3 = selectionInsideHeading3();
    try {
      if (inH3) {
        document.execCommand("formatBlock", false, "p");
      } else {
        document.execCommand("formatBlock", false, "h3");
      }
    } catch {
      /* ignore */
    }
    root.dispatchEvent(new Event("input", { bubbles: true }));
    refreshFmt();
  }, [refreshFmt, selectionInsideHeading3, restoreEditorSelection]);

  const beginEditingNote = useCallback(() => {
    setEditorSession((s) => s + 1);
    setIsEditing(true);
  }, []);

  const onEditorSessionHydrated = useCallback((baseline: string) => {
    lastAutoSavedBodyRef.current = baseline;
  }, []);

  /** Uses refs so it stays valid when NoteBodyEditor is memoized and skips re-renders. */
  const syncEditorToState = useCallback(() => {
    const id = selectedNoteIdRef.current;
    if (!id) return;
    const html = editorRef.current?.innerHTML ?? "";
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, content: html } : n)),
    );
  }, []);

  const handleEditorBlur = useCallback(() => {
    void (async () => {
      const raw = editorRef.current?.innerHTML ?? "";
      const normalized = normalizeNoteHtmlForSave(raw);
      const sid = selectedNoteIdRef.current;
      if (!sid) return;
      setNotes((prev) =>
        prev.map((n) =>
          n.id === sid ? { ...n, content: normalized } : n,
        ),
      );
      await persistNoteBodyRef.current(sid, normalized, true);
      setIsEditing(false);
      setFormatMenuOpen(false);
    })();
  }, []);

  const handleEditorKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "b" || k === "i" || k === "u") {
        e.preventDefault();
        if (k === "b") runFormatCommand("bold");
        else if (k === "i") runFormatCommand("italic");
        else runFormatCommand("underline");
      }
    },
    [runFormatCommand],
  );

  const handleEditorPaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      const root = editorRef.current;
      if (!root) return;
      root.focus();
      try {
        document.execCommand("insertText", false, text);
      } catch {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const r = sel.getRangeAt(0);
        if (!root.contains(r.commonAncestorContainer)) return;
        r.deleteContents();
        r.insertNode(document.createTextNode(text));
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      root.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [],
  );

  const editorHandlersRef = useRef<NoteEditorHandlers>({
    onInput: () => {},
    onPaste: () => {},
    onKeyDown: () => {},
    onMouseUp: () => {},
    onKeyUp: () => {},
    onBlur: () => {},
  });
  editorHandlersRef.current = {
    onInput: syncEditorToState,
    onPaste: handleEditorPaste,
    onKeyDown: handleEditorKeyDown,
    onMouseUp: refreshFmt,
    onKeyUp: refreshFmt,
    onBlur: handleEditorBlur,
  };

  if (!token) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">
        Please sign in to use Notes.
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Notes</h1>
        <p className="text-muted-foreground">
          Create pages, store client notes, favorite key items, and edit
          anytime. Your notes are saved to{" "}
          <strong className="font-medium text-foreground">
            your signed-in account only
          </strong>{" "}
          (e.g. Google via Supabase)—other users never see them.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
          <span>Loading…</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,320px)_minmax(0,1fr)] lg:items-start">
          <section className="min-w-0 cursor-default rounded-xl border bg-card p-3 space-y-3">
            <Label className="text-xs text-muted-foreground">Pages</Label>
            <div className="flex gap-2">
              <Input
                placeholder="New page title..."
                value={newPageTitle}
                onChange={(e) => setNewPageTitle(e.target.value)}
              />
              <Button
                type="button"
                size="icon"
                disabled={!newPageTitle.trim()}
                onClick={createPage}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-1">
              {pages.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "flex cursor-default items-center gap-1 rounded-lg border px-1.5 py-1",
                    selectedPageId === p.id &&
                      "border-indigo-500 bg-indigo-500/10",
                  )}
                >
                  {editingPageId === p.id ? (
                    <Input
                      aria-label="Page title"
                      autoFocus
                      className="h-8 min-w-0 flex-1 text-sm"
                      value={p.title}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPages((prev) =>
                          prev.map((x) =>
                            x.id === p.id ? { ...x, title: v } : x,
                          ),
                        );
                      }}
                      onBlur={(e) => {
                        const t = e.target.value.trim() || "Untitled Page";
                        void updatePage(p.id, { title: t });
                        setEditingPageId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingPageId(null);
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="min-w-0 flex-1 cursor-default truncate text-left text-sm"
                        onClick={() => {
                          setSelectedPageId(p.id);
                          setSelectedNoteId(null);
                        }}
                      >
                        {p.title}
                      </button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        title="Edit page name"
                        onClick={() => {
                          setSelectedPageId(p.id);
                          setSelectedNoteId(null);
                          setEditingPageId(p.id);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Copy page title"
                    onClick={() => void copyText(p.title, `page-${p.id}`)}
                  >
                    {copiedKey === `page-${p.id}` ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePage(p.id, { favorite: !p.favorite })}
                  >
                    <Star
                      className={cn(
                        "h-4 w-4",
                        p.favorite
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-muted-foreground",
                      )}
                    />
                  </button>
                  <button type="button" onClick={() => deletePage(p.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="min-w-0 cursor-default rounded-xl border bg-card p-3 space-y-3">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <div className="flex gap-2">
              <Input
                placeholder="New note title..."
                value={newNoteTitle}
                onChange={(e) => setNewNoteTitle(e.target.value)}
                disabled={!selectedPageId}
              />
              <Button
                type="button"
                size="icon"
                onClick={createNote}
                disabled={!selectedPageId || !newNoteTitle.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="relative space-y-1 min-h-[120px]">
              {notesLoading && (
                <div
                  className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-[1px]"
                  aria-busy
                >
                  <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                </div>
              )}
              {notes.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "flex cursor-default items-center gap-1 rounded-lg border px-1.5 py-1",
                    selectedNoteId === n.id &&
                      "border-violet-500 bg-violet-500/10",
                  )}
                >
                  {editingNoteRowId === n.id ? (
                    <Input
                      aria-label="Note title"
                      autoFocus
                      className="h-8 min-w-0 flex-1 text-sm"
                      value={n.title}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNotes((prev) =>
                          prev.map((x) =>
                            x.id === n.id ? { ...x, title: v } : x,
                          ),
                        );
                      }}
                      onBlur={(e) => {
                        const t = e.target.value.trim() || "Untitled Note";
                        void updateNote(n.id, { title: t }, { silent: true });
                        setEditingNoteRowId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingNoteRowId(null);
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="min-w-0 flex-1 cursor-default truncate text-left text-sm"
                        onClick={() => setSelectedNoteId(n.id)}
                      >
                        {n.title}
                      </button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        title="Edit note name"
                        onClick={() => {
                          setSelectedNoteId(n.id);
                          setEditingNoteRowId(n.id);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Copy note title"
                    onClick={() => void copyText(n.title, `note-title-${n.id}`)}
                  >
                    {copiedKey === `note-title-${n.id}` ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void updateNote(
                        n.id,
                        { favorite: !n.favorite },
                        { silent: true },
                      )
                    }
                  >
                    <Star
                      className={cn(
                        "h-4 w-4",
                        n.favorite
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-muted-foreground",
                      )}
                    />
                  </button>
                  <button type="button" onClick={() => deleteNote(n.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-0 min-w-0 cursor-default flex-col overflow-hidden rounded-xl border bg-card p-4 lg:max-h-[calc(100vh-7rem)]">
            {selectedNote ? (
              <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-4 overflow-hidden">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {editingMainTitle ? (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                          aria-label="Note heading"
                          autoFocus
                          className="min-w-0 flex-1 font-semibold"
                          placeholder="Note title"
                          value={selectedNote.title}
                          onChange={(e) => {
                            const v = e.target.value;
                            setNotes((prev) =>
                              prev.map((n) =>
                                n.id === selectedNote.id
                                  ? { ...n, title: v }
                                  : n,
                              ),
                            );
                          }}
                          onBlur={(e) => {
                            const t = e.target.value.trim() || "Untitled Note";
                            void updateNote(
                              selectedNote.id,
                              { title: t },
                              { silent: true },
                            );
                            setEditingMainTitle(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingMainTitle(false);
                          }}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          title="Copy title"
                          onClick={() =>
                            void copyText(
                              selectedNote.title,
                              `editor-title-${selectedNote.id}`,
                            )
                          }
                        >
                          {copiedKey === `editor-title-${selectedNote.id}` ? (
                            <Check className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          <span className="sr-only">Copy title</span>
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <span className="min-w-0 truncate font-semibold">
                          {selectedNote.title}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          title="Copy title"
                          onClick={() =>
                            void copyText(
                              selectedNote.title,
                              `editor-title-${selectedNote.id}`,
                            )
                          }
                        >
                          {copiedKey === `editor-title-${selectedNote.id}` ? (
                            <Check className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          <span className="sr-only">Copy title</span>
                        </Button>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        title="Edit note title"
                        onClick={() => setEditingMainTitle(true)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
                <div
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1 flex-col space-y-2",
                    noteBodyFullscreen &&
                      "fixed inset-0 z-[100] box-border flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-background p-4 shadow-2xl sm:p-6",
                  )}
                >
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <Label className="text-xs text-muted-foreground">
                        Note body
                      </Label>
                      {isEditing && autoSaveState === "saving" && (
                        <Loader2
                          className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
                          aria-label="Saving"
                        />
                      )}
                      {isEditing && autoSaveState === "saved" && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 animate-in fade-in zoom-in-95 duration-200 dark:text-emerald-400">
                          <Check className="h-3.5 w-3.5" aria-hidden />
                          Saved
                        </span>
                      )}
                    </div>
                    <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          title="Copy note body"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            const c = selectedNote.content;
                            const plain = isProbablyHtml(c)
                              ? htmlToPlainText(c)
                              : c;
                            void copyText(plain, `editor-body-${selectedNote.id}`);
                          }}
                        >
                          {copiedKey === `editor-body-${selectedNote.id}` ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" />
                              Copied body
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 mr-1" />
                              Copy body
                            </>
                          )}
                        </Button>

                        {isEditing && (
                          <div className="relative" ref={formatMenuRef}>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className={cn(
                                "h-7 gap-1 px-2 text-xs",
                                formatMenuOpen &&
                                  "border-primary ring-1 ring-primary/30",
                              )}
                              title="Text formatting"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => setFormatMenuOpen((o) => !o)}
                            >
                              <Type className="h-3.5 w-3.5" />
                              Format
                              <ChevronDown
                                className={cn(
                                  "h-3.5 w-3.5 transition-transform",
                                  formatMenuOpen && "rotate-180",
                                )}
                              />
                            </Button>
                            {formatMenuOpen && (
                              <div
                                className="absolute right-0 z-50 mt-1 w-[min(100vw-1rem,26rem)] max-h-[min(90vh,640px)] overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-md"
                                onMouseDown={(e) => e.preventDefault()}
                              >
                                <div className="mb-2 flex flex-wrap gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-9 px-0",
                                      fmtActive.bold &&
                                        "border-primary bg-primary/10",
                                    )}
                                    title="Bold"
                                    onClick={() =>
                                      runFormatCommand("bold")
                                    }
                                  >
                                    <span className="font-bold">B</span>
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-9 px-0 italic",
                                      fmtActive.italic &&
                                        "border-primary bg-primary/10",
                                    )}
                                    title="Italic"
                                    onClick={() =>
                                      runFormatCommand("italic")
                                    }
                                  >
                                    I
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-9 px-0 underline",
                                      fmtActive.underline &&
                                        "border-primary bg-primary/10",
                                    )}
                                    title="Underline"
                                    onClick={() =>
                                      runFormatCommand("underline")
                                    }
                                  >
                                    U
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-9 px-0 line-through",
                                      fmtActive.strikeThrough &&
                                        "border-primary bg-primary/10",
                                    )}
                                    title="Strikethrough"
                                    onClick={() =>
                                      runFormatCommand("strikeThrough")
                                    }
                                  >
                                    S
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-9 px-0",
                                      fmtActive.highlight &&
                                        "border-primary bg-primary/10",
                                    )}
                                    title="Highlight selection"
                                    onClick={applyHighlightColor}
                                  >
                                    <Highlighter
                                      className={cn(
                                        "h-3.5 w-3.5",
                                        fmtActive.highlight &&
                                          "text-primary",
                                      )}
                                    />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-9 px-0",
                                      fmtActive.unorderedList &&
                                        "border-primary bg-primary/10",
                                    )}
                                    title="Bullet list"
                                    onClick={() =>
                                      runFormatCommand(
                                        "insertUnorderedList",
                                      )
                                    }
                                  >
                                    •
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                      "h-8 min-w-9 px-1 text-xs",
                                      fmtActive.orderedList &&
                                        "border-primary bg-primary/10",
                                    )}
                                    title="Numbered list"
                                    onClick={() =>
                                      runFormatCommand("insertOrderedList")
                                    }
                                  >
                                    1.
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                      "h-8 px-2 text-xs",
                                      fmtActive.heading3 &&
                                        "border-primary bg-primary/10",
                                    )}
                                    title="Heading — click again to remove"
                                    onClick={toggleHeadingBlock}
                                  >
                                    H3
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 font-mono text-xs"
                                    title="Inline code"
                                    onClick={wrapSelectionInCode}
                                  >
                                    &lt;/&gt;
                                  </Button>
                                </div>
                                <div className="mb-2 space-y-2 border-t border-border/60 pt-2">
                                  <div className="flex items-center gap-2">
                                    <Palette className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Color
                                    </span>
                                  </div>
                                  <NoteColorPicker
                                    value={formatPanelColor}
                                    onChange={applyForeColor}
                                  />
                                </div>
                                <div className="flex flex-col gap-2 border-t border-border/60 pt-2">
                                  <div className="flex flex-wrap items-end gap-2">
                                    <div className="flex min-w-0 flex-col gap-1">
                                      <Label
                                        htmlFor="note-custom-font-size"
                                        className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                                      >
                                        Font size (px)
                                      </Label>
                                      <Input
                                        id="note-custom-font-size"
                                        type="number"
                                        min={1}
                                        max={100}
                                        className="h-8 w-24 text-xs"
                                        value={customFontSize}
                                        onChange={(e) =>
                                          setCustomFontSize(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key !== "Enter") return;
                                          e.preventDefault();
                                          const n = Number(customFontSize);
                                          if (!Number.isFinite(n)) return;
                                          queueMicrotask(() => {
                                            editorRef.current?.focus();
                                            applyFontSizePx(n);
                                          });
                                        }}
                                      />
                                    </div>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      className="h-8 shrink-0 text-xs"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => {
                                        const n = Number(customFontSize);
                                        if (!Number.isFinite(n)) return;
                                        queueMicrotask(() => {
                                          editorRef.current?.focus();
                                          applyFontSizePx(n);
                                        });
                                      }}
                                    >
                                      Apply
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          title={
                            noteBodyFullscreen
                              ? "Exit expanded view"
                              : "Expand note body"
                          }
                          aria-pressed={noteBodyFullscreen}
                          onClick={() =>
                            setNoteBodyFullscreen((open) => !open)
                          }
                        >
                          {noteBodyFullscreen ? (
                            <Minimize2
                              className="h-3.5 w-3.5"
                              aria-hidden
                            />
                          ) : (
                            <Maximize2
                              className="h-3.5 w-3.5"
                              aria-hidden
                            />
                          )}
                          <span className="sr-only">
                            {noteBodyFullscreen
                              ? "Exit expanded view"
                              : "Expand note body"}
                          </span>
                        </Button>
                      </div>
                    </div>
                  </div>
                  {isEditing ? (
                    <NoteBodyEditor
                      editorRef={editorRef}
                      noteId={selectedNote.id}
                      editorSession={editorSession}
                      initialContent={selectedNote.content}
                      handlersRef={editorHandlersRef}
                      onSessionHydrated={onEditorSessionHydrated}
                      className={cn(
                        "note-html-scroll w-full min-w-0 max-w-full flex-1 cursor-text overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring",
                        NOTE_HTML_VIEW_CLASS,
                        noteBodyFullscreen
                          ? "min-h-0 flex-1 max-h-none sm:min-h-0"
                          : "min-h-[200px] max-h-[min(65vh,520px)] sm:min-h-[240px] sm:max-h-[min(70vh,560px)]",
                      )}
                    />
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Click to edit note"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          beginEditingNote();
                          requestAnimationFrame(() =>
                            editorRef.current?.focus(),
                          );
                        }
                      }}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a")) return;
                        beginEditingNote();
                        requestAnimationFrame(() =>
                          editorRef.current?.focus(),
                        );
                      }}
                      className={cn(
                        "note-html-scroll w-full min-w-0 max-w-full flex-1 cursor-pointer select-text overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere]",
                        noteBodyFullscreen
                          ? "min-h-0 flex-1 max-h-none sm:min-h-0"
                          : "min-h-[200px] max-h-[min(65vh,520px)] sm:min-h-[240px] sm:max-h-[min(70vh,560px)]",
                      )}
                      aria-live="polite"
                    >
                      {renderReadNoteBody(selectedNote.content)}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">
                Select or create a note to start writing.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
