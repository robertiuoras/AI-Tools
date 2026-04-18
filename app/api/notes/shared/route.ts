import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId } from "@/lib/notes-auth";

/**
 * GET /api/notes/shared
 * Returns notes that have been shared WITH the current user. Each note is
 * augmented with the share permission and the owner's display info.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = supabaseAdmin as any;
    const { data: shares, error } = await admin
      .from("note_share")
      .select("id, noteId, ownerId, permission, createdAt, updatedAt")
      .eq("sharedWithId", userId)
      .order("updatedAt", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (!shares || shares.length === 0) return NextResponse.json([]);

    const noteIds = shares.map((s: { noteId: string }) => s.noteId);
    const ownerIds = Array.from(new Set(shares.map((s: { ownerId: string }) => s.ownerId)));

    const [{ data: notes }, { data: owners }] = await Promise.all([
      admin.from("note").select("*").in("id", noteIds),
      admin.from("user").select("id, email, name").in("id", ownerIds),
    ]);

    const noteMap = new Map<string, any>((notes ?? []).map((n: any) => [n.id, n]));
    const ownerMap = new Map<string, any>((owners ?? []).map((u: any) => [u.id, u]));

    const enriched = shares
      .map((s: any) => {
        const note = noteMap.get(s.noteId);
        if (!note) return null;
        const owner = ownerMap.get(s.ownerId) ?? null;
        return {
          shareId: s.id,
          permission: s.permission,
          sharedAt: s.updatedAt ?? s.createdAt,
          owner,
          note,
        };
      })
      .filter(Boolean);

    return NextResponse.json(enriched);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
