"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Note, type NotePage } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Star,
  Plus,
  Trash2,
  FileText,
  Save,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { linkifyText } from "@/lib/linkify";

export default function NotesPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pages, setPages] = useState<NotePage[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState("");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
  ) => {
    setSaving(true);
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (!res.ok) return;
    const updated = (await res.json()) as Note;
    setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
    setSaved(true);
  };

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
          <section className="min-w-0 rounded-xl border bg-card p-3 space-y-3">
            <Label className="text-xs text-muted-foreground">Pages</Label>
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
                    "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                    selectedPageId === p.id &&
                      "border-indigo-500 bg-indigo-500/10",
                  )}
                >
                  <button
                    type="button"
                    className="flex-1 text-left truncate"
                    onClick={() => {
                      setSelectedPageId(p.id);
                      setSelectedNoteId(null);
                    }}
                  >
                    {p.title}
                  </button>
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

          <section className="min-w-0 rounded-xl border bg-card p-3 space-y-3">
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
                    "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                    selectedNoteId === n.id &&
                      "border-violet-500 bg-violet-500/10",
                  )}
                >
                  <button
                    type="button"
                    className="flex-1 truncate text-left"
                    onClick={() => setSelectedNoteId(n.id)}
                  >
                    {n.title}
                  </button>
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
                    onClick={() => updateNote(n.id, { favorite: !n.favorite })}
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

          <section className="min-w-0 overflow-hidden rounded-xl border bg-card p-4">
            {selectedNote ? (
              <div className="flex min-w-0 max-w-full flex-col gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Input
                    className="min-w-0 flex-1"
                    value={selectedNote.title}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSaved(false);
                      setNotes((prev) =>
                        prev.map((n) =>
                          n.id === selectedNote.id ? { ...n, title: v } : n,
                        ),
                      );
                    }}
                    onBlur={() =>
                      void updateNote(selectedNote.id, {
                        title: selectedNote.title,
                      })
                    }
                  />
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    title="Copy full note (title + body)"
                    onClick={() =>
                      void copyText(
                        `${selectedNote.title}\n\n${selectedNote.content}`,
                        `editor-all-${selectedNote.id}`,
                      )
                    }
                  >
                    {copiedKey === `editor-all-${selectedNote.id}` ? (
                      <>
                        <Check className="h-4 w-4 mr-1 text-emerald-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-1" />
                        Copy all
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      void updateNote(selectedNote.id, {
                        title: selectedNote.title,
                        content: selectedNote.content,
                      })
                    }
                  >
                    <Save className="h-4 w-4 mr-1" />
                    {saving ? "Saving..." : saved ? "Saved" : "Save"}
                  </Button>
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <Label className="text-xs text-muted-foreground">
                      Editor
                    </Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      title="Copy note body only"
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
                  </div>
                  <textarea
                    className="min-h-[280px] w-full min-w-0 max-w-full resize-y break-words rounded-lg border bg-background px-3 py-2 text-sm [overflow-wrap:anywhere] sm:min-h-[22rem]"
                    value={selectedNote.content}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSaved(false);
                      setNotes((prev) =>
                        prev.map((n) =>
                          n.id === selectedNote.id ? { ...n, content: v } : n,
                        ),
                      );
                    }}
                    onBlur={() =>
                      void updateNote(selectedNote.id, {
                        content: selectedNote.content,
                      })
                    }
                    placeholder="Write your client notes here. Paste links — they’ll be clickable in the preview below."
                  />
                </div>
                <div className="min-w-0 space-y-2 rounded-lg border border-dashed border-border/80 bg-muted/20 p-3">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Preview — clickable links
                  </Label>
                  <div
                    className="min-h-[100px] max-h-[min(50vh,28rem)] min-w-0 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/80 px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere]"
                    aria-live="polite"
                  >
                    {selectedNote.content.trim() ? (
                      linkifyText(selectedNote.content)
                    ) : (
                      <span className="text-muted-foreground italic">
                        Nothing to preview yet.
                      </span>
                    )}
                  </div>
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
