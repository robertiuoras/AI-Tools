"use client";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useAuthSession } from "@/components/AuthSessionProvider";
import {
  clearNotesBootstrapFromSession,
  readNotesBootstrapFromSession,
  writeNotesBootstrapToSession,
} from "@/lib/notes-client-cache";
import { type Note, type NotePage } from "@/lib/supabase";
import {
  noteKbParen,
  noteKbPastePlainParen,
  noteKbRedoParen,
  noteKbHighlightParen,
  noteKbFindInNoteParen,
} from "@/lib/note-kb";
import {
  findTextInRoot,
  clearFindHighlights,
  applyFindMatchHighlight,
} from "@/lib/note-find";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RemindersPanel } from "@/components/RemindersPanel";
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
  Undo2,
  Redo2,
  Search,
  ArrowDown,
  ArrowUp,
  Crop,
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
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { NotesPageLoader, NotesOverlayLoader } from "@/components/NotesLoader";
import { useToast } from "@/components/ui/toaster";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function parseInsetClipFromImg(img: HTMLImageElement): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const style = img.style.clipPath || "";
  const m = style.match(
    /inset\(\s*([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s*\)/i,
  );
  if (!m) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: Number(m[1]),
    right: Number(m[2]),
    bottom: Number(m[3]),
    left: Number(m[4]),
  };
}

function getFigureRotateDeg(figure: HTMLElement): number {
  const t = figure.style.transform || "";
  const m = t.match(/rotate\(\s*(-?\d+(?:\.\d+)?)\s*deg\s*\)/i);
  return m ? Number(m[1]) : 0;
}

function unwrapAngleDelta(a: number): number {
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Strip editor-only UI from a figure clone for clipboard HTML. */
function getFigureHtmlForClipboard(figure: HTMLElement): string {
  const clone = figure.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-note-ui='1']").forEach((el) => el.remove());
  clone.removeAttribute("data-note-image-selected");
  clone.removeAttribute("data-note-handle-v");
  return clone.outerHTML;
}

/** Parse a note image figure from rich clipboard HTML (fragment or full document). */
function parseFigureFromClipboardHtml(html: string): HTMLElement | null {
  if (!html?.trim()) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let fig = doc.querySelector("figure[data-note-image='1']");
  if (fig) return fig.cloneNode(true) as HTMLElement;
  const doc2 = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  fig = doc2.querySelector("figure[data-note-image='1']");
  return fig ? (fig.cloneNode(true) as HTMLElement) : null;
}

/** Move a note image figure among block siblings using Y position (not elementsFromPoint — gaps/margins won't send the figure to the bottom). */
function reorderFigureInEditorByPoint(
  figure: HTMLElement,
  editor: HTMLElement,
  clientY: number,
  sticky: { el: Element; before: boolean } | null,
): { el: Element; before: boolean } | null {
  const siblings = [...editor.children].filter((el) => el !== figure);
  if (siblings.length === 0) {
    if (editor.lastElementChild !== figure) editor.appendChild(figure);
    return null;
  }

  let insertBefore: Element | null = null;
  let nextSticky: { el: Element; before: boolean } | null = null;

  for (const el of siblings) {
    const tr = el.getBoundingClientRect();
    const mid = tr.top + tr.height / 2;
    const band = Math.max(22, tr.height * 0.32);
    let before: boolean;
    if (!sticky || sticky.el !== el) {
      before = clientY < mid;
    } else {
      if (clientY < mid - band) before = true;
      else if (clientY > mid + band) before = false;
      else before = sticky.before;
    }
    nextSticky = { el, before };
    if (before) {
      insertBefore = el;
      break;
    }
  }

  if (!nextSticky) return null;

  if (insertBefore) {
    if (figure.nextSibling === insertBefore) return nextSticky;
    editor.insertBefore(figure, insertBefore);
  } else {
    if (editor.lastElementChild === figure) return nextSticky;
    editor.appendChild(figure);
  }
  return nextSticky;
}

/** Insert empty <p><br></p> before first figure, between adjacent figures, and after last figure so caret can land above/below images. */
function ensureParagraphGapsAroundImages(editor: HTMLElement): void {
  const scrollTop = editor.scrollTop;
  const figs = [
    ...editor.querySelectorAll("figure[data-note-image='1']"),
  ] as HTMLElement[];
  for (const fig of figs) {
    const prev = fig.previousSibling;
    const prevIsFig =
      prev instanceof HTMLElement &&
      prev.matches("figure[data-note-image='1']");
    if (!prev || prevIsFig) {
      const p = document.createElement("p");
      p.className = "note-editor-gap-p";
      p.appendChild(document.createElement("br"));
      editor.insertBefore(p, fig);
    }
  }
  const last = editor.lastChild;
  if (
    last instanceof HTMLElement &&
    last.matches("figure[data-note-image='1']")
  ) {
    const p = document.createElement("p");
    p.className = "note-editor-gap-p";
    p.appendChild(document.createElement("br"));
    editor.appendChild(p);
  }
  editor.scrollTop = scrollTop;
}

/** Enter / Shift+Enter inside a task list: new checkbox line (split at caret when needed). */
function tryHandleTaskListEnter(root: HTMLElement, e: KeyboardEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const tgt = e.target as EventTarget | null;
  if (tgt instanceof HTMLInputElement && tgt.type === "checkbox") return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const r0 = sel.getRangeAt(0);
  if (!root.contains(r0.commonAncestorContainer)) return false;

  let el: Node | null =
    sel.anchorNode?.nodeType === Node.TEXT_NODE
      ? sel.anchorNode.parentNode
      : sel.anchorNode;
  let liEl: HTMLLIElement | null = null;
  let ulEl: HTMLUListElement | null = null;
  while (el && el !== root) {
    if (el instanceof HTMLLIElement) {
      const ul = el.parentElement;
      if (
        ul instanceof HTMLUListElement &&
        ul.getAttribute("data-note-task-list") === "1"
      ) {
        liEl = el;
        ulEl = ul;
        break;
      }
    }
    el = el.parentElement;
  }
  if (!liEl || !ulEl) return false;
  const lineSpan = liEl.querySelector("span.note-task-line");
  if (!(lineSpan instanceof HTMLSpanElement)) return false;

  let r = sel.getRangeAt(0);
  if (!r.collapsed) {
    r.deleteContents();
    r = sel.getRangeAt(0);
  }
  if (!lineSpan.contains(r.commonAncestorContainer)) return false;

  e.preventDefault();

  const tailRange = document.createRange();
  tailRange.setStart(r.startContainer, r.startOffset);
  if (lineSpan.lastChild) {
    tailRange.setEndAfter(lineSpan.lastChild);
  } else {
    tailRange.setEnd(lineSpan, 0);
  }

  const newLi = document.createElement("li");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.setAttribute("contenteditable", "false");
  cb.className = "note-task-checkbox";
  const newSpan = document.createElement("span");
  newSpan.className = "note-task-line";

  if (tailRange.collapsed) {
    newSpan.appendChild(document.createTextNode("\u200b"));
  } else {
    const frag = tailRange.extractContents();
    if (frag.childNodes.length) {
      newSpan.appendChild(frag);
    } else {
      newSpan.appendChild(document.createTextNode("\u200b"));
    }
  }

  const lineHasContent =
    !!lineSpan.textContent?.replace(/\u200b/g, "").trim() ||
    lineSpan.querySelector("strong,b,i,em,u,code,mark,a") !== null;
  if (!lineHasContent && lineSpan.childNodes.length === 0) {
    lineSpan.appendChild(document.createTextNode("\u200b"));
  }

  newLi.appendChild(cb);
  newLi.appendChild(newSpan);
  ulEl.insertBefore(newLi, liEl.nextSibling);

  const nr = document.createRange();
  const nc = newSpan.firstChild;
  if (nc && nc.nodeType === Node.TEXT_NODE) {
    nr.setStart(nc, 0);
  } else {
    nr.setStart(newSpan, 0);
  }
  nr.collapse(true);
  sel.removeAllRanges();
  sel.addRange(nr);
  root.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

const INLINE_TOKEN_RE =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|==([^=\n]+)==|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\{\{c#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\}\}([\s\S]*?)\{\{\/c\}\}|\{\{s(\d{1,3})\}\}([\s\S]*?)\{\{\/s\}\}/g;
const BULLET_LINE_RE = /^(\s*)([-*•])\s+/;
const NUMBERED_LINE_RE = /^(\s*)\d+\.\s+/;

/** Styled via globals.css `.note-html-view mark.note-highlight` */
const NOTE_MARK_HIGHLIGHT_CLASS = "note-highlight";

/** Relative time for note `updatedAt` (ISO); `nowMs` bumps each minute. */
function formatNoteEditedRelative(
  iso: string | undefined,
  nowMs: number,
): string {
  if (!iso) return "";
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return "";
  const secAgo = Math.floor((nowMs - d) / 1000);
  if (secAgo < 0) return "just now";
  if (secAgo < 15) return "just now";
  if (secAgo < 60) return "moments ago";
  const minAgo = Math.floor(secAgo / 60);
  if (minAgo < 60)
    return minAgo === 1 ? "about 1 minute ago" : `about ${minAgo} minutes ago`;
  const hrAgo = Math.floor(minAgo / 60);
  if (hrAgo < 36)
    return hrAgo === 1 ? "about 1 hour ago" : `about ${hrAgo} hours ago`;
  const dayAgo = Math.floor(hrAgo / 24);
  if (dayAgo < 14)
    return dayAgo === 1 ? "about 1 day ago" : `about ${dayAgo} days ago`;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: d < nowMs - 365 * 24 * 60 * 60 * 1000 ? "numeric" : undefined,
    }).format(d);
  } catch {
    return new Date(d).toLocaleDateString();
  }
}

function formatShortcutTooltip(
  label: string,
  opts?: { key?: string; extra?: string },
): string {
  if (opts?.extra) return `${label} ${opts.extra}`;
  if (opts?.key) return `${label} ${noteKbParen(opts.key)}`;
  return `${label} — click again to toggle`;
}

/** Favorites first; preserves relative order within each group. */
function sortNotesFavoritesFirst(notes: Note[]): Note[] {
  const fav = notes.filter((n) => n.favorite);
  const rest = notes.filter((n) => !n.favorite);
  return [...fav, ...rest];
}

