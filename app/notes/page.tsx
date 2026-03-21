"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { linkifyText } from "@/lib/linkify";

const INLINE_TOKEN_RE =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`/g;
const BULLET_LINE_RE = /^(\s*)([-*•])\s+/;
const NUMBERED_LINE_RE = /^(\s*)\d+\.\s+/;

function renderInlineMarkdown(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const re = new RegExp(INLINE_TOKEN_RE);

  let lastIndex = 0;
  let partIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = re.exec(text))) {
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      nodes.push(
        <span key={`t-${partIndex++}`}>{linkifyText(text.slice(lastIndex, matchIndex))}</span>,
      );
    }

    const boldText = match[1];
    const italicText = match[2];
    const underlineText = match[3];
    const strikeText = match[4];
    const codeText = match[5];

    if (typeof boldText === "string") {
      nodes.push(
        <strong key={`b-${partIndex++}`}>{linkifyText(boldText)}</strong>,
      );
    } else if (typeof italicText === "string") {
      nodes.push(
        <em key={`i-${partIndex++}`}>{linkifyText(italicText)}</em>,
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
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(<span key={`t-${partIndex++}`}>{linkifyText(text.slice(lastIndex))}</span>);
  }

  return <>{nodes}</>;
}

function renderPreviewMarkdown(text: string): ReactNode {
  const lines = text.split(/\r?\n/);
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

export default function NotesPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pages, setPages] = useState<NotePage[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingNoteRowId, setEditingNoteRowId] = useState<string | null>(null);
  const [editingMainTitle, setEditingMainTitle] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState("");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;

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

  const loadPages = useCallback(async () => {
    if (!token) return [] as NotePage[];
    const res = await fetch("/api/notes/pages", { headers: authHeaders });
    if (!res.ok) return [] as NotePage[];
    const data = (await res.json()) as NotePage[];
    setPages(data);
    return data;
  }, [token, authHeaders]);

  const loadNotes = useCallback(
    async (pageId: string) => {
      if (!token || !pageId) {
        setNotes([]);
        setSelectedNoteId(null);
        return;
      }
      const res = await fetch(`/api/notes?pageId=${pageId}`, {
        headers: authHeaders,
      });
      if (!res.ok) return;
      const data = (await res.json()) as Note[];
      setNotes(data);
      setSelectedNoteId((prev) => prev ?? data[0]?.id ?? null);
    },
    [token, authHeaders],
  );

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    (async () => {
      const pageData = await loadPages();
      const initialPageId = selectedPageId ?? pageData[0]?.id ?? null;
      setSelectedPageId(initialPageId);
      if (initialPageId) {
        await loadNotes(initialPageId);
      } else {
        setNotes([]);
        setSelectedNoteId(null);
      }
      setLoading(false);
    })();
  }, [token, loadPages, loadNotes]);

  useEffect(() => {
    if (!selectedPageId) return;
    void loadNotes(selectedPageId);
  }, [selectedPageId, loadNotes]);

  useEffect(() => {
    setEditingPageId(null);
  }, [selectedPageId]);

  useEffect(() => {
    if (!selectedNoteId) return;
    setIsEditing(false);
    setMoreToolsOpen(false);
    setEditingMainTitle(false);
    setEditingNoteRowId(null);
  }, [selectedNoteId]);

  const createPage = async () => {
    if (!token) return;
    const title = newPageTitle.trim() || "Untitled Page";
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
    const title = newNoteTitle.trim() || "Untitled Note";
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

  useEffect(() => {
    if (!isEditing || !selectedNoteId) return;
    const id = window.setInterval(() => {
      const n = notesRef.current.find((x) => x.id === selectedNoteId);
      if (n) {
        void updateNoteRef.current(n.id, { content: n.content }, { silent: true });
      }
    }, 4000);
    return () => clearInterval(id);
  }, [isEditing, selectedNoteId]);

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

  const updateEditorContent = useCallback(
    (
      noteId: string,
      newContent: string,
      selection?: { start: number; end: number },
      opts?: { focus?: boolean },
    ) => {
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, content: newContent } : n)));

      const focus = opts?.focus !== false;
      if (!focus) return;

      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        if (selection) ta.setSelectionRange(selection.start, selection.end);
      });
    },
    [],
  );

  const applyBold = useCallback(() => {
    if (!selectedNote) return;
    const ta = textareaRef.current;
    if (!ta) return;

    ta.focus();
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const text = selectedNote.content;

    const before = text.slice(0, start);
    const sel = text.slice(start, end);
    const after = text.slice(end);

    if (start === end) {
      const newText = before + "****" + after;
      updateEditorContent(selectedNote.id, newText, { start: start + 2, end: start + 2 });
      return;
    }

    const newText = before + `**${sel}**` + after;
    updateEditorContent(selectedNote.id, newText, { start: start + 2, end: end + 2 });
  }, [selectedNote, updateEditorContent]);

  const applyItalic = useCallback(() => {
    if (!selectedNote) return;
    const ta = textareaRef.current;
    if (!ta) return;

    ta.focus();
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const text = selectedNote.content;

    const before = text.slice(0, start);
    const sel = text.slice(start, end);
    const after = text.slice(end);

    if (start === end) {
      const newText = before + "**" + after;
      updateEditorContent(selectedNote.id, newText, { start: start + 1, end: start + 1 });
      return;
    }

    const newText = before + `*${sel}*` + after;
    updateEditorContent(selectedNote.id, newText, { start: start + 1, end: end + 1 });
  }, [selectedNote, updateEditorContent]);

  const toggleBullets = useCallback(() => {
    if (!selectedNote) return;
    const ta = textareaRef.current;
    if (!ta) return;

    ta.focus();
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const text = selectedNote.content;

    // No selection: add a bullet at the current line start (preserving indentation).
    if (start === end) {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const currentLine = text.slice(lineStart);
      const indentMatch = currentLine.match(/^(\s*)/);
      const indent = indentMatch?.[1] ?? "";
      const rest = currentLine.slice(indent.length);

      const newText = text.slice(0, lineStart) + indent + "• " + rest;
      const cursor = lineStart + indent.length + 2;
      updateEditorContent(selectedNote.id, newText, { start: cursor, end: cursor });
      return;
    }

    const blockStart = text.lastIndexOf("\n", start - 1) + 1;
    let blockEnd = text.indexOf("\n", end);
    if (blockEnd === -1) blockEnd = text.length;

    const block = text.slice(blockStart, blockEnd);
    const lines = block.split("\n");

    const allBulleted = lines.length > 0 && lines.every((l) => BULLET_LINE_RE.test(l));

    const transformedLines = lines.map((l) => {
      if (allBulleted) {
        // Remove bullet marker, keep indentation.
        return l.replace(BULLET_LINE_RE, "$1");
      }

      const indentMatch = l.match(/^(\s*)/);
      const indent = indentMatch?.[1] ?? "";
      const rest = l.slice(indent.length);
      return `${indent}• ${rest}`;
    });

    const newBlock = transformedLines.join("\n");
    const newText = text.slice(0, blockStart) + newBlock + text.slice(blockEnd);

    updateEditorContent(selectedNote.id, newText, {
      start: blockStart,
      end: blockStart + newBlock.length,
    });
  }, [selectedNote, updateEditorContent]);

  const applyUnderline = useCallback(() => {
    if (!selectedNote) return;
    const ta = textareaRef.current;
    if (!ta) return;

    ta.focus();
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const text = selectedNote.content;

    const before = text.slice(0, start);
    const sel = text.slice(start, end);
    const after = text.slice(end);

    if (start === end) {
      const newText = before + "____" + after;
      updateEditorContent(selectedNote.id, newText, { start: start + 2, end: start + 2 });
      return;
    }

    const newText = before + `__${sel}__` + after;
    updateEditorContent(selectedNote.id, newText, { start: start + 2, end: end + 2 });
  }, [selectedNote, updateEditorContent]);

  const applyStrike = useCallback(() => {
    if (!selectedNote) return;
    const ta = textareaRef.current;
    if (!ta) return;

    ta.focus();
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const text = selectedNote.content;

    const before = text.slice(0, start);
    const sel = text.slice(start, end);
    const after = text.slice(end);

    if (start === end) {
      const newText = before + "~~~~" + after;
      updateEditorContent(selectedNote.id, newText, { start: start + 2, end: start + 2 });
      return;
    }

    const newText = before + `~~${sel}~~` + after;
    updateEditorContent(selectedNote.id, newText, { start: start + 2, end: end + 2 });
  }, [selectedNote, updateEditorContent]);

  const applyCode = useCallback(() => {
    if (!selectedNote) return;
    const ta = textareaRef.current;
    if (!ta) return;

    ta.focus();
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const text = selectedNote.content;

    const before = text.slice(0, start);
    const sel = text.slice(start, end);
    const after = text.slice(end);

    if (start === end) {
      const newText = before + "``" + after;
      updateEditorContent(selectedNote.id, newText, { start: start + 1, end: start + 1 });
      return;
    }

    const newText = before + `\`${sel}\`` + after;
    updateEditorContent(selectedNote.id, newText, { start: start + 1, end: end + 1 });
  }, [selectedNote, updateEditorContent]);

  const toggleNumberedList = useCallback(() => {
    if (!selectedNote) return;
    const ta = textareaRef.current;
    if (!ta) return;

    ta.focus();
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const text = selectedNote.content;

    if (start === end) {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const currentLine = text.slice(lineStart);
      const indentMatch = currentLine.match(/^(\s*)/);
      const indent = indentMatch?.[1] ?? "";
      const rest = currentLine.slice(indent.length);

      const newText = text.slice(0, lineStart) + indent + "1. " + rest;
      const cursor = lineStart + indent.length + 3;
      updateEditorContent(selectedNote.id, newText, { start: cursor, end: cursor });
      return;
    }

    const blockStart = text.lastIndexOf("\n", start - 1) + 1;
    let blockEnd = text.indexOf("\n", end);
    if (blockEnd === -1) blockEnd = text.length;

    const block = text.slice(blockStart, blockEnd);
    const lines = block.split("\n");

    const allNumbered = lines.length > 0 && lines.every((l) => NUMBERED_LINE_RE.test(l));

    const transformedLines = lines.map((l) => {
      if (allNumbered) {
        return l.replace(NUMBERED_LINE_RE, "$1");
      }

      const indentMatch = l.match(/^(\s*)/);
      const indent = indentMatch?.[1] ?? "";
      const rest = l.slice(indent.length);
      return `${indent}1. ${rest}`;
    });

    const newBlock = transformedLines.join("\n");
    const newText = text.slice(0, blockStart) + newBlock + text.slice(blockEnd);

    updateEditorContent(selectedNote.id, newText, {
      start: blockStart,
      end: blockStart + newBlock.length,
    });
  }, [selectedNote, updateEditorContent]);

  const insertHeading = useCallback(() => {
    if (!selectedNote) return;
    const ta = textareaRef.current;
    if (!ta) return;

    ta.focus();
    const start = ta.selectionStart ?? 0;
    const text = selectedNote.content;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const before = text.slice(0, lineStart);
    const after = text.slice(lineStart);
    const newText = before + "## " + after;
    const cursor = lineStart + 3;
    updateEditorContent(selectedNote.id, newText, { start: cursor, end: cursor });
  }, [selectedNote, updateEditorContent]);

  const handleNoteKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || !selectedNote) return;
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start !== end) return;

      const text = selectedNote.content;
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const nextNl = text.indexOf("\n", start);
      const lineEnd = nextNl === -1 ? text.length : nextNl;
      const line = text.slice(lineStart, lineEnd);

      const listMatch = line.match(/^(\s*)(?:[-*•]|\d+\.)\s+(.*)$/);
      if (!listMatch) return;

      const indent = listMatch[1];
      e.preventDefault();
      const insert = `\n${indent}• `;
      const newText = text.slice(0, start) + insert + text.slice(start);
      const newPos = start + insert.length;
      updateEditorContent(selectedNote.id, newText, { start: newPos, end: newPos });
    },
    [selectedNote, updateEditorContent],
  );

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
        <div className="text-muted-foreground">Loading notes...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,320px)_minmax(0,1fr)] lg:items-start">
          <section className="min-w-0 cursor-default rounded-xl border bg-card p-3 space-y-3">
            <Label className="text-xs text-muted-foreground">
              Pages — use ✎ to rename
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="New page title..."
                value={newPageTitle}
                onChange={(e) => setNewPageTitle(e.target.value)}
              />
              <Button type="button" size="icon" onClick={createPage}>
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
            <Label className="text-xs text-muted-foreground">
              Notes — use ✎ to rename
            </Label>
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
                disabled={!selectedPageId}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-1">
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

          <section className="min-w-0 cursor-default overflow-hidden rounded-xl border bg-card p-4">
            {selectedNote ? (
              <div className="flex min-w-0 max-w-full flex-col gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {editingMainTitle ? (
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
                            n.id === selectedNote.id ? { ...n, title: v } : n,
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
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {selectedNote.title}
                      </span>
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
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
                <div className="min-w-0 space-y-2">
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <Label className="text-xs text-muted-foreground">
                      Note body
                    </Label>
                    <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          title="Copy note body"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() =>
                            void copyText(
                              selectedNote.content,
                              `editor-body-${selectedNote.id}`,
                            )
                          }
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
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-9 px-0"
                              title="Bold (**)"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={applyBold}
                            >
                              <span className="font-bold">B</span>
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-9 px-0 italic"
                              title="Italic (*)"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={applyItalic}
                            >
                              I
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-9 px-0 underline"
                              title="Underline (__)"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={applyUnderline}
                            >
                              U
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-9 px-0"
                              title="Bullets (• )"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={toggleBullets}
                            >
                              •
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-xs"
                              title="More tools"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => setMoreToolsOpen((o) => !o)}
                            >
                              More
                              <ChevronDown
                                className={cn(
                                  "h-3.5 w-3.5 transition-transform",
                                  moreToolsOpen && "rotate-180",
                                )}
                              />
                            </Button>
                          </>
                        )}
                      </div>
                      {isEditing && moreToolsOpen && (
                        <div className="flex flex-wrap justify-end gap-1 rounded-md border border-border/80 bg-muted/30 p-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={insertHeading}
                          >
                            Heading
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={toggleNumberedList}
                          >
                            1. List
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs line-through"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={applyStrike}
                          >
                            Strike
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 font-mono text-xs"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={applyCode}
                          >
                            Code
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  {isEditing ? (
                    <textarea
                      className="min-h-[280px] w-full min-w-0 max-w-full cursor-text resize-y break-words rounded-lg border bg-background px-3 py-2 text-sm [overflow-wrap:anywhere] sm:min-h-[22rem]"
                      ref={textareaRef}
                      value={selectedNote.content}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNotes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNote.id ? { ...n, content: v } : n,
                          ),
                        );
                      }}
                      onKeyDown={handleNoteKeyDown}
                      onBlur={(e) => {
                        void updateNote(
                          selectedNote.id,
                          { content: e.target.value },
                          { silent: true },
                        );
                        setIsEditing(false);
                        setMoreToolsOpen(false);
                      }}
                      placeholder="Click outside to save and lock. Auto-saves every few seconds while editing. Use B / I / U / • — More for lists, headings, strike, code."
                    />
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Click to edit note"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setIsEditing(true);
                          requestAnimationFrame(() =>
                            textareaRef.current?.focus(),
                          );
                        }
                      }}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a")) return;
                        setIsEditing(true);
                        requestAnimationFrame(() =>
                          textareaRef.current?.focus(),
                        );
                      }}
                      className="min-h-[280px] w-full min-w-0 max-w-full cursor-pointer select-text overflow-x-hidden overflow-y-auto rounded-lg border bg-background px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere] sm:min-h-[22rem]"
                      aria-live="polite"
                    >
                      {selectedNote.content.trim() ? (
                        renderPreviewMarkdown(selectedNote.content)
                      ) : (
                        <span className="text-muted-foreground italic">
                          Click here to write…
                        </span>
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
    </div>
  );
}
