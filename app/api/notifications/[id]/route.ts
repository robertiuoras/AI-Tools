import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId } from "@/lib/notes-auth";

/**
 * PATCH /api/notifications/:id  – body: { is_read: boolean }
 * DELETE /api/notifications/:id – delete a single notification.
 *
 * Both are owner-only; we filter on user_id so a user can never touch
 * someone else's row even with a guessed id.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const isRead =
      typeof body?.is_read === "boolean" ? body.is_read : true;

    const admin = supabaseAdmin as any;
    const { data, error } = await admin
      .from("notification")
      .update({ is_read: isRead })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, is_read")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const admin = supabaseAdmin as any;
    const { error } = await admin
      .from("notification")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
