import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

export function getSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUserId(request: NextRequest): Promise<string | null> {
  const client = getSupabaseClient(request);
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await client.auth.getUser(token);
    if (user) return user.id;
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

export type NoteAccess =
  | { kind: "owner" }
  | { kind: "share"; permission: "view" | "edit" }
  | { kind: "none" };

/**
 * Resolve what access `userId` has to a note. Returns "owner" if the user
 * owns the note, otherwise looks up note_share for an explicit share.
 */
export async function resolveNoteAccess(
  userId: string,
  noteId: string,
): Promise<NoteAccess> {
  const admin = supabaseAdmin as any;
  const { data: note, error } = await admin
    .from("note")
    .select("id, userId")
    .eq("id", noteId)
    .maybeSingle();
  if (error || !note) return { kind: "none" };
  if (note.userId === userId) return { kind: "owner" };
  const { data: share } = await admin
    .from("note_share")
    .select("permission")
    .eq("noteId", noteId)
    .eq("sharedWithId", userId)
    .maybeSingle();
  if (!share) return { kind: "none" };
  return {
    kind: "share",
    permission: share.permission === "edit" ? "edit" : "view",
  };
}
