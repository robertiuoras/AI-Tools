import { supabaseAdmin } from "@/lib/supabase";

/**
 * Helpers for the note_version table (history + revert for shared notes).
 */

const SNAPSHOT_DEDUP_MS = 10 * 60_000;
const SNAPSHOT_RETENTION_MS = 2 * 60 * 60_000;

export interface NoteVersionRow {
  id: string;
  note_id: string;
  author_id: string | null;
  title: string;
  content: string;
  created_at: string;
}

/**
 * Snapshot the current note state, deduped to one row per 10 minutes. We dedupe
 * by checking the most recent version for this note: if it was written less
 * than ~10 minutes ago, we update it in place instead of inserting (keeps history
 * meaningful — long typing sessions become periodic backups, not 1/keystroke).
 *
 * We also prune backups older than the rolling retention window (2 hours),
 * so users always have recent recovery points without unbounded growth.
 */
export async function snapshotNoteVersion(params: {
  noteId: string;
  authorId: string | null;
  title: string;
  content: string;
}): Promise<void> {
  const admin = supabaseAdmin as any;
  const { noteId, authorId, title, content } = params;

  const { data: latest } = await admin
    .from("note_version")
    .select("id, created_at")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = Date.now();
  const retentionCutoffIso = new Date(now - SNAPSHOT_RETENTION_MS).toISOString();
  const latestAt = latest?.created_at
    ? new Date(latest.created_at).getTime()
    : 0;

  if (latest?.id && now - latestAt < SNAPSHOT_DEDUP_MS) {
    // Update the existing minute-bucket snapshot in place — keeps the
    // history list at most ~1 row per minute even during heavy typing.
    await admin
      .from("note_version")
      .update({ title, content, author_id: authorId, created_at: new Date(now).toISOString() })
      .eq("id", latest.id);
    return;
  }

  await admin.from("note_version").insert([
    { note_id: noteId, author_id: authorId, title, content },
  ]);

  // Keep a bounded rolling history window for this note.
  await admin
    .from("note_version")
    .delete()
    .eq("note_id", noteId)
    .lt("created_at", retentionCutoffIso);
}
