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
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { supabase, type Note, type NotePage } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Star,
  Plus,
  Clock,
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
  ImagePlus,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Eraser,
  ClipboardPaste,
  ListChecks,
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

/** Tooltip for format toolbar: optional Ctrl/⌘ shortcut on hover. */
/** Relative time for note `updatedAt` (ISO); refreshes when `nowMs` bumps each minute. */
function formatNoteEditedRelative(
  iso: string | undefined,
  nowMs: number,
): string {
  if (!iso) return "";
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return "";
  const diffSec = Math.round((d - nowMs) / 1000);
  try {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const abs = Math.abs(diffSec);
    if (abs < 45) return rtf.format(diffSec, "second");
    const diffMin = Math.round(diffSec / 60);
    if (Math.abs(diffMin) < 45) return rtf.format(diffMin, "minute");
    const diffHour = Math.round(diffMin / 60);
    if (Math.abs(diffHour) < 36) return rtf.format(diffHour, "hour");
    const diffDay = Math.round(diffHour / 24);
    if (Math.abs(diffDay) < 25) return rtf.format(diffDay, "day");
    const diffMonth = Math.round(diffDay / 30);
    if (Math.abs(diffMonth) < 11) return rtf.format(diffMonth, "month");
    return rtf.format(Math.round(diffDay / 365), "year");
  } catch {
    return new Date(d).toLocaleString();
  }
}

function formatShortcutTooltip(
  label: string,
  opts?: { key?: string; extra?: string },
): string {
  if (opts?.extra) return `${label} — ${opts.extra}`;
  if (opts?.key) {
    if (typeof navigator === "undefined") return `${label} — Ctrl+${opts.key}`;
    const mac = /Mac|iPhone|iPad/i.test(navigator.platform);
    return mac ? `${label} — ⌘${opts.key}` : `${label} — Ctrl+${opts.key}`;
  }
  return `${label} — click again to toggle`;
}

function unwrapElement(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
  if (parent instanceof HTMLElement) parent.normalize();
}

function depthFromRoot(el: HTMLElement, root: HTMLElement): number {
  let d = 0;
  let n: Node | null = el;
  while (n && n !== root) {
    d++;
    n = n.parentNode;
  }
  return d;
}

function collectMarksIntersectingRange(
  root: HTMLElement,
  range: Range,
  highlightClass: string,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll(`mark.${highlightClass}`).forEach((el) => {
    if (el instanceof HTMLElement && range.intersectsNode(el)) {
      out.push(el);
    }
  });
  out.sort((a, b) => depthFromRoot(b, root) - depthFromRoot(a, root));
  return out;
}

function collectCodesIntersectingRange(
  root: HTMLElement,
  range: Range,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll("code").forEach((el) => {
    if (el instanceof HTMLElement && range.intersectsNode(el)) {
      out.push(el);
    }
  });
  out.sort((a, b) => depthFromRoot(b, root) - depthFromRoot(a, root));
  return out;
}

/** Character offsets in `root` text (Range.toString order) → DOM Range. */
function getRangeForTextSpan(
  root: HTMLElement,
  startChar: number,
  endChar: number,
): Range | null {
  if (endChar < startChar) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const len = t.length;
    if (pos + len > startChar && startNode === null) {
      startNode = t;
      startOff = Math.max(0, startChar - pos);
    }
    if (pos + len >= endChar) {
      endNode = t;
      endOff = Math.min(len, endChar - pos);
      break;
    }
    pos += len;
  }
  if (!startNode || !endNode) return null;
  const r = document.createRange();
  r.setStart(startNode, startOff);
  r.setEnd(endNode, endOff);
  return r;
}

function isInsideNoteMentionAnchor(node: Node, root: HTMLElement): boolean {
  let el: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (el && el !== root) {
    if (
      el instanceof HTMLElement &&
      el.tagName === "A" &&
      el.hasAttribute("data-note-id")
    ) {
      return true;
    }
    el = el.parentNode;
  }
  return false;
}

type MentionContext = {
  query: string;
  replaceRange: Range;
  caretRect: DOMRect;
};

/** `@` + optional query at caret (for inline mention picker). */
function getMentionContext(
  root: HTMLElement,
  caretRange: Range,
): MentionContext | null {
  if (!root.contains(caretRange.commonAncestorContainer)) return null;
  if (isInsideNoteMentionAnchor(caretRange.commonAncestorContainer, root)) {
    return null;
  }

  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(caretRange.endContainer, caretRange.endOffset);
  const text = pre.toString();
  const lastAt = text.lastIndexOf("@");
  if (lastAt === -1) return null;
  const beforeChar = lastAt === 0 ? "\n" : text[lastAt - 1];
  if (beforeChar !== "\n" && !/\s/.test(beforeChar)) return null;
  const query = text.slice(lastAt + 1);
  if (query.includes("\n")) return null;

  const replaceRange = getRangeForTextSpan(root, lastAt, text.length);
  if (!replaceRange) return null;
  const caretRect = caretRange.getBoundingClientRect();
  return { query, replaceRange, caretRect };
}

const LS_LAST_PAGE_KEY = "notes:lastPageId";
const LS_LAST_NOTE_KEY = "notes:lastNoteId";
const LS_PAGE_ORDER_KEY = "notes:pageOrder";
const LS_NOTE_ORDER_KEY_PREFIX = "notes:noteOrder:";

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

function readOrderIds(key: string): string[] {
  const raw = readLs(key);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function writeOrderIds(key: string, ids: string[]): void {
  writeLs(key, JSON.stringify(ids));
}

function applySavedOrder<T extends { id: string }>(rows: T[], key: string): T[] {
  const ids = readOrderIds(key);
  if (ids.length === 0) return rows;
  const rank = new Map<string, number>();
  ids.forEach((id, idx) => rank.set(id, idx));
  return [...rows].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return 0;
  });
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
  "note-html-view min-h-0 space-y-2 text-sm [&_figure[data-note-image='1']]:max-w-full [&_figure[data-note-image='1']]:overflow-visible [&_figure[data-note-image='1']_img]:rounded-md [&_h3]:scroll-m-20 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-tight [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5 [&_ul.note-task-list]:list-none [&_ul.note-task-list]:pl-0 [&_ul.note-task-list_li]:flex [&_ul.note-task-list_li]:items-start [&_ul.note-task-list_li]:gap-2 [&_ul.note-task-list_li]:my-0.5 [&_ul.note-task-list_.note-task-checkbox]:mt-0.5 [&_ul.note-task-list_.note-task-checkbox]:shrink-0 [&_a.note-mention]:font-medium [&_a.note-mention]:text-primary [&_a.note-mention]:underline [&_a.note-mention]:decoration-primary/60";