/** Drop target for the preview gap (must receive drag events; `pointer-events-none` breaks drop). */
function DndDropSlot({
  onDragOver,
  onDrop,
}: {
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="h-10 w-full shrink-0 cursor-grab rounded-lg border-2 border-dashed border-primary/50 bg-gradient-to-b from-primary/[0.12] to-muted/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
      aria-hidden
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
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
  let el: Node | null =
    node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
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

/** Nearest block-level ancestor for @-mention (avoids matching @ in another paragraph when Range.toString omits newlines between blocks). */
function getMentionBlockContainer(node: Node, root: HTMLElement): Node {
  const blockTags = new Set([
    "P",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "BLOCKQUOTE",
    "PRE",
    "TD",
    "TH",
  ]);
  let n: Node | null =
    node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (n && n !== root) {
    if (n instanceof HTMLElement) {
      if (blockTags.has(n.tagName)) return n;
      if (n.tagName === "DIV" && n.parentNode === root) return n;
    }
    n = n.parentNode;
  }
  return root;
}

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

  const atBlock = getMentionBlockContainer(replaceRange.startContainer, root);
  const caretBlock = getMentionBlockContainer(caretRange.startContainer, root);
  if (atBlock !== caretBlock) return null;

  const caretRect = caretRange.getBoundingClientRect();
  return { query, replaceRange, caretRect };
}

const NOTES_PAGES_SESSION_KEY = "notes:pagesSnapshot:v1";

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

function applySavedOrder<T extends { id: string }>(
  rows: T[],
  key: string,
): T[] {
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
        <span key={`t-${partIndex++}`}>
          {linkifyText(src.slice(lastIndex, matchIndex))}
        </span>,
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
      nodes.push(<em key={`i-${partIndex++}`}>{linkifyText(italicText)}</em>);
    } else if (typeof highlightText === "string") {
      nodes.push(
        <mark key={`hi-${partIndex++}`} className="note-highlight">
          {renderInlineMarkdown(highlightText, depth + 1)}
        </mark>,
      );
    } else if (typeof underlineText === "string") {
      nodes.push(<u key={`u-${partIndex++}`}>{linkifyText(underlineText)}</u>);
    } else if (typeof strikeText === "string") {
      nodes.push(<s key={`s-${partIndex++}`}>{linkifyText(strikeText)}</s>);
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
    nodes.push(
      <span key={`t-${partIndex++}`}>{linkifyText(src.slice(lastIndex))}</span>,
    );
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
  "note-html-view min-h-0 space-y-2 text-sm [&_figure[data-note-image='1']]:max-w-full [&_figure[data-note-image='1']]:min-h-[48px] [&_figure[data-note-image='1']]:min-w-[120px] [&_figure[data-note-image='1']]:cursor-grab [&_figure[data-note-image='1']]:overflow-visible [&_figure[data-note-image='1']_img]:rounded-md [&_figure[data-note-image='1']_img]:min-h-[32px] [&_h3]:scroll-m-20 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-tight [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5 [&_ul.note-task-list]:list-none [&_ul.note-task-list]:pl-0 [&_ul.note-task-list_li]:flex [&_ul.note-task-list_li]:items-start [&_ul.note-task-list_li]:gap-2 [&_ul.note-task-list_li]:my-0.5 [&_ul.note-task-list_.note-task-checkbox]:mt-0.5 [&_ul.note-task-list_.note-task-checkbox]:h-4 [&_ul.note-task-list_.note-task-checkbox]:w-4 [&_ul.note-task-list_.note-task-checkbox]:shrink-0 [&_ul.note-task-list_.note-task-checkbox]:cursor-pointer [&_ul.note-task-list_.note-task-checkbox]:rounded-sm [&_ul.note-task-list_li>span]:min-h-[1.25em] [&_ul.note-task-list_li>span]:min-w-0 [&_ul.note-task-list_li>span]:flex-1 [&_ul.note-task-list_li>span]:cursor-text [&_ul.note-task-list_li>span]:outline-none [&_a.note-mention]:inline-flex [&_a.note-mention]:max-w-full [&_a.note-mention]:items-center [&_a.note-mention]:rounded-md [&_a.note-mention]:border [&_a.note-mention]:border-border/70 [&_a.note-mention]:bg-muted/85 [&_a.note-mention]:px-1.5 [&_a.note-mention]:py-px [&_a.note-mention]:text-xs [&_a.note-mention]:font-medium [&_a.note-mention]:leading-snug [&_a.note-mention]:text-foreground [&_a.note-mention]:no-underline [&_a.note-mention]:shadow-sm [&_a.note-mention]:decoration-transparent [&_a.note-mention]:transition-colors [&_a.note-mention]:cursor-pointer [&_a.note-mention]:hover:bg-muted";

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
        ref={
          htmlRef
            ? (el) => {
                htmlRef.current = el;
              }
            : undefined
        }
        tabIndex={-1}
        className={NOTE_HTML_VIEW_CLASS}
        dangerouslySetInnerHTML={{
          __html: normalizeNoteHtmlStructure(content),
        }}
      />
    );
  }
  return renderPreviewMarkdown(content);
}

/** Radix portaled UI opened from the note editor (format panel, selects, crop dialog). */
function isInsideDetachedNoteEditUi(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    [
      "[data-radix-popper-content-wrapper]",
      "[data-radix-select-content]",
      '[data-slot="select-content"]',
      "[data-radix-menu-content]",
      "[data-radix-dropdown-menu-content]",
      "[data-radix-dialog-overlay]",
      "[data-radix-dialog-content]",
      '[role="dialog"]',
    ].join(","),
  );
}

/** Handlers updated each parent render via ref so the editor subtree can stay memoized. */
type NoteEditorHandlers = {
  onInput: () => void;
  onPaste: (e: ClipboardEvent<HTMLDivElement>) => void;
  onCopy: (e: ClipboardEvent<HTMLDivElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onMouseUp: () => void;
  onKeyUp: () => void;
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
        onCopy={(e) => handlersRef.current.onCopy(e)}
        onKeyDown={(e) => handlersRef.current.onKeyDown(e)}
        onClick={(e) => handlersRef.current.onClick(e)}
        onContextMenu={(e) => handlersRef.current.onContextMenu(e)}
        onPointerDown={(e) => handlersRef.current.onPointerDown(e)}
        onMouseUp={() => handlersRef.current.onMouseUp()}
        onKeyUp={() => handlersRef.current.onKeyUp()}
      />
    );
  },
  (prev, next) =>
    prev.noteId === next.noteId && prev.editorSession === next.editorSession,
);

export default function NotesPage() {
  const {
    accessToken: token,
    userId,
    isReady: authSessionReady,
  } = useAuthSession();
  const accessTokenRef = useRef<string | null>(null);
  accessTokenRef.current = token;
  const [pages, setPages] = useState<NotePage[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notesLoading, setNotesLoading] = useState(true);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
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
  const { addToast } = useToast();
  const dragNoteIdRef = useRef<string | null>(null);
  const dragNoteOverRef = useRef<{ id: string; before: boolean } | null>(null);
  const dragPageIdRef = useRef<string | null>(null);
  const dragPageOverRef = useRef<{ id: string; before: boolean } | null>(null);
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [dragPageOver, setDragPageOver] = useState<{
    id: string;
    before: boolean;
  } | null>(null);
  const [dragNoteOver, setDragNoteOver] = useState<{
    id: string;
    before: boolean;
  } | null>(null);
  const [lastSavedAtMs, setLastSavedAtMs] = useState<number | null>(null);
  /** Search titles + bodies across all notes for this account. */
  const [searchAllNotesQuery, setSearchAllNotesQuery] = useState("");
  /** Find text inside the open note body (read or edit). */
  const [findInNoteQuery, setFindInNoteQuery] = useState("");
  const [findInNoteOpen, setFindInNoteOpen] = useState(false);
  const [fmtInMention, setFmtInMention] = useState(false);
  /** Image upload to /api/notes/images (XHR progress + decode after insert). */
  const [imageUploadState, setImageUploadState] = useState<{
    active: boolean;
    progress: number;
    phase: "upload" | "decode";
  }>({ active: false, progress: 0, phase: "upload" });
  /** Bumps when an image figure is selected so toolbar can show move/crop actions. */
  const [imageSelectionEpoch, setImageSelectionEpoch] = useState(0);
  const [imageCropOpen, setImageCropOpen] = useState(false);
  const [cropSides, setCropSides] = useState({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    imageFigure: HTMLElement | null;
  }>({ open: false, x: 0, y: 0, imageFigure: null });
  const [notesSubView, setNotesSubView] = useState<"notes" | "reminders">(
    "notes",
  );
  /** After first bootstrap, switching pages only shows the grid overlay (no second full-page pass). */
  const [initialNotesBootstrapDone, setInitialNotesBootstrapDone] =
    useState(false);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const formatMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const formatMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const findInNotePanelRef = useRef<HTMLDivElement | null>(null);
  /** Read-mode wrapper (always mounted when viewing a note); used for find + focus. */
  const readNoteBodyWrapRef = useRef<HTMLDivElement | null>(null);
  const readNoteHtmlRef = useRef<HTMLDivElement | null>(null);
  /** After leaving edit, restore read scroll (same position as editor). */
  const pendingReadBodyScrollRef = useRef<{
    noteId: string;
    top: number;
  } | null>(null);
  /** When entering edit, match read view scroll on the editor. */
  const pendingEditorScrollRef = useRef<number | null>(null);
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
  /** Avoid re-running bootstrap when only `accessToken` refreshes for the same user. */
  const lastNotesBootstrapUserIdRef = useRef<string | null>(null);
  const notesBootstrapGenRef = useRef(0);

  const imageDragStateRef = useRef<{
    mode: "reorder" | "pending-reorder" | "resize" | "rotate";
    corner?: "nw" | "ne" | "sw" | "se";
    figure: HTMLElement;
    startX: number;
    startY: number;
    startWidth: number;
    startMarginLeft: number;
    startMarginTop: number;
    startRotateDeg?: number;
    centerX?: number;
    centerY?: number;
    startPointerAngleRad?: number;
    rafId?: number;
    reorderSticky?: { el: Element; before: boolean } | null;
    reorderLastApplyAt?: number;
    reorderPendingClientY?: number;
    reorderFlushTimer?: ReturnType<typeof setTimeout>;
    reorderStartX?: number;
    reorderStartMarginLeft?: number;
  } | null>(null);
  const imagePointerListenersRef = useRef<{
    move: (e: globalThis.PointerEvent) => void;
    up: (e: globalThis.PointerEvent) => void;
  } | null>(null);
  const selectedImageFigureRef = useRef<HTMLElement | null>(null);
  const contextMenuOpenRef = useRef(false);
  const openingContextMenuRef = useRef(false);
  const formatMenuOpenRef = useRef(false);
  /** Title + toolbar + body for the open note; pointer outside = leave edit (blur ignored). */
  const noteEditShellRef = useRef<HTMLDivElement | null>(null);
  const imageCropOpenRef = useRef(false);
  imageCropOpenRef.current = imageCropOpen;

  const detachImagePointerListeners = useCallback(() => {
    const L = imagePointerListenersRef.current;
    if (L) {
      window.removeEventListener("pointermove", L.move);
      window.removeEventListener("pointerup", L.up);
      imagePointerListenersRef.current = null;
    }
    const s = imageDragStateRef.current;
    if (s?.figure) s.figure.removeAttribute("data-note-image-reordering");
    if (s?.rafId != null) cancelAnimationFrame(s.rafId);
    if (s?.reorderFlushTimer != null) clearTimeout(s.reorderFlushTimer);
    imageDragStateRef.current = null;
  }, []);

  const clearImageSelection = useCallback(() => {
    const root = editorRef.current;
    if (root) {
      root
        .querySelectorAll("figure[data-note-image-selected='1']")
        .forEach((el) => {
          if (el instanceof HTMLElement)
            el.removeAttribute("data-note-image-selected");
        });
    }
    selectedImageFigureRef.current = null;
    setImageSelectionEpoch(0);
  }, []);

  useEffect(() => {
    if (!dragNoteId && !dragPageId) return;
    const onNativeDragStart = () => {
      detachImagePointerListeners();
    };
    document.addEventListener("dragstart", onNativeDragStart, true);
    return () =>
      document.removeEventListener("dragstart", onNativeDragStart, true);
  }, [dragNoteId, dragPageId, detachImagePointerListeners]);

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

  const allNotesSearchResults = useMemo(() => {
    const q = searchAllNotesQuery.trim().toLowerCase();
    if (!q) return [];
    return allNotesForMentions
      .map((n) => {
        const title = (n.title || "").toLowerCase();
        const body = isProbablyHtml(n.content)
          ? htmlToPlainText(n.content)
          : (n.content ?? "");
        const bl = body.toLowerCase();
        if (!title.includes(q) && !bl.includes(q)) return null;
        const idx = bl.indexOf(q);
        const snippet =
          idx >= 0
            ? body.slice(Math.max(0, idx - 40), idx + q.length + 80)
            : body.slice(0, 120);
        return { note: n, snippet };
      })
      .filter((x): x is { note: Note; snippet: string } => x != null)
      .slice(0, 50);
  }, [allNotesForMentions, searchAllNotesQuery]);

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
    setNoteBodyFullscreen(false);
  }, [selectedNoteId]);

  useEffect(() => {
    if (!selectedNote?.updatedAt) {
      setLastSavedAtMs(null);
      return;
    }
    const t = Date.parse(selectedNote.updatedAt);
    if (!Number.isNaN(t)) setLastSavedAtMs(t);
  }, [selectedNote?.id, selectedNote?.updatedAt]);

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
    if (!userId) return;
    const ac = new AbortController();
    (async () => {
      const bearer = accessTokenRef.current;
      if (!bearer) return;
      try {
        const res = await fetch("/api/notes", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
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
  }, [userId]);

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
      maxH: Math.min(0.5 * window.innerHeight, Math.max(160, r.top - 16)),
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
    formatMenuOpenRef.current = formatMenuOpen;
  }, [formatMenuOpen]);

  useEffect(() => {
    if (!formatMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (formatMenuButtonRef.current?.contains(t)) return;
      if (formatMenuPanelRef.current?.contains(t)) return;
      formatMenuOpenRef.current = false;
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

  /** Initial load: one HTTP round-trip (pages + notes for initial page), or session cache after first visit. */
  useEffect(() => {
    if (!authSessionReady) return;
    if (!userId) {
      lastNotesBootstrapUserIdRef.current = null;
      return;
    }
    if (!token) return;
    if (lastNotesBootstrapUserIdRef.current === userId) return;

    const ac = new AbortController();
    let alive = true;
    const gen = ++notesBootstrapGenRef.current;

    const applyBootstrapPayload = (payload: {
      pages: NotePage[];
      notes: Note[];
      initialPageId: string | null;
    }) => {
      const pageData = Array.isArray(payload.pages) ? payload.pages : [];
      setPages(applySavedOrder(pageData, LS_PAGE_ORDER_KEY));

      const initialPageId = payload.initialPageId;
      skipNextNotesFetchForPageRef.current = true;
      setSelectedPageId(initialPageId);

      if (initialPageId) {
        const list = sortNotesFavoritesFirst(
          applySavedOrder(
            Array.isArray(payload.notes) ? payload.notes : [],
            `${LS_NOTE_ORDER_KEY_PREFIX}${initialPageId}`,
          ),
        );
        setNotes(list);
        const savedNoteId = readLs(LS_LAST_NOTE_KEY);
        const initialNoteId =
          savedNoteId && list.some((n) => n.id === savedNoteId)
            ? savedNoteId
            : (list[0]?.id ?? null);
        setSelectedNoteId(initialNoteId);
      } else {
        setNotes([]);
        setSelectedNoteId(null);
      }
    };

    (async () => {
      const bearer = accessTokenRef.current;
      if (!bearer) return;

      const cached = readNotesBootstrapFromSession(userId);
      if (cached) {
        if (gen !== notesBootstrapGenRef.current) return;
        applyBootstrapPayload(cached);
        lastNotesBootstrapUserIdRef.current = userId;
        if (alive) setNotesLoading(false);
        return;
      }

      setNotesLoading(true);
      try {
        const savedPageId = readLs(LS_LAST_PAGE_KEY);
        const q =
          savedPageId && savedPageId.length > 0
            ? `?preferredPageId=${encodeURIComponent(savedPageId)}`
            : "";
        const res = await fetch(`/api/notes/bootstrap${q}`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          signal: ac.signal,
        });
        if (!res.ok) throw new Error("bootstrap");
        const payload = (await res.json()) as {
          pages: NotePage[];
          notes: Note[];
          initialPageId: string | null;
        };
        if (!alive || gen !== notesBootstrapGenRef.current) return;

        applyBootstrapPayload(payload);
        lastNotesBootstrapUserIdRef.current = userId;
        writeNotesBootstrapToSession(userId, {
          pages: Array.isArray(payload.pages) ? payload.pages : [],
          notes: Array.isArray(payload.notes) ? payload.notes : [],
          initialPageId: payload.initialPageId,
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (alive) {
          setPages([]);
          setNotes([]);
          setSelectedPageId(null);
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
  }, [userId, authSessionReady, token]);

  useEffect(() => {
    if (!userId) setInitialNotesBootstrapDone(false);
  }, [userId]);

  useEffect(() => {
    if (!notesLoading && userId) setInitialNotesBootstrapDone(true);
  }, [notesLoading, userId]);

  useEffect(() => {
    if (selectedPageId) writeLs(LS_LAST_PAGE_KEY, selectedPageId);
  }, [selectedPageId]);

  useEffect(() => {
    if (selectedNoteId) writeLs(LS_LAST_NOTE_KEY, selectedNoteId);
  }, [selectedNoteId]);

  useEffect(() => {
    setFindInNoteOpen(false);
    setFindInNoteQuery("");
  }, [selectedNoteId]);

  useEffect(() => {
    clearFindHighlights(editorRef.current);
    clearFindHighlights(readNoteBodyWrapRef.current);
  }, [selectedNoteId]);

  useEffect(() => {
    if (!findInNoteQuery.trim()) {
      clearFindHighlights(editorRef.current);
      clearFindHighlights(readNoteBodyWrapRef.current);
    }
  }, [findInNoteQuery]);

  useEffect(() => {
    if (!findInNoteOpen) return;
    const onKey = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === "Escape")
        setFindInNoteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findInNoteOpen]);

  /** ⌘F / Ctrl+F: find in note (avoid hijacking sidebar search / new-title fields). */
  useEffect(() => {
    if (!selectedNoteId) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "f") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
        if (
          t.dataset.notesGlobalSearch === "1" ||
          t.dataset.notesNewTitle === "1"
        ) {
          return;
        }
      }
      e.preventDefault();
      setFindInNoteOpen(true);
      queueMicrotask(() =>
        findInNotePanelRef.current?.querySelector("input")?.focus(),
      );
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectedNoteId]);

  /** Switch page: single notes fetch with abort if user switches again. */
  useEffect(() => {
    if (!userId || !selectedPageId) return;
    if (skipNextNotesFetchForPageRef.current) {
      skipNextNotesFetchForPageRef.current = false;
      return;
    }

    const ac = new AbortController();
    let alive = true;
    setNotesLoading(true);

    (async () => {
      try {
        const bearer = accessTokenRef.current;
        if (!bearer) return;
        const res = await fetch(`/api/notes?pageId=${selectedPageId}`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          signal: ac.signal,
        });
        if (!alive) return;
        if (!res.ok) {
          setNotes([]);
          setSelectedNoteId(null);
          return;
        }
        const data = (await res.json()) as Note[];
        const list = sortNotesFavoritesFirst(
          applySavedOrder(
            Array.isArray(data) ? data : [],
            `${LS_NOTE_ORDER_KEY_PREFIX}${selectedPageId}`,
          ),
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
  }, [selectedPageId, userId]);

  useEffect(() => {
    setEditingPageId(null);
  }, [selectedPageId]);

  useEffect(() => {
    setMentionPickerOpen(false);
    setMentionQuery("");
    lastMentionQueryForHighlightRef.current = "";
    pendingReadBodyScrollRef.current = null;
    pendingEditorScrollRef.current = null;
    if (!selectedNoteId) return;
    setIsEditing(false);
    setFormatMenuOpen(false);
    setEditingMainTitle(false);
    setEditingNoteRowId(null);
  }, [selectedNoteId]);

  useEffect(() => {
    if (isEditing) return;
    const p = pendingReadBodyScrollRef.current;
    if (!p || p.noteId !== selectedNoteId) return;
    const top = p.top;
    const apply = () => {
      const el = readNoteBodyWrapRef.current;
      if (!el) return false;
      el.scrollTop = top;
      pendingReadBodyScrollRef.current = null;
      return true;
    };
    if (apply()) return;
    const id = requestAnimationFrame(() => {
      apply();
    });
    return () => cancelAnimationFrame(id);
  }, [isEditing, selectedNoteId]);

  useLayoutEffect(() => {
    if (!isEditing || !selectedNoteId) return;
    if (pendingEditorScrollRef.current === null) return;
    const top = pendingEditorScrollRef.current;
    const ed = editorRef.current;
    if (!ed) return;
    ed.scrollTop = top;
    requestAnimationFrame(() => {
      if (editorRef.current) editorRef.current.scrollTop = top;
    });
    pendingEditorScrollRef.current = null;
  }, [isEditing, selectedNoteId, editorSession]);

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
    if (userId) clearNotesBootstrapFromSession(userId);
    const created = (await res.json()) as NotePage;
    setPages((prev) => {
      const next = [created, ...prev];
      writeOrderIds(
        LS_PAGE_ORDER_KEY,
        next.map((p) => p.id),
      );
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
    if (userId) clearNotesBootstrapFromSession(userId);
    const remaining = pages.filter((p) => p.id !== pageId);
    setPages(remaining);
    writeOrderIds(
      LS_PAGE_ORDER_KEY,
      remaining.map((p) => p.id),
    );
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
    if (userId) clearNotesBootstrapFromSession(userId);
    const created = (await res.json()) as Note;
    setNotes((prev) => {
      const next = sortNotesFavoritesFirst([created, ...prev]);
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
    setNotes((prev) => {
      const next = sortNotesFavoritesFirst(
        prev.map((n) => (n.id === noteId ? updated : n)),
      );
      if (selectedPageId) {
        writeOrderIds(
          `${LS_NOTE_ORDER_KEY_PREFIX}${selectedPageId}`,
          next.map((n) => n.id),
        );
      }
      return next;
    });
    setAllNotesForMentions((prev) =>
      prev.map((n) => (n.id === noteId ? updated : n)),
    );
    return updated;
  };

  const updateNoteRef = useRef(updateNote);
  updateNoteRef.current = updateNote;

  const stripEditorOnlyUi = useCallback((html: string) => {
    if (typeof document === "undefined") return html;
    const doc = new DOMParser().parseFromString(
      `<div>${html}</div>`,
      "text/html",
    );
    const root = doc.body.firstElementChild;
    if (!root) return html;
    root.querySelectorAll("[data-note-ui='1']").forEach((el) => el.remove());
    root.querySelectorAll("mark[data-note-find='1']").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
    root.querySelectorAll("figure[data-note-image='1']").forEach((el) => {
      if (el instanceof HTMLElement)
        el.removeAttribute("data-note-image-selected");
    });
    return root.innerHTML;
  }, []);

  const persistNoteBody = useCallback(
    async (noteId: string, content: string, showIndicator: boolean) => {
      const stripped = stripEditorOnlyUi(content);
      // Avoid persisting a transient empty editor read (rare browser glitches) over real content.
      if (
        stripped.trim() === "" &&
        lastAutoSavedBodyRef.current !== null &&
        lastAutoSavedBodyRef.current.length > 0
      ) {
        return true;
      }
      const normalized = normalizeNoteHtmlForSave(stripped);
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
        // Do not assign editor.innerHTML here. Replacing the live DOM with normalized
        // HTML strips image handles, re-parses nodes, and reloads <img> — visible flicker
        // on every autosave. updateNote() already merges server content into `notes`.
      }
      if (showIndicator) {
        if (saved) {
          setLastSavedAtMs(Date.now());
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

  const closeNoteBodyEditAndSave = useCallback(() => {
    const sid = selectedNoteIdRef.current;
    if (!sid) return;
    void (async () => {
      const edEl = editorRef.current;
      const raw = edEl?.innerHTML ?? "";
      const normalized = normalizeNoteHtmlForSave(stripEditorOnlyUi(raw));
      setNotes((prev) =>
        sortNotesFavoritesFirst(
          prev.map((n) => (n.id === sid ? { ...n, content: normalized } : n)),
        ),
      );
      await persistNoteBodyRef.current(sid, normalized, true);
      const ed = editorRef.current;
      if (ed) {
        pendingReadBodyScrollRef.current = { noteId: sid, top: ed.scrollTop };
      }
      formatMenuOpenRef.current = false;
      setFormatMenuOpen(false);
      setContextMenu((s) => ({ ...s, open: false }));
      setIsEditing(false);
    })();
  }, [stripEditorOnlyUi]);

  useEffect(() => {
    if (!isEditing) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (imageCropOpenRef.current) return;
      const target = e.target as Node;
      if (noteEditShellRef.current?.contains(target)) return;
      if (formatMenuPanelRef.current?.contains(target)) return;
      if (formatMenuButtonRef.current?.contains(target)) return;
      if (mentionPickerRef.current?.contains(target)) return;
      if (findInNotePanelRef.current?.contains(target)) return;
      if (isInsideDetachedNoteEditUi(target)) return;
      closeNoteBodyEditAndSave();
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [isEditing, closeNoteBodyEditAndSave]);

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
        sortNotesFavoritesFirst(
          prev.map((n) => (n.id === sid ? { ...n, content: normalized } : n)),
        ),
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
    if (userId) clearNotesBootstrapFromSession(userId);
    const remaining = sortNotesFavoritesFirst(
      notes.filter((n) => n.id !== noteId),
    );
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

  /** Insert `draggedId` before or after `targetId` (for drop indicators). */
  const reorderInsert = <T extends { id: string }>(
    list: T[],
    draggedId: string,
    targetId: string,
    insertBefore: boolean,
  ) => {
    if (!draggedId || !targetId || draggedId === targetId) return list;
    const from = list.findIndex((x) => x.id === draggedId);
    const targetIdx = list.findIndex((x) => x.id === targetId);
    if (from < 0 || targetIdx < 0) return list;
    let to = insertBefore ? targetIdx : targetIdx + 1;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    if (from < to) to -= 1;
    next.splice(to, 0, moved);
    return next;
  };

  const handlePageDrop = (targetPageId: string) => {
    const draggedId = dragPageIdRef.current;
    if (!draggedId || draggedId === targetPageId) return;
    const over = dragPageOverRef.current;
    const insertBefore = over?.id === targetPageId ? over.before : true;
    setPages((prev) => {
      const next = reorderInsert(prev, draggedId, targetPageId, insertBefore);
      writeOrderIds(
        LS_PAGE_ORDER_KEY,
        next.map((p) => p.id),
      );
      return next;
    });
    dragPageIdRef.current = null;
    dragPageOverRef.current = null;
    setDragPageId(null);
    setDragPageOver(null);
  };

  const handleNoteDrop = (targetNoteId: string) => {
    const draggedId = dragNoteIdRef.current;
    if (!draggedId || draggedId === targetNoteId) return;
    const over = dragNoteOverRef.current;
    const insertBefore = over?.id === targetNoteId ? over.before : true;
    setNotes((prev) => {
      const next = sortNotesFavoritesFirst(
        reorderInsert(prev, draggedId, targetNoteId, insertBefore),
      );
      if (selectedPageId) {
        writeOrderIds(
          `${LS_NOTE_ORDER_KEY_PREFIX}${selectedPageId}`,
          next.map((n) => n.id),
        );
      }
      return next;
    });
    dragNoteIdRef.current = null;
    dragNoteOverRef.current = null;
    setDragNoteId(null);
    setDragNoteOver(null);
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
    if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode))
      return false;
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
    if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode))
      return false;
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
    if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode))
      return false;
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
    if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode))
      return false;
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

  const selectionInsideNoteMention = useCallback(() => {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode))
      return false;
    let n: Node | null = sel.anchorNode;
    if (n.nodeType === Node.TEXT_NODE) n = (n as Text).parentElement;
    while (n && n !== root) {
      if (
        n instanceof HTMLElement &&
        n.tagName === "A" &&
        n.classList.contains("note-mention") &&
        n.hasAttribute("data-note-id")
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
    const saved = editorSelectionRef.current;
    if (saved && root.contains(saved.commonAncestorContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(saved.cloneRange());
      return true;
    }
    if (sel?.rangeCount) {
      const r = sel.getRangeAt(0);
      if (root.contains(r.commonAncestorContainer)) return true;
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
          raw.includes("h3") || raw.includes("heading 3") || raw === "3";
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
      setFmtInMention(selectionInsideNoteMention());
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
    selectionInsideNoteMention,
  ]);

  useEffect(() => {
    if (!isEditing) return;
    const onSel = () => {
      if (contextMenuOpenRef.current) {
        refreshFmt();
        return;
      }
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

  /** execCommand for inline styles; runs twice when needed so toggling off works (context menu + toolbar). */
  const runFormatCommand = useCallback(
    (command: string, value?: string) => {
      const root = editorRef.current;
      root?.focus();
      restoreEditorSelection();
      const inlineToggle = [
        "bold",
        "italic",
        "underline",
        "strikeThrough",
      ] as const;
      const isInlineToggle =
        (inlineToggle as readonly string[]).includes(command) &&
        value === undefined;
      try {
        document.execCommand(
          "styleWithCSS",
          false,
          isInlineToggle ? "false" : "true",
        );
      } catch {
        /* ignore */
      }
      if (
        (inlineToggle as readonly string[]).includes(command) &&
        value === undefined
      ) {
        let before = false;
        try {
          before = document.queryCommandState(command);
        } catch {
          /* ignore */
        }
        try {
          document.execCommand(command, false, value);
        } catch {
          /* ignore */
        }
        let after = false;
        try {
          after = document.queryCommandState(command);
        } catch {
          /* ignore */
        }
        if (before && after) {
          try {
            document.execCommand(command, false, value);
          } catch {
            /* ignore */
          }
        }
      } else {
        try {
          document.execCommand(command, false, value);
        } catch {
          /* ignore */
        }
      }
      root?.dispatchEvent(new Event("input", { bubbles: true }));
      refreshFmt();
    },
    [refreshFmt, restoreEditorSelection],
  );

  const runUndo = useCallback(() => {
    const root = editorRef.current;
    root?.focus();
    restoreEditorSelection();
    try {
      document.execCommand("undo");
    } catch {
      /* ignore */
    }
    root?.dispatchEvent(new Event("input", { bubbles: true }));
    refreshFmt();
  }, [refreshFmt, restoreEditorSelection]);

  const runRedo = useCallback(() => {
    const root = editorRef.current;
    root?.focus();
    restoreEditorSelection();
    try {
      document.execCommand("redo");
    } catch {
      /* ignore */
    }
    root?.dispatchEvent(new Event("input", { bubbles: true }));
    refreshFmt();
  }, [refreshFmt, restoreEditorSelection]);

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
    span.className = "note-task-line";
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

  const applyMentionColor = useCallback(
    (hex: string) => {
      const full = normalizePanelHex(hex);
      if (!full) return;
      setFormatPanelColor(full);
      const root = editorRef.current;
      root?.focus();
      restoreEditorSelection();
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0) return;
      let n: Node | null = sel.anchorNode;
      if (!n) return;
      if (n.nodeType === Node.TEXT_NODE) n = (n as Text).parentElement;
      let anchor: HTMLAnchorElement | null = null;
      while (n && n !== root) {
        if (
          n instanceof HTMLElement &&
          n.tagName === "A" &&
          n.classList.contains("note-mention")
        ) {
          anchor = n as HTMLAnchorElement;
          break;
        }
        n = n.parentElement;
      }
      if (!anchor) return;
      anchor.style.color = full;
      anchor.setAttribute("data-mention-color", full);
      root.dispatchEvent(new Event("input", { bubbles: true }));
      refreshFmt();
    },
    [normalizePanelHex, refreshFmt, restoreEditorSelection],
  );

  const applyFormatPanelColor = useCallback(
    (hex: string) => {
      editorRef.current?.focus();
      restoreEditorSelection();
      if (selectionInsideNoteMention()) applyMentionColor(hex);
      else applyForeColor(hex);
    },
    [
      applyForeColor,
      applyMentionColor,
      restoreEditorSelection,
      selectionInsideNoteMention,
    ],
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
    code.className = "rounded bg-muted px-1 py-0.5 text-[0.9em] font-mono";
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
      inH3 = raw.includes("h3") || raw.includes("heading 3") || raw === "3";
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
    const wrap = readNoteBodyWrapRef.current;
    pendingEditorScrollRef.current = wrap ? wrap.scrollTop : null;
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
    figure.style.boxSizing = "border-box";
    figure.style.cursor = "grab";
    figure.style.touchAction = "none";
    if (!figure.style.maxWidth) figure.style.maxWidth = "100%";
    if (!figure.style.width) figure.style.width = "420px";
    figure.style.minWidth = "120px";
    figure.style.minHeight = "48px";
    if (!figure.style.marginTop) figure.style.marginTop = "0px";
    if (!figure.style.marginBottom) figure.style.marginBottom = "0px";
    if (!figure.style.marginLeft) figure.style.marginLeft = "0px";
    if (!figure.style.marginRight) figure.style.marginRight = "0px";
    const mt = parseFloat(figure.style.marginTop || "8");
    if (Number.isFinite(mt) && mt > 48) figure.style.marginTop = "8px";

    const img = figure.querySelector("img");
    if (
      !(img instanceof HTMLImageElement) ||
      !img.getAttribute("src")?.trim()
    ) {
      figure
        .querySelectorAll("[data-note-ui='1']")
        .forEach((el) => el.remove());
      figure.removeAttribute("data-note-image-selected");
      figure.removeAttribute("data-note-handle-v");
      return;
    }
    img.style.width = "100%";
    img.style.height = "auto";
    img.style.maxWidth = "100%";
    img.style.display = "block";
    img.style.minHeight = "32px";
    img.style.pointerEvents = "auto";
    if (!img.getAttribute("loading")) img.setAttribute("loading", "lazy");

    const cornersOk =
      figure.querySelectorAll("[data-resize-corner]").length === 4 &&
      !!figure.querySelector("[data-rotate-handle='1']") &&
      figure.getAttribute("data-note-handle-v") === "2";
    if (cornersOk) {
      return;
    }

    figure.querySelectorAll("[data-note-ui='1']").forEach((el) => el.remove());

    const corners: Array<{
      corner: "nw" | "ne" | "sw" | "se";
      title: string;
      cursor: string;
      top?: string;
      left?: string;
      right?: string;
      bottom?: string;
      transform: string;
    }> = [
      {
        corner: "nw",
        title: "Resize",
        cursor: "nwse-resize",
        top: "0",
        left: "0",
        transform: "translate(-50%, -50%)",
      },
      {
        corner: "ne",
        title: "Resize",
        cursor: "nesw-resize",
        top: "0",
        right: "0",
        transform: "translate(50%, -50%)",
      },
      {
        corner: "sw",
        title: "Resize",
        cursor: "nesw-resize",
        bottom: "0",
        left: "0",
        transform: "translate(-50%, 50%)",
      },
      {
        corner: "se",
        title: "Resize",
        cursor: "nwse-resize",
        bottom: "0",
        right: "0",
        transform: "translate(50%, 50%)",
      },
    ];

    for (const c of corners) {
      const h = document.createElement("span");
      h.setAttribute("data-note-ui", "1");
      h.setAttribute("data-note-image-handle", "1");
      h.setAttribute("data-resize-corner", c.corner);
      h.title = c.title;
      h.style.position = "absolute";
      h.style.width = "10px";
      h.style.height = "10px";
      h.style.zIndex = "4";
      h.style.borderRadius = "999px";
      h.style.background = "rgb(99 102 241)";
      h.style.border = "1px solid white";
      h.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.15)";
      h.style.cursor = c.cursor;
      h.style.transform = c.transform;
      if (c.top) h.style.top = c.top;
      if (c.left) h.style.left = c.left;
      if (c.right) h.style.right = c.right;
      if (c.bottom) h.style.bottom = c.bottom;
      figure.appendChild(h);
    }

    const rot = document.createElement("span");
    rot.setAttribute("data-note-ui", "1");
    rot.setAttribute("data-note-image-handle", "1");
    rot.setAttribute("data-rotate-handle", "1");
    rot.title = "Drag to rotate";
    rot.style.position = "absolute";
    rot.style.top = "-14px";
    rot.style.left = "50%";
    rot.style.width = "12px";
    rot.style.height = "12px";
    rot.style.marginLeft = "-6px";
    rot.style.zIndex = "4";
    rot.style.borderRadius = "999px";
    rot.style.background = "rgb(99 102 241)";
    rot.style.border = "1px solid white";
    rot.style.cursor = "grab";
    rot.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.15)";
    figure.appendChild(rot);
    figure.setAttribute("data-note-handle-v", "2");
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

  const getEditorAuthToken = useCallback(
    async () => accessTokenRef.current,
    [],
  );

  const insertImageIntoEditor = useCallback(
    (imageUrl: string): HTMLImageElement | null => {
      const root = editorRef.current;
      if (!root) return null;
      root.focus();
      restoreEditorSelection();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const r = sel.getRangeAt(0);
      if (!root.contains(r.commonAncestorContainer)) return null;

      const figure = document.createElement("figure");
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "Note image";
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.maxWidth = "100%";
      img.style.display = "block";
      img.setAttribute("loading", "lazy");
      figure.appendChild(img);
      ensureImageFigureUi(figure);
      r.deleteContents();
      r.insertNode(figure);
      r.setStartAfter(figure);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      ensureParagraphGapsAroundImages(root);
      root.dispatchEvent(new Event("input", { bubbles: true }));
      return img;
    },
    [ensureImageFigureUi, restoreEditorSelection],
  );

  const insertPastedFigureFromHtml = useCallback(
    (htmlFragment: string): boolean => {
      const root = editorRef.current;
      if (!root) return false;
      const fig = parseFigureFromClipboardHtml(htmlFragment);
      if (!fig) return false;
      const img = fig.querySelector("img");
      if (!img?.getAttribute("src")?.trim()) return false;
      const src = img.getAttribute("src") ?? "";
      if (!/^https?:\/\//i.test(src)) return false;
      root.focus();
      restoreEditorSelection();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      const r = sel.getRangeAt(0);
      if (!root.contains(r.commonAncestorContainer)) return false;
      const imported = document.importNode(fig, true) as HTMLElement;
      imported
        .querySelectorAll("[data-note-ui='1']")
        .forEach((el) => el.remove());
      imported.removeAttribute("data-note-image-selected");
      imported.removeAttribute("data-note-handle-v");
      ensureImageFigureUi(imported);
      r.deleteContents();
      r.insertNode(imported);
      r.setStartAfter(imported);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      ensureParagraphGapsAroundImages(root);
      root.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    [ensureImageFigureUi, restoreEditorSelection],
  );

  const uploadImageFile = useCallback(
    async (file: File) => {
      const bearer = await getEditorAuthToken();
      if (!bearer) return;
      setImageUploadState({ active: true, progress: -1, phase: "upload" });
      let url: string | null = null;
      try {
        url = await new Promise<string | null>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/notes/images");
          xhr.setRequestHeader("Authorization", `Bearer ${bearer}`);
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              setImageUploadState({
                active: true,
                progress: Math.round((ev.loaded / ev.total) * 100),
                phase: "upload",
              });
            } else {
              setImageUploadState({
                active: true,
                progress: -1,
                phase: "upload",
              });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText) as { url?: string };
                resolve(data.url ?? null);
              } catch {
                resolve(null);
              }
            } else resolve(null);
          };
          xhr.onerror = () => resolve(null);
          xhr.onabort = () => resolve(null);
          const fd = new FormData();
          fd.append("file", file);
          xhr.send(fd);
        });
      } finally {
        if (!url) {
          setImageUploadState({ active: false, progress: 0, phase: "upload" });
        }
      }
      if (!url) return;
      setImageUploadState({ active: true, progress: -1, phase: "decode" });
      const img = insertImageIntoEditor(url);
      if (!img) {
        setImageUploadState({ active: false, progress: 0, phase: "upload" });
        return;
      }
      const finishDecode = () =>
        setImageUploadState({ active: false, progress: 0, phase: "upload" });
      if (img.complete && img.naturalWidth > 0) {
        queueMicrotask(finishDecode);
        return;
      }
      const maxWait = window.setTimeout(finishDecode, 12000);
      img.onload = () => {
        window.clearTimeout(maxWait);
        finishDecode();
      };
      img.onerror = () => {
        window.clearTimeout(maxWait);
        finishDecode();
      };
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
      sortNotesFavoritesFirst(
        prev.map((n) => (n.id === id ? { ...n, content: html } : n)),
      ),
    );
    queueMicrotask(() => refreshMentionPickerRef.current());
  }, [stripEditorOnlyUi]);

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
        const file = new File(
          [blob],
          `pasted-${Date.now()}.${imageType.split("/")[1] ?? "png"}`,
          {
            type: imageType,
          },
        );
        await uploadImageFile(file);
        return;
      }
    } catch {
      // ignore clipboard permission / support issues
    }
  }, [uploadImageFile]);

  const copyNoteImageToClipboard = useCallback(async (figure: HTMLElement) => {
    const img = figure.querySelector("img");
    const src = img?.src;
    if (!src) return;
    const html = getFigureHtmlForClipboard(figure);
    const htmlBlob = new Blob([html], { type: "text/html" });
    const plainBlob = new Blob([src], { type: "text/plain" });
    const record: Record<string, Blob> = {
      "text/html": htmlBlob,
      "text/plain": plainBlob,
    };
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      if (blob.size > 0 && blob.type.startsWith("image/")) {
        record[blob.type] = blob;
      }
    } catch {
      /* CORS or offline — HTML + URL still paste in-app */
    }
    try {
      await navigator.clipboard.write([new ClipboardItem(record)]);
    } catch {
      try {
        await navigator.clipboard.writeText(html);
      } catch {
        await navigator.clipboard.writeText(src);
      }
    }
  }, []);

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

  const jumpToNoteFromSearch = useCallback((noteId: string, pageId: string) => {
    setSelectedPageId(pageId);
    setSelectedNoteId(noteId);
    setIsEditing(false);
    formatMenuOpenRef.current = false;
    setFormatMenuOpen(false);
    setContextMenu((s) => ({ ...s, open: false }));
  }, []);

  const runFindInNote = useCallback(
    (forward: boolean) => {
      const q = findInNoteQuery.trim();
      if (!q || !selectedNoteId) return;
      const root = isEditing ? editorRef.current : readNoteBodyWrapRef.current;
      if (!root) return;
      try {
        root.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
      clearFindHighlights(root);
      const found = findTextInRoot(root, q, forward);
      if (found) {
        applyFindMatchHighlight(root, NOTE_MARK_HIGHLIGHT_CLASS);
      }
    },
    [findInNoteQuery, isEditing, selectedNoteId],
  );

  const selectImageFigure = useCallback(
    (figure: HTMLElement) => {
      clearImageSelection();
      selectedImageFigureRef.current = figure;
      figure.setAttribute("data-note-image-selected", "1");
      ensureImageFigureUi(figure);
      setImageSelectionEpoch((n) => n + 1);
    },
    [clearImageSelection, ensureImageFigureUi],
  );

  const moveImageFigureUp = useCallback((figure: HTMLElement) => {
    const parent = figure.parentNode;
    if (!parent) return;
    const prev = figure.previousElementSibling;
    if (prev) parent.insertBefore(figure, prev);
  }, []);

  const moveImageFigureDown = useCallback((figure: HTMLElement) => {
    const parent = figure.parentNode;
    if (!parent) return;
    const next = figure.nextElementSibling;
    if (next) parent.insertBefore(next, figure);
  }, []);

  const openImageCropDialog = useCallback(() => {
    const fig = selectedImageFigureRef.current;
    const img = fig?.querySelector("img");
    if (!(img instanceof HTMLImageElement)) return;
    setCropSides(parseInsetClipFromImg(img));
    setImageCropOpen(true);
  }, []);

  const applyImageCrop = useCallback(() => {
    const fig = selectedImageFigureRef.current;
    const img = fig?.querySelector("img");
    if (!(img instanceof HTMLImageElement)) return;
    const { top, right, bottom, left } = cropSides;
    img.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
    setImageCropOpen(false);
    editorRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [cropSides]);

  const removeSelectedImage = useCallback(() => {
    const root = editorRef.current;
    const figure = selectedImageFigureRef.current;
    if (!figure) return;
    if (!root || !root.contains(figure)) {
      selectedImageFigureRef.current = null;
      setImageSelectionEpoch(0);
      return;
    }
    figure.remove();
    selectedImageFigureRef.current = null;
    setImageSelectionEpoch(0);
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

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const fig = selectedImageFigureRef.current;
        const root = editorRef.current;
        if (fig && root?.contains(fig) && fig.querySelector("img")?.src) {
          const sel = window.getSelection();
          if (sel?.rangeCount) {
            const r = sel.getRangeAt(0);
            if (!sel.isCollapsed && !fig.contains(r.commonAncestorContainer)) {
              /* Let default copy run for selected text outside the image */
            } else {
              e.preventDefault();
              void copyNoteImageToClipboard(fig);
              return;
            }
          } else {
            e.preventDefault();
            void copyNoteImageToClipboard(fig);
            return;
          }
        }
      }

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const root = editorRef.current;
        if (root && tryHandleTaskListEnter(root, e)) return;
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

      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const fig = selectedImageFigureRef.current;
        const root = editorRef.current;
        if (fig && root?.contains(fig)) {
          e.preventDefault();
          if (e.key === "ArrowUp") moveImageFigureUp(fig);
          else moveImageFigureDown(fig);
          root.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const fig = selectedImageFigureRef.current;
        if (fig) {
          const root = editorRef.current;
          if (!root?.contains(fig)) {
            selectedImageFigureRef.current = null;
            setImageSelectionEpoch(0);
          } else {
            e.preventDefault();
            removeSelectedImage();
            return;
          }
        }
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "\\") {
        e.preventDefault();
        void pastePlainFromClipboard();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        toggleHighlightColor();
        return;
      }
      if (!mod) return;
      if (e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          runRedo();
          return;
        }
        e.preventDefault();
        runUndo();
        return;
      }
      if (e.key.toLowerCase() === "y") {
        if (e.metaKey) return;
        e.preventDefault();
        runRedo();
        return;
      }
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
      runUndo,
      runRedo,
      toggleHighlightColor,
      moveImageFigureUp,
      moveImageFigureDown,
      copyNoteImageToClipboard,
    ],
  );

  const handleEditorPaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const html = e.clipboardData.getData("text/html");
      if (html && /<figure[^>]*data-note-image/i.test(html)) {
        if (insertPastedFigureFromHtml(html)) {
          e.preventDefault();
          return;
        }
      }
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
    [insertPastedFigureFromHtml, uploadImageFile],
  );

  const handleEditorCopy = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
    const root = editorRef.current;
    const fig = selectedImageFigureRef.current;
    if (!root || !fig || !root.contains(fig)) return;
    const img = fig.querySelector("img");
    if (!img?.src) return;
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const r = sel.getRangeAt(0);
      if (!sel.isCollapsed && !fig.contains(r.commonAncestorContainer)) {
        return;
      }
    }
    e.preventDefault();
    e.clipboardData.setData("text/html", getFigureHtmlForClipboard(fig));
    e.clipboardData.setData("text/plain", img.src);
  }, []);

  const removeSelectedFormatting = useCallback(() => {
    runFormatCommand("removeFormat");
  }, [runFormatCommand]);

  const handleEditorContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const root = editorRef.current;
      const sel = window.getSelection();
      if (root && sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        if (root.contains(r.commonAncestorContainer)) {
          editorSelectionRef.current = r.cloneRange();
        }
      }
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
        selectImageFigure(figure);
      }
    },
    [selectImageFigure],
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
      const figure = target.closest("figure[data-note-image='1']");
      if (!(figure instanceof HTMLElement)) {
        clearImageSelection();
        return;
      }

      e.preventDefault();
      root.focus();

      const cornerEl = target.closest(
        "[data-resize-corner]",
      ) as HTMLElement | null;
      const rotateEl = target.closest("[data-rotate-handle='1']");

      const corner = cornerEl?.getAttribute("data-resize-corner") as
        | "nw"
        | "ne"
        | "sw"
        | "se"
        | null
        | undefined;

      selectImageFigure(figure);

      if (rotateEl) {
        const rect = figure.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const startPointerAngleRad = Math.atan2(e.clientY - cy, e.clientX - cx);
        imageDragStateRef.current = {
          mode: "rotate",
          figure,
          startX: e.clientX,
          startY: e.clientY,
          startWidth: Math.max(120, rect.width),
          startMarginLeft: parseFloat(figure.style.marginLeft || "0") || 0,
          startMarginTop: parseFloat(figure.style.marginTop || "8") || 8,
          startRotateDeg: getFigureRotateDeg(figure),
          centerX: cx,
          centerY: cy,
          startPointerAngleRad,
        };
        figure.style.cursor = "grabbing";
        const onMove = (ev: globalThis.PointerEvent) => {
          const s = imageDragStateRef.current;
          if (!s || s.mode !== "rotate") return;
          const cx0 = s.centerX!;
          const cy0 = s.centerY!;
          const a0 = s.startPointerAngleRad!;
          const a1 = Math.atan2(ev.clientY - cy0, ev.clientX - cx0);
          const deltaDeg = unwrapAngleDelta(a1 - a0) * (180 / Math.PI);
          const nextDeg = (s.startRotateDeg ?? 0) + deltaDeg;
          s.figure.style.transform = `rotate(${nextDeg}deg)`;
        };
        const onUp = () => {
          detachImagePointerListeners();
          figure.style.cursor = "grab";
          root.dispatchEvent(new Event("input", { bubbles: true }));
        };
        imagePointerListenersRef.current = { move: onMove, up: onUp };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return;
      }

      if (corner) {
        const width = Math.max(120, figure.getBoundingClientRect().width);
        imageDragStateRef.current = {
          mode: "resize",
          corner,
          figure,
          startX: e.clientX,
          startY: e.clientY,
          startWidth: width,
          startMarginLeft: parseFloat(figure.style.marginLeft || "0") || 0,
          startMarginTop: parseFloat(figure.style.marginTop || "8") || 8,
        };
        figure.style.cursor = "nwse-resize";
        const onMove = (ev: globalThis.PointerEvent) => {
          const s = imageDragStateRef.current;
          if (!s || s.mode !== "resize") return;
          const dx = ev.clientX - s.startX;
          const c = s.corner;
          if (c === "se" || c === "ne") {
            const w = Math.max(120, Math.min(980, s.startWidth + dx));
            s.figure.style.width = `${w}px`;
            s.figure.style.maxWidth = "100%";
          } else {
            const w = Math.max(120, Math.min(980, s.startWidth - dx));
            s.figure.style.width = `${w}px`;
            s.figure.style.maxWidth = "100%";
            s.figure.style.marginLeft = `${s.startMarginLeft + (s.startWidth - w)}px`;
          }
        };
        const onUp = () => {
          detachImagePointerListeners();
          figure.style.cursor = "grab";
          root.dispatchEvent(new Event("input", { bubbles: true }));
        };
        imagePointerListenersRef.current = { move: onMove, up: onUp };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return;
      }

      imageDragStateRef.current = {
        mode: "pending-reorder",
        figure,
        startX: e.clientX,
        startY: e.clientY,
        startWidth: Math.max(120, figure.getBoundingClientRect().width),
        startMarginLeft: parseFloat(figure.style.marginLeft || "0") || 0,
        startMarginTop: parseFloat(figure.style.marginTop || "8") || 8,
      };

      const onMove = (ev: globalThis.PointerEvent) => {
        const s = imageDragStateRef.current;
        if (!s) return;
        if (s.mode === "pending-reorder") {
          const dx = ev.clientX - s.startX;
          const dy = ev.clientY - s.startY;
          if (Math.hypot(dx, dy) > 6) {
            s.mode = "reorder";
            s.reorderSticky = null;
            s.reorderLastApplyAt = undefined;
            s.reorderPendingClientY = undefined;
            if (s.reorderFlushTimer != null) {
              clearTimeout(s.reorderFlushTimer);
              s.reorderFlushTimer = undefined;
            }
            s.reorderStartX = ev.clientX;
            s.reorderStartMarginLeft =
              parseFloat(s.figure.style.marginLeft || "0") || 0;
            s.figure.style.marginTop = "0px";
            s.figure.style.marginBottom = "0px";
            s.figure.style.cursor = "grabbing";
            s.figure.setAttribute("data-note-image-reordering", "1");
          } else return;
        }
        if (s.mode === "reorder") {
          const ed = editorRef.current;
          if (!ed) return;
          const sx = s.reorderStartX ?? s.startX;
          const sml = s.reorderStartMarginLeft ?? 0;
          const er = ed.getBoundingClientRect();
          const maxShift = Math.max(160, er.width * 0.48);
          const dx = ev.clientX - sx;
          const ml = Math.max(-maxShift, Math.min(maxShift, sml + dx));
          s.figure.style.marginLeft = `${ml}px`;

          const y = ev.clientY;
          s.reorderPendingClientY = y;
          const THROTTLE_MS = 130;
          const now = performance.now();
          const elapsed =
            s.reorderLastApplyAt != null
              ? now - s.reorderLastApplyAt
              : THROTTLE_MS;
          const applyReorder = () => {
            const cur = imageDragStateRef.current;
            if (!cur || cur.mode !== "reorder") return;
            const ed2 = editorRef.current;
            if (!ed2 || cur.reorderPendingClientY === undefined) return;
            cur.reorderLastApplyAt = performance.now();
            cur.reorderSticky = reorderFigureInEditorByPoint(
              cur.figure,
              ed2,
              cur.reorderPendingClientY,
              cur.reorderSticky ?? null,
            );
            cur.reorderFlushTimer = undefined;
          };
          if (elapsed >= THROTTLE_MS) {
            if (s.reorderFlushTimer != null) {
              clearTimeout(s.reorderFlushTimer);
              s.reorderFlushTimer = undefined;
            }
            applyReorder();
          } else if (s.reorderFlushTimer == null) {
            s.reorderFlushTimer = setTimeout(
              applyReorder,
              THROTTLE_MS - elapsed,
            );
          }
        }
      };

      const onUp = () => {
        const s = imageDragStateRef.current;
        if (s?.rafId != null) cancelAnimationFrame(s.rafId);
        detachImagePointerListeners();
        if (s?.figure) s.figure.style.cursor = "grab";
        ensureParagraphGapsAroundImages(root);
        requestAnimationFrame(() => {
          void root.offsetHeight;
          root.style.transform = "translateZ(0)";
          requestAnimationFrame(() => {
            root.style.transform = "";
          });
        });
        root.dispatchEvent(new Event("input", { bubbles: true }));
      };

      imagePointerListenersRef.current = { move: onMove, up: onUp };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clearImageSelection, detachImagePointerListeners, selectImageFigure],
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
    onCopy: () => {},
    onKeyDown: () => {},
    onClick: () => {},
    onContextMenu: () => {},
    onPointerDown: () => {},
    onMouseUp: () => {},
    onKeyUp: () => {},
  });
  editorHandlersRef.current = {
    onInput: syncEditorToState,
    onPaste: handleEditorPaste,
    onCopy: handleEditorCopy,
    onKeyDown: handleEditorKeyDown,
    onClick: handleEditorClick,
    onContextMenu: handleEditorContextMenu,
    onPointerDown: handleEditorPointerDown,
    onMouseUp: () => {
      refreshFmt();
      queueMicrotask(() => refreshMentionPickerRef.current());
    },
    onKeyUp: () => {
      refreshFmt();
      queueMicrotask(() => refreshMentionPickerRef.current());
    },
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("tab") === "reminders") setNotesSubView("reminders");
  }, []);

  const showInitialNotesWorkspaceLoader =
    !!token &&
    notesSubView === "notes" &&
    notesLoading &&
    !initialNotesBootstrapDone;

  if (!authSessionReady || showInitialNotesWorkspaceLoader) {
    return (
      <div className="container mx-auto px-4">
        <NotesPageLoader message={!authSessionReady ? "Loading…" : "Loading workspace…"} />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">
        Please sign in to use Notes.
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <TopLoadingBar visible={loading && pages.length === 0} />
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
        <div className="mt-4 flex flex-wrap gap-2 border-b border-border pb-2">
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              notesSubView === "notes"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
            onClick={() => {
              setNotesSubView("notes");
              window.history.replaceState({}, "", "/notes");
            }}
          >
            Notes
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              notesSubView === "reminders"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
            onClick={() => {
              setNotesSubView("reminders");
              window.history.replaceState({}, "", "/notes?tab=reminders");
            }}
          >
            Reminders
          </button>
        </div>
      </div>

      {notesSubView === "reminders" ? (
        <RemindersPanel />
      ) : (
        <div className="relative grid min-h-[min(70vh,560px)] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,320px)_minmax(0,1fr)] lg:items-start">
          {notesLoading && initialNotesBootstrapDone ? (
            <NotesOverlayLoader message="Loading notes…" />
          ) : null}
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
                <Fragment key={p.id}>
                  {dragPageId &&
                    dragPageId !== p.id &&
                    dragPageOver?.id === p.id &&
                    dragPageOver.before && (
                      <DndDropSlot
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (
                            !dragPageIdRef.current ||
                            dragPageIdRef.current === p.id
                          )
                            return;
                          const o = { id: p.id, before: true };
                          dragPageOverRef.current = o;
                          setDragPageOver(o);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          dragPageOverRef.current = { id: p.id, before: true };
                          handlePageDrop(p.id);
                        }}
                      />
                    )}
                  <div
                    draggable
                    onDragStart={(e) => {
                      dragPageIdRef.current = p.id;
                      dragPageOverRef.current = null;
                      setDragPageId(p.id);
                      setDragPageOver(null);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", p.id);
                    }}
                    onDragOverCapture={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (
                        !dragPageIdRef.current ||
                        dragPageIdRef.current === p.id
                      )
                        return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      const o = { id: p.id, before };
                      dragPageOverRef.current = o;
                      setDragPageOver(o);
                    }}
                    onDropCapture={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      handlePageDrop(p.id);
                    }}
                    onDragEnd={() => {
                      window.setTimeout(() => {
                        dragPageIdRef.current = null;
                        dragPageOverRef.current = null;
                        setDragPageId(null);
                        setDragPageOver(null);
                      }, 0);
                    }}
                    className={cn(
                      "notes-dnd-row relative flex min-h-10 items-center gap-1 rounded-lg border px-1.5 py-1 transition-[box-shadow,transform,opacity,border-color] duration-150",
                      "hover:border-primary/35 hover:bg-muted/30",
                      selectedPageId === p.id &&
                        "border-indigo-500 bg-indigo-500/10",
                      dragPageId === p.id &&
                        "z-20 cursor-grabbing opacity-60 shadow-[0_14px_40px_-6px_rgba(0,0,0,0.28)] ring-2 ring-primary/35 scale-[0.985] rotate-[0.3deg]",
                      dragPageOver?.id === p.id &&
                        dragPageId &&
                        dragPageId !== p.id &&
                        "ring-2 ring-primary/45",
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
                          className="min-w-0 flex-1 truncate text-left text-sm"
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
                      onClick={() =>
                        updatePage(p.id, { favorite: !p.favorite })
                      }
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
                    <button
                      type="button"
                      onClick={() => deletePage(p.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </button>
                  </div>
                </Fragment>
              ))}
              {dragPageId &&
                dragPageOver &&
                pages.length > 0 &&
                dragPageOver.id === pages[pages.length - 1]!.id &&
                !dragPageOver.before &&
                dragPageId !== pages[pages.length - 1]!.id && (
                  <DndDropSlot
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const lastId = pages[pages.length - 1]!.id;
                      if (
                        !dragPageIdRef.current ||
                        dragPageIdRef.current === lastId
                      )
                        return;
                      const o = { id: lastId, before: false };
                      dragPageOverRef.current = o;
                      setDragPageOver(o);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const lastId = pages[pages.length - 1]!.id;
                      dragPageOverRef.current = { id: lastId, before: false };
                      handlePageDrop(lastId);
                    }}
                  />
                )}
            </div>
          </section>

          <section className="min-w-0 cursor-default rounded-xl border bg-card p-3 space-y-3">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <div className="flex gap-2">
              <Input
                data-notes-new-title="1"
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
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">
                Search all notes
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-notes-global-search="1"
                  className="h-8 pl-8 text-xs"
                  placeholder="Title or body (all pages)…"
                  value={searchAllNotesQuery}
                  onChange={(e) => setSearchAllNotesQuery(e.target.value)}
                  aria-label="Search all notes by title or body"
                />
              </div>
              {searchAllNotesQuery.trim() && (
                <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-1 text-[11px]">
                  {allNotesSearchResults.length === 0 ? (
                    <p className="px-1 py-1 text-muted-foreground">
                      No matches
                    </p>
                  ) : (
                    allNotesSearchResults.map(({ note: n, snippet }) => {
                      const pageTitle =
                        pages.find((p) => p.id === n.pageId)?.title ?? "Page";
                      return (
                        <button
                          key={n.id}
                          type="button"
                          className={cn(
                            "w-full rounded px-1.5 py-1 text-left hover:bg-muted",
                            selectedNoteId === n.id && "bg-muted",
                          )}
                          onClick={() => jumpToNoteFromSearch(n.id, n.pageId)}
                        >
                          <span className="block truncate font-medium">
                            {n.title}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {pageTitle}
                          </span>
                          <span className="line-clamp-2 text-muted-foreground">
                            {snippet}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            <div className="relative space-y-1 min-h-[120px]">
              {notes.map((n) => (
                <Fragment key={n.id}>
                  {dragNoteId &&
                    dragNoteId !== n.id &&
                    dragNoteOver?.id === n.id &&
                    dragNoteOver.before && (
                      <DndDropSlot
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (
                            !dragNoteIdRef.current ||
                            dragNoteIdRef.current === n.id
                          )
                            return;
                          const o = { id: n.id, before: true };
                          dragNoteOverRef.current = o;
                          setDragNoteOver(o);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          dragNoteOverRef.current = { id: n.id, before: true };
                          handleNoteDrop(n.id);
                        }}
                      />
                    )}
                  <div
                    draggable
                    onDragStart={(e) => {
                      if (n.favorite) {
                        e.preventDefault();
                        addToast({
                          title: "Can't move favorited note",
                          description:
                            "Unfavorite it to reorder, or drag other notes. Favorites stay pinned to the top.",
                          variant: "warning",
                        });
                        return;
                      }
                      dragNoteIdRef.current = n.id;
                      dragNoteOverRef.current = null;
                      setDragNoteId(n.id);
                      setDragNoteOver(null);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", n.id);
                    }}
                    onDragOverCapture={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (
                        !dragNoteIdRef.current ||
                        dragNoteIdRef.current === n.id
                      )
                        return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      const o = { id: n.id, before };
                      dragNoteOverRef.current = o;
                      setDragNoteOver(o);
                    }}
                    onDropCapture={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      handleNoteDrop(n.id);
                    }}
                    onDragEnd={() => {
                      window.setTimeout(() => {
                        dragNoteIdRef.current = null;
                        dragNoteOverRef.current = null;
                        setDragNoteId(null);
                        setDragNoteOver(null);
                      }, 0);
                    }}
                    className={cn(
                      "notes-dnd-row relative flex min-h-10 items-center gap-1 rounded-lg border px-1.5 py-1 transition-[box-shadow,transform,opacity,border-color] duration-150",
                      "hover:border-primary/35 hover:bg-muted/30",
                      selectedNoteId === n.id &&
                        "border-violet-500 bg-violet-500/10",
                      dragNoteId === n.id &&
                        "z-20 cursor-grabbing opacity-60 shadow-[0_14px_40px_-6px_rgba(0,0,0,0.28)] ring-2 ring-primary/35 scale-[0.985] rotate-[0.3deg]",
                      dragNoteOver?.id === n.id &&
                        dragNoteId &&
                        dragNoteId !== n.id &&
                        "ring-2 ring-primary/45",
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
                            sortNotesFavoritesFirst(
                              prev.map((x) =>
                                x.id === n.id ? { ...x, title: v } : x,
                              ),
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
                          className="min-w-0 flex-1 truncate text-left text-sm"
                          onClick={() => setSelectedNoteId(n.id)}
                        >
                          <span className="block truncate">{n.title}</span>
                          {n.updatedAt ? (
                            <span
                              className="block truncate text-[10px] text-muted-foreground tabular-nums"
                              title={new Date(n.updatedAt).toLocaleString()}
                            >
                              Updated{" "}
                              {formatNoteEditedRelative(
                                n.updatedAt,
                                editedNowMs,
                              )}
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
                      onClick={() =>
                        void copyText(n.title, `note-title-${n.id}`)
                      }
                    >
                      {copiedKey === `note-title-${n.id}` ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !n.favorite;
                        setNotes((prev) => {
                          const nextList = sortNotesFavoritesFirst(
                            prev.map((x) =>
                              x.id === n.id ? { ...x, favorite: next } : x,
                            ),
                          );
                          if (selectedPageId) {
                            writeOrderIds(
                              `${LS_NOTE_ORDER_KEY_PREFIX}${selectedPageId}`,
                              nextList.map((x) => x.id),
                            );
                          }
                          return nextList;
                        });
                        void updateNote(
                          n.id,
                          { favorite: next },
                          { silent: true },
                        );
                      }}
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
                    <button
                      type="button"
                      onClick={() => deleteNote(n.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </button>
                  </div>
                </Fragment>
              ))}
              {dragNoteId &&
                dragNoteOver &&
                notes.length > 0 &&
                dragNoteOver.id === notes[notes.length - 1]!.id &&
                !dragNoteOver.before &&
                dragNoteId !== notes[notes.length - 1]!.id && (
                  <DndDropSlot
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const lastId = notes[notes.length - 1]!.id;
                      if (
                        !dragNoteIdRef.current ||
                        dragNoteIdRef.current === lastId
                      )
                        return;
                      const o = { id: lastId, before: false };
                      dragNoteOverRef.current = o;
                      setDragNoteOver(o);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const lastId = notes[notes.length - 1]!.id;
                      dragNoteOverRef.current = { id: lastId, before: false };
                      handleNoteDrop(lastId);
                    }}
                  />
                )}
            </div>
          </section>

          <section className="flex min-h-0 min-w-0 cursor-default flex-col overflow-visible rounded-xl border bg-card p-4 lg:max-h-[calc(100vh-7rem)]">
            {selectedNote ? (
              <div
                ref={noteEditShellRef}
                className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-4 overflow-hidden"
              >
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
                              sortNotesFavoritesFirst(
                                prev.map((n) =>
                                  n.id === selectedNote.id
                                    ? { ...n, title: v }
                                    : n,
                                ),
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
                    <Clock
                      className="h-3 w-3 shrink-0 opacity-80"
                      aria-hidden
                    />
                    <span
                      title={new Date(selectedNote.updatedAt).toLocaleString()}
                    >
                      Updated{" "}
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
                    <div className="flex min-h-7 min-w-0 items-center gap-2">
                      <Label className="shrink-0 text-xs text-muted-foreground">
                        Note body
                      </Label>
                      {isEditing ? (
                        <div className="flex min-h-7 min-w-[10.5rem] items-center gap-1.5 text-xs text-muted-foreground">
                          {autoSaveState === "saving" ? (
                            <>
                              <Loader2
                                className="h-3.5 w-3.5 shrink-0 animate-spin"
                                aria-label="Saving"
                              />
                              <span className="tabular-nums">Saving…</span>
                            </>
                          ) : autoSaveState === "saved" ? (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              Saved
                            </span>
                          ) : lastSavedAtMs != null ? (
                            <span
                              className="tabular-nums"
                              title={
                                lastSavedAtMs
                                  ? new Date(lastSavedAtMs).toLocaleString()
                                  : undefined
                              }
                            >
                              Saved{" "}
                              {new Date(lastSavedAtMs).toLocaleTimeString(
                                undefined,
                                {
                                  hour: "numeric",
                                  minute: "2-digit",
                                },
                              )}
                            </span>
                          ) : (
                            <span className="opacity-70">Autosave on</span>
                          )}
                        </div>
                      ) : null}
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
                            void copyText(
                              plain,
                              `editor-body-${selectedNote.id}`,
                            );
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

                        {!isEditing && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className={cn(
                              "h-7 w-7 shrink-0 px-0",
                              findInNoteOpen &&
                                "text-primary ring-1 ring-primary/30 rounded-md",
                            )}
                            title={`Find in note ${noteKbFindInNoteParen()}`}
                            aria-expanded={findInNoteOpen}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() =>
                              setFindInNoteOpen((o) => {
                                const next = !o;
                                if (next)
                                  queueMicrotask(() =>
                                    findInNotePanelRef.current
                                      ?.querySelector("input")
                                      ?.focus(),
                                  );
                                return next;
                              })
                            }
                          >
                            <Search className="h-3.5 w-3.5" />
                            <span className="sr-only">Find in note</span>
                          </Button>
                        )}

                        {isEditing && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 shrink-0 px-0"
                              title={`Undo ${noteKbParen("Z")}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => runUndo()}
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              <span className="sr-only">Undo</span>
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 shrink-0 px-0"
                              title={`Redo ${noteKbRedoParen()}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => runRedo()}
                            >
                              <Redo2 className="h-3.5 w-3.5" />
                              <span className="sr-only">Redo</span>
                            </Button>
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
                                title={`Formatting — ${noteKbParen("B")} ${noteKbParen("I")} ${noteKbParen("U")}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() =>
                                  setFormatMenuOpen((o) => {
                                    const next = !o;
                                    formatMenuOpenRef.current = next;
                                    return next;
                                  })
                                }
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
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className={cn(
                                "h-7 w-7 shrink-0 px-0",
                                findInNoteOpen &&
                                  "text-primary ring-1 ring-primary/30 rounded-md",
                              )}
                              title={`Find in note ${noteKbFindInNoteParen()}`}
                              aria-expanded={findInNoteOpen}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() =>
                                setFindInNoteOpen((o) => {
                                  const next = !o;
                                  if (next)
                                    queueMicrotask(() =>
                                      findInNotePanelRef.current
                                        ?.querySelector("input")
                                        ?.focus(),
                                    );
                                  return next;
                                })
                              }
                            >
                              <Search className="h-3.5 w-3.5" />
                              <span className="sr-only">Find in note</span>
                            </Button>
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
                                    const t = e.target as HTMLElement;
                                    if (t.closest("input, textarea, select")) {
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
                                      onClick={() => runFormatCommand("bold")}
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
                                      onClick={() => runFormatCommand("italic")}
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
                                        { extra: noteKbHighlightParen() },
                                      )}
                                      onClick={toggleHighlightColor}
                                    >
                                      <Highlighter
                                        className={cn(
                                          "h-3 w-3",
                                          fmtActive.highlight && "text-primary",
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
                                        runFormatCommand("insertUnorderedList")
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
                                          {fmtInMention
                                            ? "Mention color"
                                            : "Text color / picker"}
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
                                          onChange={applyFormatPanelColor}
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
                            {imageSelectionEpoch > 0 && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-7 shrink-0 px-0"
                                  title="Move image up in document (Alt+↑)"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    const fig = selectedImageFigureRef.current;
                                    const root = editorRef.current;
                                    if (!fig || !root?.contains(fig)) return;
                                    moveImageFigureUp(fig);
                                    root.dispatchEvent(
                                      new Event("input", { bubbles: true }),
                                    );
                                    editorRef.current?.focus();
                                  }}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                  <span className="sr-only">Move image up</span>
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-7 shrink-0 px-0"
                                  title="Move image down in document (Alt+↓)"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    const fig = selectedImageFigureRef.current;
                                    const root = editorRef.current;
                                    if (!fig || !root?.contains(fig)) return;
                                    moveImageFigureDown(fig);
                                    root.dispatchEvent(
                                      new Event("input", { bubbles: true }),
                                    );
                                    editorRef.current?.focus();
                                  }}
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                  <span className="sr-only">
                                    Move image down
                                  </span>
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 px-2 text-xs"
                                  title="Crop selected image"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={openImageCropDialog}
                                >
                                  <Crop className="h-3.5 w-3.5" />
                                  Crop
                                </Button>
                              </>
                            )}
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
                          onClick={() => setNoteBodyFullscreen((open) => !open)}
                        >
                          {noteBodyFullscreen ? (
                            <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                          <span className="sr-only">
                            {noteBodyFullscreen
                              ? "Exit expanded view"
                              : "Expand note body"}
                          </span>
                        </Button>
                      </div>
                      {findInNoteOpen && (
                        <div
                          ref={findInNotePanelRef}
                          data-find-in-note="1"
                          className="flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5"
                        >
                          <Input
                            className="h-8 min-w-0 flex-1 text-xs"
                            placeholder="Find in note…"
                            value={findInNoteQuery}
                            onChange={(e) => setFindInNoteQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                runFindInNote(!e.shiftKey);
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                setFindInNoteOpen(false);
                              }
                            }}
                            aria-label="Find text in this note"
                          />
                          {findInNoteQuery.trim() ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 shrink-0 px-0"
                                title="Previous match"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => runFindInNote(false)}
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                                <span className="sr-only">Previous match</span>
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 shrink-0 px-0"
                                title="Next match"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => runFindInNote(true)}
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                                <span className="sr-only">Next match</span>
                              </Button>
                            </>
                          ) : null}
                        </div>
                      )}
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
                        "note-html-scroll w-full min-w-0 max-w-full flex-1 cursor-text overflow-x-hidden overflow-y-auto rounded-lg bg-muted/30 px-3 py-2 text-sm text-foreground !space-y-0 outline-none [contain:layout] [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring",
                        NOTE_HTML_VIEW_CLASS,
                        noteBodyFullscreen
                          ? "min-h-0 flex-1 max-h-none sm:min-h-0"
                          : "min-h-[200px] max-h-[min(65vh,520px)] sm:min-h-[240px] sm:max-h-[min(70vh,560px)]",
                      )}
                    />
                  ) : (
                    <div
                      ref={readNoteBodyWrapRef}
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
                        requestAnimationFrame(() => editorRef.current?.focus());
                      }}
                      onContextMenu={openContextMenuFromReadBody}
                      className={cn(
                        "note-html-scroll w-full min-w-0 max-w-full flex-1 cursor-pointer select-text overflow-x-hidden overflow-y-auto rounded-lg bg-muted/30 px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere]",
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
                      className="fixed z-[120] w-[min(17rem,calc(100vw-1rem))] rounded-md border border-border bg-popover p-1 shadow-lg"
                      style={{ left: contextMenu.x, top: contextMenu.y }}
                      role="menu"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runUndo();
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Undo2 className="h-3.5 w-3.5" />
                          Undo
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {noteKbParen("Z")}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runRedo();
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Redo2 className="h-3.5 w-3.5" />
                          Redo
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {noteKbRedoParen()}
                        </span>
                      </button>
                      <div className="my-1 h-px bg-border" role="separator" />
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runFormatCommand("bold");
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Bold className="h-3.5 w-3.5" />
                          Bold
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {noteKbParen("B")}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runFormatCommand("italic");
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Italic className="h-3.5 w-3.5" />
                          Italic
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {noteKbParen("I")}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runFormatCommand("underline");
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <UnderlineIcon className="h-3.5 w-3.5" />
                          Underline
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {noteKbParen("U")}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          runFormatCommand("strikeThrough");
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Strikethrough className="h-3.5 w-3.5" />
                          Strikethrough
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          toggleHighlightColor();
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Highlighter className="h-3.5 w-3.5" />
                          Highlight
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {noteKbHighlightParen()}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          setContextMenu((s) => ({ ...s, open: false }));
                          void pastePlainFromClipboard();
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <ClipboardPaste className="h-3.5 w-3.5" />
                          Paste as plain text
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {noteKbPastePlainParen()}
                        </span>
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
                        <>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              const fig = contextMenu.imageFigure;
                              setContextMenu((s) => ({ ...s, open: false }));
                              if (fig) void copyNoteImageToClipboard(fig);
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <Copy className="h-3.5 w-3.5" />
                              Copy image
                            </span>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {noteKbParen("C")}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-muted"
                            onClick={() => {
                              selectedImageFigureRef.current =
                                contextMenu.imageFigure;
                              setContextMenu((s) => ({ ...s, open: false }));
                              removeSelectedImage();
                            }}
                          >
                            Delete image
                          </button>
                        </>
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
      {imageUploadState.active && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[200] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
        >
          <p className="mb-2 text-xs font-medium">
            {imageUploadState.phase === "decode"
              ? "Processing image…"
              : "Uploading image…"}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            {imageUploadState.progress < 0 ? (
              <div className="h-full w-full animate-pulse rounded-full bg-primary/80" />
            ) : (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                style={{
                  width: `${Math.min(100, imageUploadState.progress)}%`,
                }}
              />
            )}
          </div>
        </div>
      )}
      <Dialog open={imageCropOpen} onOpenChange={setImageCropOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Crop image</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Trim each edge as a percentage (inset). Lower values show more of
            the image; higher values crop more.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(["top", "right", "bottom", "left"] as const).map((side) => (
              <div key={side} className="space-y-1">
                <Label className="text-xs capitalize">{side}</Label>
                <Input
                  type="number"
                  min={0}
                  max={45}
                  step={0.5}
                  className="h-8 text-xs"
                  value={cropSides[side]}
                  onChange={(e) => {
                    const v = Math.min(
                      45,
                      Math.max(0, Number(e.target.value) || 0),
                    );
                    setCropSides((s) => ({ ...s, [side]: v }));
                  }}
                />
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCropSides({ top: 0, right: 0, bottom: 0, left: 0 });
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setImageCropOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={applyImageCrop}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