function renderReadNoteBody(
  content: string,
  htmlRef?: MutableRefObject<HTMLDivElement | null>,
): ReactNode {
  const t = content.trim();
  if (!t) {
    return (
      <span className="text-muted-foreground italic">Click here to write…</span>
    );
  }
  if (isProbablyHtml(content)) {
    return (
      <div
        ref={htmlRef ? (el) => { htmlRef.current = el; } : undefined}
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
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onMouseUp: () => void;
  onKeyUp: () => void;
  onBlur: (e: FocusEvent<HTMLDivElement>) => void;
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
        onClick={(e) => handlersRef.current.onClick(e)}
        onContextMenu={(e) => handlersRef.current.onContextMenu(e)}
        onPointerDown={(e) => handlersRef.current.onPointerDown(e)}
        onMouseUp={() => handlersRef.current.onMouseUp()}
        onKeyUp={() => handlersRef.current.onKeyUp()}
        onBlur={(e) => handlersRef.current.onBlur(e)}
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
  const [formatColorExpanded, setFormatColorExpanded] = useState(false);
  const [formatMenuCoords, setFormatMenuCoords] = useState<{
    bottom: number;
    right: number;
    maxH: number;
  } | null>(null);
  const [editorSession, setEditorSession] = useState(0);
  const [fmtActive, setFmtActive] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    highlight: false,
    inlineCode: false,
    unorderedList: false,
    orderedList: false,
    taskList: false,
    heading3: false,
  });
  /** Synced color well + hex field in Format panel (6-char #RRGGBB). */
  const [formatPanelColor, setFormatPanelColor] = useState("#2563eb");
  const [customFontSize, setCustomFontSize] = useState("16");
  const [newPageTitle, setNewPageTitle] = useState("");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [noteBodyFullscreen, setNoteBodyFullscreen] = useState(false);
  /** Bumps every minute so "last edited" relative labels stay fresh. */
  const [editedNowMs, setEditedNowMs] = useState(() => Date.now());
  const [allNotesForMentions, setAllNotesForMentions] = useState<Note[]>([]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionHighlightIndex, setMentionHighlightIndex] = useState(0);
  const [mentionPickerPos, setMentionPickerPos] = useState<{
    top: number;
    left: number;
    maxH: number;
  } | null>(null);
  const [dragPageId, setDragPageId] = useState<string | null>(null);
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    imageFigure: HTMLElement | null;
  }>({ open: false, x: 0, y: 0, imageFigure: null });

  const editorRef = useRef<HTMLDivElement | null>(null);
  const formatMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const formatMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const readNoteHtmlRef = useRef<HTMLDivElement | null>(null);
  const mentionPickerRef = useRef<HTMLDivElement | null>(null);
  const refreshMentionPickerRef = useRef<() => void>(() => {});
  const lastMentionQueryForHighlightRef = useRef<string>("");
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  /** Last caret/selection inside the editor — Radix controls clear the live selection. */
  const editorSelectionRef = useRef<Range | null>(null);
  /** Normalized body last written (or baseline when editor opened); skips redundant autosave UI + PUT. */
  const lastAutoSavedBodyRef = useRef<string | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const selectedNoteIdRef = useRef<string | null>(null);
  selectedNoteIdRef.current = selectedNoteId;
  const skipNextNotesFetchForPageRef = useRef(false);
  const imageDragStateRef = useRef<{
    mode: "move" | "resize";
    figure: HTMLElement;
    startX: number;
    startY: number;
    startWidth: number;
    startMarginLeft: number;
    startMarginTop: number;
  } | null>(null);
  const selectedImageFigureRef = useRef<HTMLElement | null>(null);
  const contextMenuOpenRef = useRef(false);
  const openingContextMenuRef = useRef(false);

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

  const filteredMentionNotes = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    return allNotesForMentions
      .filter((n) => n.id !== selectedNoteId)
      .filter((n) => !q || n.title.toLowerCase().includes(q))
      .slice(0, 50);
  }, [allNotesForMentions, selectedNoteId, mentionQuery]);

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
    const id = window.setInterval(() => setEditedNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!noteBodyFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [noteBodyFullscreen]);

  useEffect(() => {
    if (!token) return;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/notes", {
          headers: authHeaders,
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as Note[];
        setAllNotesForMentions(Array.isArray(data) ? data : []);
      } catch {
        // ignore
      }
    })();
    return () => ac.abort();
  }, [token, authHeaders]);

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

  const updateFormatMenuPosition = useCallback(() => {
    const btn = formatMenuButtonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setFormatMenuCoords({
      bottom: window.innerHeight - r.top + 8,
      right: window.innerWidth - r.right,
      maxH: Math.min(
        0.5 * window.innerHeight,
        Math.max(160, r.top - 16),
      ),
    });
  }, []);

  useLayoutEffect(() => {
    if (!formatMenuOpen) {
      setFormatMenuCoords(null);
      return;
    }
    updateFormatMenuPosition();
    const onResize = () => updateFormatMenuPosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [formatMenuOpen, formatColorExpanded, updateFormatMenuPosition]);

  useEffect(() => {
    if (!formatMenuOpen) setFormatColorExpanded(false);
  }, [formatMenuOpen]);

  useEffect(() => {
    if (!formatMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (formatMenuButtonRef.current?.contains(t)) return;
      if (formatMenuPanelRef.current?.contains(t)) return;
      setFormatMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [formatMenuOpen]);

  useEffect(() => {
    contextMenuOpenRef.current = contextMenu.open;
    if (!contextMenu.open) openingContextMenuRef.current = false;
  }, [contextMenu.open]);

  useEffect(() => {
    if (!contextMenu.open) return;
    const close = () => setContextMenu((s) => ({ ...s, open: false }));
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu.open]);

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

        setPages(
          applySavedOrder(
            Array.isArray(pageData) ? pageData : [],
            LS_PAGE_ORDER_KEY,
          ),
        );
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
            const list = applySavedOrder(
              Array.isArray(data) ? data : [],
              `${LS_NOTE_ORDER_KEY_PREFIX}${initialPageId}`,
            );
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
        const list = applySavedOrder(
          Array.isArray(data) ? data : [],
          `${LS_NOTE_ORDER_KEY_PREFIX}${selectedPageId}`,
        );
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
    setMentionPickerOpen(false);
    setMentionQuery("");
    lastMentionQueryForHighlightRef.current = "";
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
    setPages((prev) => {
      const next = [created, ...prev];
      writeOrderIds(LS_PAGE_ORDER_KEY, next.map((p) => p.id));
      return next;
    });
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
    writeOrderIds(LS_PAGE_ORDER_KEY, remaining.map((p) => p.id));
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
    setNotes((prev) => {
      const next = [created, ...prev];
      if (selectedPageId) {
        writeOrderIds(
          `${LS_NOTE_ORDER_KEY_PREFIX}${selectedPageId}`,
          next.map((n) => n.id),
        );
      }
      return next;
    });
    setAllNotesForMentions((prev) => [created, ...prev]);
    setSelectedNoteId(created.id);
    setNewNoteTitle("");
  };

  const updateNote = async (
    noteId: string,
    patch: Partial<Pick<Note, "title" | "content" | "favorite">>,
    opts?: { silent?: boolean },
  ): Promise<Note | false> => {
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify(patch),
    });
    if (!res.ok) return false;
    const updated = (await res.json()) as Note;
    setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
    setAllNotesForMentions((prev) =>
      prev.map((n) => (n.id === noteId ? updated : n)),
    );
    return updated;
  };

  const updateNoteRef = useRef(updateNote);
  updateNoteRef.current = updateNote;

  const stripEditorOnlyUi = useCallback((html: string) => {
    if (typeof document === "undefined") return html;
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    if (!root) return html;
    root.querySelectorAll("[data-note-ui='1']").forEach((el) => el.remove());
    return root.innerHTML;
  }, []);

  const persistNoteBody = useCallback(
    async (noteId: string, content: string, showIndicator: boolean) => {
      const normalized = normalizeNoteHtmlForSave(stripEditorOnlyUi(content));
      if (
        lastAutoSavedBodyRef.current !== null &&
        normalized === lastAutoSavedBodyRef.current
      ) {
        return true;
      }
      if (showIndicator) setAutoSaveState("saving");
      const saved = await updateNoteRef.current(
        noteId,
        { content: normalized },
        { silent: true },
      );
      if (saved) {
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
            // Keep React state in sync with normalized DOM; preserve server updatedAt from save.
            setNotes((prev) =>
              prev.map((n) =>
                n.id === noteId
                  ? { ...saved, content: normalized }
                  : n,
              ),
            );
          }
        }
      }
      if (showIndicator) {
        if (saved) {
          setAutoSaveState("saved");
          window.setTimeout(() => setAutoSaveState("idle"), 1200);
        } else {
          setAutoSaveState("idle");
        }
      }
      return !!saved;
    },
    [stripEditorOnlyUi],
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

  useEffect(() => {
    if (!isEditing) return;
    const root = editorRef.current;
    if (!root) return;
    const onCheckboxChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t?.tagName !== "INPUT" || t.type !== "checkbox") return;
      if (!root.contains(t)) return;
      root.dispatchEvent(new Event("input", { bubbles: true }));
    };
    root.addEventListener("change", onCheckboxChange);
    return () => root.removeEventListener("change", onCheckboxChange);
  }, [isEditing, selectedNoteId]);

  useEffect(() => {
    if (isEditing) return;
    const el = readNoteHtmlRef.current;
    if (!el) return;
    const onCheckboxChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t?.tagName !== "INPUT" || t.type !== "checkbox") return;
      if (!el.contains(t)) return;
      const sid = selectedNoteIdRef.current;
      if (!sid) return;
      const raw = el.innerHTML;
      const normalized = normalizeNoteHtmlForSave(raw);
      setNotes((prev) =>
        prev.map((n) => (n.id === sid ? { ...n, content: normalized } : n)),
      );
      void persistNoteBodyRef.current(sid, normalized, true);
    };
    el.addEventListener("change", onCheckboxChange);
    return () => el.removeEventListener("change", onCheckboxChange);
  }, [isEditing, selectedNoteId]);

  useEffect(() => {
    if (!isEditing) {
      setMentionPickerOpen(false);
      lastMentionQueryForHighlightRef.current = "";
      return;
    }
    const onSel = () => {
      queueMicrotask(() => refreshMentionPickerRef.current());
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [isEditing]);

  useEffect(() => {
    if (!mentionPickerOpen) return;
    setMentionHighlightIndex((i) =>
      Math.min(i, Math.max(0, filteredMentionNotes.length - 1)),
    );
  }, [filteredMentionNotes.length, mentionPickerOpen]);

  useEffect(() => {
    if (!mentionPickerOpen) return;
    const el = document.querySelector(
      `[data-mention-index="${mentionHighlightIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [mentionHighlightIndex, mentionPickerOpen]);

  useEffect(() => {
    if (!mentionPickerOpen) return;
    const onDoc = (ev: Event) => {
      const t = ev.target as Node;
      if (mentionPickerRef.current?.contains(t)) return;
      if (editorRef.current?.contains(t)) return;
      setMentionPickerOpen(false);
      lastMentionQueryForHighlightRef.current = "";
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [mentionPickerOpen]);

  const deleteNote = async (noteId: string) => {
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!res.ok) return;
    const remaining = notes.filter((n) => n.id !== noteId);
    setNotes(remaining);
    if (selectedPageId) {
      writeOrderIds(
        `${LS_NOTE_ORDER_KEY_PREFIX}${selectedPageId}`,
        remaining.map((n) => n.id),
      );
    }
    setAllNotesForMentions((prev) => prev.filter((n) => n.id !== noteId));
    if (selectedNoteId === noteId) setSelectedNoteId(remaining[0]?.id ?? null);
  };

  const reorderByDrag = <T extends { id: string }>(
    list: T[],
    fromId: string,
    toId: string,
  ) => {
    if (!fromId || !toId || fromId === toId) return list;
    const from = list.findIndex((x) => x.id === fromId);
    const to = list.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  const handlePageDrop = (targetPageId: string) => {
    if (!dragPageId || dragPageId === targetPageId) return;
    setPages((prev) => {
      const next = reorderByDrag(prev, dragPageId, targetPageId);
      writeOrderIds(LS_PAGE_ORDER_KEY, next.map((p) => p.id));
      return next;
    });
    setDragPageId(null);
  };

  const handleNoteDrop = (targetNoteId: string) => {
    if (!dragNoteId || dragNoteId === targetNoteId) return;
    setNotes((prev) => {
      const next = reorderByDrag(prev, dragNoteId, targetNoteId);
      if (selectedPageId) {
        writeOrderIds(
          `${LS_NOTE_ORDER_KEY_PREFIX}${selectedPageId}`,
          next.map((n) => n.id),
        );
      }
      return next;
    });
    setDragNoteId(null);
  };

  const beginImageInsert = () => {
    if (!isEditing) beginEditingNote();
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      imageInputRef.current?.click();
    });
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
      if (
        n instanceof HTMLElement &&
        n.tagName === "MARK" &&
        n.classList.contains(NOTE_MARK_HIGHLIGHT_CLASS)
      ) {
        return true;
      }
      n = n.parentElement;
    }
    return false;
  }, []);

  const selectionInsideInlineCode = useCallback(() => {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode)) return false;
    let n: Node | null = sel.anchorNode;
    if (n.nodeType === Node.TEXT_NODE) n = (n as Text).parentElement;
    while (n && n !== root) {
      if (n instanceof HTMLElement && n.tagName === "CODE") {
        return true;
      }
      n = n.parentElement;
    }
    return false;
  }, []);

  const selectionInsideTaskList = useCallback(() => {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode)) return false;
    let n: Node | null = sel.anchorNode;
    if (n.nodeType === Node.TEXT_NODE) n = (n as Text).parentElement;
    while (n && n !== root) {
      if (
        n instanceof HTMLElement &&
        n.tagName === "UL" &&
        n.getAttribute("data-note-task-list") === "1"
      ) {
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
        inlineCode: selectionInsideInlineCode(),
        unorderedList: document.queryCommandState("insertUnorderedList"),
        orderedList: document.queryCommandState("insertOrderedList"),
        taskList: selectionInsideTaskList(),
        heading3,
      });
    } catch {
      // ignore
    }
  }, [
    isEditing,
    selectionInEditor,
    selectionInsideHeading3,
    selectionInsideHighlight,
    selectionInsideInlineCode,
    selectionInsideTaskList,
  ]);

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

  /** execCommand toggles most inline styles; keeps selection via restoreEditorSelection. */
  const runFormatCommand = useCallback(
    (command: string, value?: string) => {
      const root = editorRef.current;
      root?.focus();
      restoreEditorSelection();
      try {
        document.execCommand("styleWithCSS", false, "true");
      } catch {
        /* ignore */
      }
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

  const insertTaskList = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    restoreEditorSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer)) return;

    const ul = document.createElement("ul");
    ul.setAttribute("data-note-task-list", "1");
    ul.className = "note-task-list";

    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.setAttribute("contenteditable", "false");
    cb.className = "note-task-checkbox";

    const span = document.createElement("span");
    span.appendChild(document.createTextNode("\u200b"));

    li.appendChild(cb);
    li.appendChild(span);
    ul.appendChild(li);

    r.deleteContents();
    r.insertNode(ul);
    r.setStart(span, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    root.dispatchEvent(new Event("input", { bubbles: true }));
    refreshFmt();
  }, [refreshFmt, restoreEditorSelection]);

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

  const toggleHighlightColor = useCallback(() => {
    const root = editorRef.current;
    root?.focus();
    if (!restoreEditorSelection()) return;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer)) return;

    const marks = collectMarksIntersectingRange(
      root,
      r,
      NOTE_MARK_HIGHLIGHT_CLASS,
    );
    if (marks.length > 0) {
      for (const m of marks) {
        unwrapElement(m);
      }
      root.dispatchEvent(new Event("input", { bubbles: true }));
      refreshFmt();
      return;
    }

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

  const toggleInlineCode = useCallback(() => {
    const root = editorRef.current;
    root?.focus();
    if (!restoreEditorSelection()) return;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer)) return;

    const codes = collectCodesIntersectingRange(root, r);
    if (codes.length > 0) {
      for (const c of codes) {
        unwrapElement(c);
      }
      root.dispatchEvent(new Event("input", { bubbles: true }));
      refreshFmt();
      return;
    }

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

  const ensureImageFigureUi = useCallback((figure: HTMLElement) => {
    figure.setAttribute("data-note-image", "1");
    figure.style.display = "block";
    figure.style.position = "relative";
    if (!figure.style.maxWidth) figure.style.maxWidth = "100%";
    if (!figure.style.width) figure.style.width = "420px";
    if (!figure.style.marginTop) figure.style.marginTop = "8px";
    if (!figure.style.marginBottom) figure.style.marginBottom = "8px";
    if (!figure.style.marginLeft) figure.style.marginLeft = "0px";
    if (!figure.style.marginRight) figure.style.marginRight = "0px";

    const img = figure.querySelector("img");
    if (img) {
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.maxWidth = "100%";
      img.style.display = "block";
      if (!img.getAttribute("loading")) img.setAttribute("loading", "lazy");
    }

    let handle = figure.querySelector(
      "[data-note-ui='1'][data-resize-handle='1']",
    ) as HTMLElement | null;
    if (!handle) {
      handle = document.createElement("span");
      handle.setAttribute("data-note-ui", "1");
      handle.setAttribute("data-resize-handle", "1");
      handle.title = "Drag to resize";
      handle.style.position = "absolute";
      handle.style.right = "-5px";
      handle.style.bottom = "-5px";
      handle.style.width = "12px";
      handle.style.height = "12px";
      handle.style.borderRadius = "999px";
      handle.style.background = "rgb(99 102 241)";
      handle.style.border = "1px solid white";
      handle.style.cursor = "nwse-resize";
      handle.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.15)";
      figure.appendChild(handle);
    }
  }, []);

  const hydrateEditorImageFigures = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    root.querySelectorAll("figure[data-note-image='1']").forEach((el) => {
      if (el instanceof HTMLElement) ensureImageFigureUi(el);
    });
  }, [ensureImageFigureUi]);

  useEffect(() => {
    if (!isEditing) return;
    const id = window.setTimeout(() => {
      hydrateEditorImageFigures();
    }, 0);
    return () => window.clearTimeout(id);
  }, [isEditing, editorSession, selectedNoteId, hydrateEditorImageFigures]);

  const getEditorAuthToken = useCallback(async () => {
    if (token) return token;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, [token]);

  const insertImageIntoEditor = useCallback(
    (imageUrl: string) => {
      const root = editorRef.current;
      if (!root) return;
      root.focus();
      restoreEditorSelection();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (!root.contains(r.commonAncestorContainer)) return;

      const figure = document.createElement("figure");
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "Note image";
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.maxWidth = "100%";
      img.style.display = "block";
      img.setAttribute("loading", "lazy");
      ensureImageFigureUi(figure);
      figure.appendChild(img);
      r.deleteContents();
      r.insertNode(figure);
      r.setStartAfter(figure);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      root.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [ensureImageFigureUi, restoreEditorSelection],
  );

  const uploadImageFile = useCallback(
    async (file: File) => {
      const bearer = await getEditorAuthToken();
      if (!bearer) return;
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/notes/images", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}` },
        body: fd,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { url?: string };
      if (data.url) insertImageIntoEditor(data.url);
    },
    [getEditorAuthToken, insertImageIntoEditor],
  );

  const refreshMentionPicker = useCallback(() => {
    if (!isEditing) {
      setMentionPickerOpen(false);
      lastMentionQueryForHighlightRef.current = "";
      return;
    }
    const root = editorRef.current;
    if (!root) {
      setMentionPickerOpen(false);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setMentionPickerOpen(false);
      return;
    }
    const caret = sel.getRangeAt(0);
    const ctx = getMentionContext(root, caret);
    if (!ctx) {
      setMentionPickerOpen(false);
      lastMentionQueryForHighlightRef.current = "";
      return;
    }
    if (ctx.query !== lastMentionQueryForHighlightRef.current) {
      lastMentionQueryForHighlightRef.current = ctx.query;
      setMentionHighlightIndex(0);
    }
    setMentionQuery(ctx.query);
    setMentionPickerOpen(true);
    const rect = ctx.caretRect;
    const margin = 8;
    const maxH = Math.min(
      260,
      Math.max(120, window.innerHeight - rect.bottom - margin * 2),
    );
    let top = rect.bottom + 4;
    if (top + maxH > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - 4 - maxH);
    }
    let left = Math.min(rect.left, window.innerWidth - 288 - margin);
    left = Math.max(margin, left);
    setMentionPickerPos({ top, left, maxH });
  }, [isEditing]);

  refreshMentionPickerRef.current = refreshMentionPicker;

  /** Uses refs so it stays valid when NoteBodyEditor is memoized and skips re-renders. */
  const syncEditorToState = useCallback(() => {
    const id = selectedNoteIdRef.current;
    if (!id) return;
    const html = stripEditorOnlyUi(editorRef.current?.innerHTML ?? "");
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, content: html } : n)),
    );
    queueMicrotask(() => refreshMentionPickerRef.current());
  }, [stripEditorOnlyUi]);

  const handleEditorBlur = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as Node | null;
    if (related && formatMenuPanelRef.current?.contains(related)) return;
    if (related && formatMenuButtonRef.current?.contains(related)) return;
    if (related && mentionPickerRef.current?.contains(related)) return;
    if (contextMenuOpenRef.current) return;
    if (openingContextMenuRef.current) return;

    void (async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (formatMenuPanelRef.current?.contains(document.activeElement))
        return;
      if (formatMenuButtonRef.current?.contains(document.activeElement))
        return;
      if (contextMenuOpenRef.current) return;
      if (openingContextMenuRef.current) return;

      const raw = editorRef.current?.innerHTML ?? "";
      const normalized = normalizeNoteHtmlForSave(stripEditorOnlyUi(raw));
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

  /** Cmd/Ctrl+\ — paste clipboard as plain text (no rich formatting). */
  const pastePlainFromClipboard = useCallback(async () => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    if (!restoreEditorSelection()) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    if (!text) return;
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
    refreshFmt();
  }, [refreshFmt, restoreEditorSelection]);

  const pasteImageFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const file = new File([blob], `pasted-${Date.now()}.${imageType.split("/")[1] ?? "png"}`, {
          type: imageType,
        });
        await uploadImageFile(file);
        return;
      }
    } catch {
      // ignore clipboard permission / support issues
    }
  }, [uploadImageFile]);

  const insertNoteMentionFromPicker = useCallback(
    (noteId: string) => {
      if (!noteId) return;
      const root = editorRef.current;
      if (!root) return;
      const target = allNotesForMentions.find((n) => n.id === noteId);
      if (!target) return;
      root.focus();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const caret = sel.getRangeAt(0);
      const ctx = getMentionContext(root, caret);
      if (!ctx) return;
      const r = ctx.replaceRange.cloneRange();
      r.deleteContents();
      const a = document.createElement("a");
      a.href = `#note-${target.id}`;
      a.setAttribute("data-note-id", target.id);
      a.setAttribute("rel", "noopener noreferrer");
      a.className = "note-mention";
      a.textContent = `@${target.title}`;
      r.insertNode(a);
      const space = document.createTextNode(" ");
      a.after(space);
      r.setStart(space, 1);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      lastMentionQueryForHighlightRef.current = "";
      setMentionPickerOpen(false);
      setMentionQuery("");
      root.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [allNotesForMentions],
  );

  const insertNoteMentionFromPickerRef = useRef(insertNoteMentionFromPicker);
  insertNoteMentionFromPickerRef.current = insertNoteMentionFromPicker;

  const mentionPickerOpenRef = useRef(false);
  const filteredMentionNotesRef = useRef(filteredMentionNotes);
  const mentionHighlightIndexRef = useRef(mentionHighlightIndex);
  mentionPickerOpenRef.current = mentionPickerOpen;
  filteredMentionNotesRef.current = filteredMentionNotes;
  mentionHighlightIndexRef.current = mentionHighlightIndex;

  const jumpToMentionedNote = useCallback(
    (noteId: string) => {
      const target = allNotesForMentions.find((n) => n.id === noteId);
      if (!target) return;
      setMentionPickerOpen(false);
      lastMentionQueryForHighlightRef.current = "";
      setSelectedPageId(target.pageId);
      setSelectedNoteId(target.id);
      setIsEditing(false);
      setFormatMenuOpen(false);
      setContextMenu((s) => ({ ...s, open: false }));
    },
    [allNotesForMentions],
  );

  const removeSelectedImage = useCallback(() => {
    const root = editorRef.current;
    const figure = selectedImageFigureRef.current;
    if (!root || !figure || !root.contains(figure)) return;
    figure.remove();
    selectedImageFigureRef.current = null;
    root.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);

  const handleEditorKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (mentionPickerOpenRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          setMentionPickerOpen(false);
          lastMentionQueryForHighlightRef.current = "";
          return;
        }
        const list = filteredMentionNotesRef.current;
        const hi = mentionHighlightIndexRef.current;
        if (list.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setMentionHighlightIndex((i) => (i + 1) % list.length);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setMentionHighlightIndex(
              (i) => (i - 1 + list.length) % list.length,
            );
            return;
          }
          if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
            e.preventDefault();
            const n = list[hi];
            if (n) insertNoteMentionFromPickerRef.current(n.id);
            return;
          }
        }
      }

      if (e.key === "Enter" && e.shiftKey) {
        const root = editorRef.current;
        if (!root) return;
        root.focus();
        restoreEditorSelection();
        e.preventDefault();
        try {
          // Make Shift+Enter behave like regular Enter (new list item in lists).
          document.execCommand("insertParagraph");
        } catch {
          // ignore
        }
        root.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedImageFigureRef.current
      ) {
        e.preventDefault();
        removeSelectedImage();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "\\") {
        e.preventDefault();
        void pastePlainFromClipboard();
        return;
      }
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "b" || k === "i" || k === "u") {
        e.preventDefault();
        if (k === "b") runFormatCommand("bold");
        else if (k === "i") runFormatCommand("italic");
        else runFormatCommand("underline");
      }
    },
    [
      removeSelectedImage,
      restoreEditorSelection,
      runFormatCommand,
      pastePlainFromClipboard,
    ],
  );

  const handleEditorPaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const imageItem = [...e.clipboardData.items].find((it) =>
        it.type.startsWith("image/"),
      );
      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (file) void uploadImageFile(file);
        return;
      }
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
    [uploadImageFile],
  );

  const removeSelectedFormatting = useCallback(() => {
    runFormatCommand("removeFormat");
  }, [runFormatCommand]);

  const handleEditorContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      openingContextMenuRef.current = true;
      contextMenuOpenRef.current = true;
      const target = e.target as HTMLElement;
      const figure = target.closest("figure[data-note-image='1']");
      setContextMenu({
        open: true,
        x: e.clientX,
        y: e.clientY,
        imageFigure: figure instanceof HTMLElement ? figure : null,
      });
      if (figure instanceof HTMLElement) {
        selectedImageFigureRef.current = figure;
      }
    },
    [],
  );

  const openContextMenuFromReadBody = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      openingContextMenuRef.current = true;
      contextMenuOpenRef.current = true;
      beginEditingNote();
      const x = e.clientX;
      const y = e.clientY;
      requestAnimationFrame(() => {
        editorRef.current?.focus();
        setContextMenu({
          open: true,
          x,
          y,
          imageFigure: null,
        });
      });
    },
    [beginEditingNote],
  );

  const handleEditorPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const root = editorRef.current;
      if (!root) return;
      const target = e.target as HTMLElement;
      const handle = target.closest("[data-resize-handle='1']");
      const figure = target.closest("figure[data-note-image='1']");
      if (!(figure instanceof HTMLElement)) return;
      selectedImageFigureRef.current = figure;

      if (handle) {
        e.preventDefault();
        const width = Math.max(120, figure.getBoundingClientRect().width);
        imageDragStateRef.current = {
          mode: "resize",
          figure,
          startX: e.clientX,
          startY: e.clientY,
          startWidth: width,
          startMarginLeft: parseFloat(figure.style.marginLeft || "0") || 0,
          startMarginTop: parseFloat(figure.style.marginTop || "8") || 8,
        };
      } else if (target.tagName === "IMG" || target.closest("img")) {
        e.preventDefault();
        imageDragStateRef.current = {
          mode: "move",
          figure,
          startX: e.clientX,
          startY: e.clientY,
          startWidth: Math.max(120, figure.getBoundingClientRect().width),
          startMarginLeft: parseFloat(figure.style.marginLeft || "0") || 0,
          startMarginTop: parseFloat(figure.style.marginTop || "8") || 8,
        };
      } else {
        return;
      }

      const onMove = (ev: globalThis.PointerEvent) => {
        const s = imageDragStateRef.current;
        if (!s) return;
        if (s.mode === "resize") {
          const next = Math.max(120, Math.min(980, s.startWidth + (ev.clientX - s.startX)));
          s.figure.style.width = `${next}px`;
          s.figure.style.maxWidth = "100%";
        } else {
          const dx = ev.clientX - s.startX;
          const dy = ev.clientY - s.startY;
          s.figure.style.marginLeft = `${Math.max(-200, Math.min(400, s.startMarginLeft + dx))}px`;
          s.figure.style.marginTop = `${Math.max(0, Math.min(200, s.startMarginTop + dy))}px`;
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        imageDragStateRef.current = null;
        root.dispatchEvent(new Event("input", { bubbles: true }));
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [],
  );

  const handleEditorClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a[data-note-id]");
      if (!(link instanceof HTMLAnchorElement)) return;
      e.preventDefault();
      const noteId = link.getAttribute("data-note-id");
      if (noteId) jumpToMentionedNote(noteId);
    },
    [jumpToMentionedNote],
  );

  const editorHandlersRef = useRef<NoteEditorHandlers>({
    onInput: () => {},
    onPaste: () => {},
    onKeyDown: () => {},
    onClick: () => {},
    onContextMenu: () => {},
    onPointerDown: () => {},
    onMouseUp: () => {},
    onKeyUp: () => {},
    onBlur: () => {},
  });
  editorHandlersRef.current = {
    onInput: syncEditorToState,
    onPaste: handleEditorPaste,
    onKeyDown: handleEditorKeyDown,
    onClick: handleEditorClick,
    onContextMenu: handleEditorContextMenu,
    onPointerDown: handleEditorPointerDown,
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
                  draggable
                  onDragStart={(e) => {
                    setDragPageId(p.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", p.id);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handlePageDrop(p.id)}
                  onDragEnd={() => setDragPageId(null)}
                  className={cn(
                    "flex cursor-default items-center gap-1 rounded-lg border px-1.5 py-1",
                    selectedPageId === p.id &&
                      "border-indigo-500 bg-indigo-500/10",
                    dragPageId === p.id && "opacity-60",
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
                  draggable
                  onDragStart={(e) => {
                    setDragNoteId(n.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", n.id);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleNoteDrop(n.id)}
                  onDragEnd={() => setDragNoteId(null)}
                  className={cn(
                    "flex cursor-default items-center gap-1 rounded-lg border px-1.5 py-1",
                    selectedNoteId === n.id &&
                      "border-violet-500 bg-violet-500/10",
                    dragNoteId === n.id && "opacity-60",
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
                        <span className="block truncate">{n.title}</span>
                        {n.updatedAt ? (
                          <span
                            className="block truncate text-[10px] text-muted-foreground tabular-nums"
                            title={new Date(n.updatedAt).toLocaleString()}
                          >
                            {formatNoteEditedRelative(n.updatedAt, editedNowMs)}
                          </span>
                        ) : null}
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

          <section className="flex min-h-0 min-w-0 cursor-default flex-col overflow-visible rounded-xl border bg-card p-4 lg:max-h-[calc(100vh-7rem)]">
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
                {selectedNote.updatedAt ? (
                  <div className="flex min-w-0 items-center gap-1.5 pl-6 text-[11px] text-muted-foreground tabular-nums">
                    <Clock className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
                    <span
                      title={`Last edited ${new Date(selectedNote.updatedAt).toLocaleString()}`}
                    >
                      Last edited{" "}
                      {formatNoteEditedRelative(
                        selectedNote.updatedAt,
                        editedNowMs,
                      )}
                    </span>
                  </div>
                ) : null}
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
                          <>
                            <div className="relative">
                              <Button
                                ref={formatMenuButtonRef}
                                type="button"
                                size="sm"
                                variant="outline"
                                className={cn(
                                  "h-7 gap-1 px-2 text-xs",
                                  formatMenuOpen &&
                                    "border-primary ring-1 ring-primary/30",
                                )}
                                title={
                                  typeof navigator !== "undefined" &&
                                  /Mac|iPhone|iPad/i.test(navigator.platform)
                                    ? "Formatting (opens above). Shortcuts: ⌘B, ⌘I, ⌘U"
                                    : "Formatting (opens above). Shortcuts: Ctrl+B, Ctrl+I, Ctrl+U"
                                }
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
                            </div>
                            {typeof document !== "undefined" &&
                              formatMenuOpen &&
                              formatMenuCoords &&
                              createPortal(
                                <div
                                  ref={formatMenuPanelRef}
                                  className="z-[150] flex w-[min(17rem,calc(100vw-1rem))] flex-col overflow-y-auto overflow-x-hidden rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
                                  style={{
                                    position: "fixed",
                                    bottom: formatMenuCoords.bottom,
                                    right: formatMenuCoords.right,
                                    maxHeight: formatMenuCoords.maxH,
                                  }}
                                  onMouseDown={(e) => {
                                    if (
                                      (e.target as HTMLElement).closest(
                                        "input, textarea, select, label, button",
                                      )
                                    ) {
                                      return;
                                    }
                                    e.preventDefault();
                                  }}
                                >
                                  <div className="flex flex-wrap gap-0.5">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className={cn(
                                        "h-7 w-7 shrink-0 px-0 text-[11px]",
                                        fmtActive.bold &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip("Bold", {
                                        key: "B",
                                      })}
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
                                        "h-7 w-7 shrink-0 px-0 text-[11px] italic",
                                        fmtActive.italic &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip("Italic", {
                                        key: "I",
                                      })}
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
                                        "h-7 w-7 shrink-0 px-0 text-[11px] underline",
                                        fmtActive.underline &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip(
                                        "Underline",
                                        { key: "U" },
                                      )}
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
                                        "h-7 w-7 shrink-0 px-0 text-[11px] line-through",
                                        fmtActive.strikeThrough &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip(
                                        "Strikethrough",
                                      )}
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
                                        "h-7 w-7 shrink-0 px-0",
                                        fmtActive.highlight &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip(
                                        "Highlight",
                                      )}
                                      onClick={toggleHighlightColor}
                                    >
                                      <Highlighter
                                        className={cn(
                                          "h-3 w-3",
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
                                        "h-7 w-7 shrink-0 px-0 text-sm",
                                        fmtActive.unorderedList &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip(
                                        "Bullet list",
                                      )}
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
                                        "h-7 min-w-7 shrink-0 px-0.5 text-[10px]",
                                        fmtActive.orderedList &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip(
                                        "Numbered list",
                                      )}
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
                                        "h-7 w-7 shrink-0 px-0",
                                        fmtActive.taskList &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip(
                                        "Checkbox list",
                                      )}
                                      onClick={insertTaskList}
                                    >
                                      <ListChecks className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className={cn(
                                        "h-7 px-1.5 text-[10px]",
                                        fmtActive.heading3 &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip("Heading")}
                                      onClick={toggleHeadingBlock}
                                    >
                                      H3
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className={cn(
                                        "h-7 min-w-7 shrink-0 px-0 font-mono text-[10px]",
                                        fmtActive.inlineCode &&
                                          "border-primary bg-primary/10",
                                      )}
                                      title={formatShortcutTooltip(
                                        "Inline code",
                                      )}
                                      onClick={toggleInlineCode}
                                    >
                                      &lt;/&gt;
                                    </Button>
                                  </div>
                                  <div className="mt-1.5 border-t border-border/60 pt-1.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-full justify-between gap-2 px-2 text-xs font-normal"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() =>
                                        setFormatColorExpanded((v) => !v)
                                      }
                                    >
                                      <span className="flex min-w-0 items-center gap-1.5">
                                        <Palette className="h-3.5 w-3.5 shrink-0" />
                                        <span className="truncate">
                                          Text color / picker
                                        </span>
                                      </span>
                                      <ChevronDown
                                        className={cn(
                                          "h-3.5 w-3.5 shrink-0 transition-transform",
                                          formatColorExpanded && "rotate-180",
                                        )}
                                      />
                                    </Button>
                                    {formatColorExpanded && (
                                      <div className="mt-1.5 pr-0.5">
                                        <NoteColorPicker
                                          value={formatPanelColor}
                                          onChange={applyForeColor}
                                          className="max-w-full space-y-2 [&_div.h-36]:h-28 [&_div.h-36]:min-h-[7rem]"
                                        />
                                      </div>
                                    )}
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap items-end gap-1 border-t border-border/60 pt-1.5">
                                    <Label
                                      htmlFor="note-custom-font-size"
                                      className="sr-only"
                                    >
                                      Font size (px)
                                    </Label>
                                    <Input
                                      id="note-custom-font-size"
                                      type="number"
                                      min={1}
                                      max={100}
                                      className="h-7 w-16 text-xs"
                                      value={customFontSize}
                                      onChange={(e) =>
                                        setCustomFontSize(e.target.value)
                                      }
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key !== "Enter") return;
                                        e.preventDefault();
                                        const n = Number(customFontSize);
                                        if (!Number.isFinite(n)) return;
                                        queueMicrotask(() => {
                                          editorRef.current?.focus();
                                          applyFontSizePx(n);
                                        });
                                      }}
                                      title="Font size (px)"
                                    />
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      className="h-7 shrink-0 px-2 text-xs"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => {
                                        const n = Number(customFontSize);
                                        if (!Number.isFinite(n)) return;
                                        queueMicrotask(() => {
                                          editorRef.current?.focus();
                                          applyFontSizePx(n);
                                        });
                                      }}
                                      title="Apply font size"
                                    >
                                      Size
                                    </Button>
                                  </div>
                                </div>,
                                document.body,
                              )}
                          </>
                        )}
                        {isEditing && (
                          <>
                            <input
                              ref={imageInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void uploadImageFile(f);
                                e.currentTarget.value = "";
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-xs"
                              title="Insert image"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={beginImageInsert}
                            >
                              <ImagePlus className="h-3.5 w-3.5" />
                              Image
                            </Button>
                            <span
                              className="hidden sm:inline text-[10px] text-muted-foreground"
                              title="Type @ in the note to link another note"
                            >
                              @ mention
                            </span>
                          </>
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
                        "note-html-scroll w-full min-w-0 max-w-full flex-1 cursor-text overflow-x-hidden overflow-y-auto rounded-lg bg-background px-3 py-2 text-sm text-foreground outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring",
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
                        const tgt = e.target as HTMLElement;
                        if (
                          tgt.tagName === "INPUT" &&
                          (tgt as HTMLInputElement).type === "checkbox"
                        ) {
                          e.stopPropagation();
                          return;
                        }
                        const link = (e.target as HTMLElement).closest(
                          "a[data-note-id]",
                        ) as HTMLAnchorElement | null;
                        if (link) {
                          e.preventDefault();
                          const noteId = link.getAttribute("data-note-id");
                          if (noteId) jumpToMentionedNote(noteId);
                          return;
                        }
                        if ((e.target as HTMLElement).closest("a")) return;
                        beginEditingNote();
                        requestAnimationFrame(() =>
                          editorRef.current?.focus(),
                        );
                      }}
                      onContextMenu={openContextMenuFromReadBody}
                      className={cn(
                        "note-html-scroll w-full min-w-0 max-w-full flex-1 cursor-pointer select-text overflow-x-hidden overflow-y-auto rounded-lg bg-background px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere]",
                        noteBodyFullscreen
                          ? "min-h-0 flex-1 max-h-none sm:min-h-0"
                          : "min-h-[200px] max-h-[min(65vh,520px)] sm:min-h-[240px] sm:max-h-[min(70vh,560px)]",
                      )}
                      aria-live="polite"
                    >
                      {renderReadNoteBody(
                        selectedNote.content,
                        readNoteHtmlRef,
                      )}
                    </div>
                  )}
                  {isEditing && contextMenu.open && (
                    <div
                      className="fixed z-[120] w-44 rounded-md border border-border bg-popover p-1 shadow-lg"
                      style={{ left: contextMenu.x, top: contextMenu.y }}
                      role="menu"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runFormatCommand("bold");
                        }}
                      >
                        <Bold className="h-3.5 w-3.5" />
                        Bold
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runFormatCommand("italic");
                        }}
                      >
                        <Italic className="h-3.5 w-3.5" />
                        Italic
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runFormatCommand("underline");
                        }}
                      >
                        <UnderlineIcon className="h-3.5 w-3.5" />
                        Underline
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runFormatCommand("strikeThrough");
                        }}
                      >
                        <Strikethrough className="h-3.5 w-3.5" />
                        Strikethrough
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          void pastePlainFromClipboard();
                        }}
                      >
                        <ClipboardPaste className="h-3.5 w-3.5" />
                        Paste as plain text
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          removeSelectedFormatting();
                        }}
                      >
                        <Eraser className="h-3.5 w-3.5" />
                        Remove formatting
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          beginImageInsert();
                        }}
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        Insert image from files
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          void pasteImageFromClipboard();
                        }}
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        Paste image from clipboard
                      </button>
                      {contextMenu.imageFigure && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-muted"
                          onClick={() => {
                            selectedImageFigureRef.current = contextMenu.imageFigure;
                            setContextMenu((s) => ({ ...s, open: false }));
                            removeSelectedImage();
                          }}
                        >
                          Delete image
                        </button>
                      )}
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
      {typeof document !== "undefined" &&
        mentionPickerOpen &&
        mentionPickerPos &&
        isEditing &&
        createPortal(
          <div
            ref={mentionPickerRef}
            role="listbox"
            aria-label="Link to note"
            className="fixed z-[200] w-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
            style={{
              top: mentionPickerPos.top,
              left: mentionPickerPos.left,
              maxHeight: mentionPickerPos.maxH,
            }}
          >
            <ul className="max-h-[inherit] overflow-y-auto p-1">
              {filteredMentionNotes.length === 0 ? (
                <li className="px-2 py-2 text-xs text-muted-foreground">
                  No matching notes
                </li>
              ) : (
                filteredMentionNotes.map((n, i) => (
                  <li key={n.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      data-mention-index={i}
                      aria-selected={i === mentionHighlightIndex}
                      className={cn(
                        "flex w-full rounded px-2 py-1.5 text-left text-xs transition-colors",
                        i === mentionHighlightIndex
                          ? "bg-muted"
                          : "hover:bg-muted/60",
                      )}
                      onMouseEnter={() => setMentionHighlightIndex(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertNoteMentionFromPicker(n.id);
                      }}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {n.title}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
