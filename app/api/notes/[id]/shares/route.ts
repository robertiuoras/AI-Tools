import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId, resolveNoteAccess } from "@/lib/notes-auth";
import { createNotification } from "@/lib/notifications";
import { sendEmail, escapeHtml } from "@/lib/email";
import { snapshotNoteVersion } from "@/lib/note-versions";

/**
 * GET  /api/notes/:id/shares — list all shares for a note (owner only).
 * POST /api/notes/:id/shares — share a note with another user by email.
 *   Body: { email: string, permission: "view" | "edit" }
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const access = await resolveNoteAccess(userId, id);
    if (access.kind !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = supabaseAdmin as any;
    const { data: shares, error } = await admin
      .from("note_share")
      .select("id, noteId, ownerId, sharedWithId, permission, createdAt, updatedAt")
      .eq("noteId", id)
      .order("createdAt", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const recipientIds = Array.from(
      new Set((shares ?? []).map((s: { sharedWithId: string }) => s.sharedWithId)),
    );
    let userMap = new Map<string, { id: string; email: string; name: string | null }>();
    if (recipientIds.length > 0) {
      const { data: users } = await admin
        .from("user")
        .select("id, email, name")
        .in("id", recipientIds);
      for (const u of users ?? []) userMap.set(u.id, u);
    }
    const enriched = (shares ?? []).map((s: any) => ({
      ...s,
      sharedWith: userMap.get(s.sharedWithId) ?? null,
    }));
    return NextResponse.json(enriched);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const permission =
      body?.permission === "edit" ? "edit" : body?.permission === "view" ? "view" : "view";
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const access = await resolveNoteAccess(userId, id);
    if (access.kind !== "owner") {
      return NextResponse.json({ error: "Only the owner can share" }, { status: 403 });
    }

    const admin = supabaseAdmin as any;
    const { data: targetUser, error: findErr } = await admin
      .from("user")
      .select("id, email, name")
      .ilike("email", email)
      .maybeSingle();
    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
    if (!targetUser) {
      return NextResponse.json(
        { error: "No account found for that email" },
        { status: 404 },
      );
    }
    if (targetUser.id === userId) {
      return NextResponse.json(
        { error: "You can't share a note with yourself" },
        { status: 400 },
      );
    }

    // Upsert by (noteId, sharedWithId)
    const { data: existing } = await admin
      .from("note_share")
      .select("id")
      .eq("noteId", id)
      .eq("sharedWithId", targetUser.id)
      .maybeSingle();

    let row;
    if (existing?.id) {
      const { data, error } = await admin
        .from("note_share")
        .update({ permission })
        .eq("id", existing.id)
        .select("id, noteId, ownerId, sharedWithId, permission, createdAt, updatedAt")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      row = data;
    } else {
      const { data, error } = await admin
        .from("note_share")
        .insert([
          { noteId: id, ownerId: userId, sharedWithId: targetUser.id, permission },
        ])
        .select("id, noteId, ownerId, sharedWithId, permission, createdAt, updatedAt")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      row = data;
    }

    // Snapshot the note as it stands the moment it becomes shared. This
    // gives the owner an immutable "pre-share baseline" they can revert
    // to if collaboration ever produces an unexpected state. Done only
    // for genuinely new shares (not permission-only updates) so we don't
    // spam the version list. Best-effort — failures don't block the share.
    if (!existing?.id) {
      try {
        const { data: noteRow } = await admin
          .from("note")
          .select("title, content")
          .eq("id", id)
          .single();
        if (noteRow) {
          await snapshotNoteVersion({
            noteId: id,
            authorId: userId,
            title: noteRow.title ?? "Untitled Note",
            content: noteRow.content ?? "",
          });
        }
      } catch (err) {
        console.error("[shares] pre-share snapshot failed", err);
      }
    }

    // Side-effects: in-app notification + email. Both are best-effort —
    // failures are logged but never break the share itself, since the share
    // row is already persisted at this point.
    void notifyShare({
      noteId: id,
      ownerId: userId,
      recipient: targetUser,
      permission,
      isNew: !existing?.id,
      requestOrigin: request.nextUrl.origin,
    }).catch((e) => console.error("[shares] notifyShare failed:", e));

    return NextResponse.json(
      { ...row, sharedWith: targetUser },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

interface NotifyShareParams {
  noteId: string;
  ownerId: string;
  recipient: { id: string; email: string; name: string | null };
  permission: "view" | "edit";
  isNew: boolean;
  requestOrigin: string;
}

async function notifyShare(p: NotifyShareParams): Promise<void> {
  const admin = supabaseAdmin as any;

  const [{ data: ownerRow }, { data: noteRow }] = await Promise.all([
    admin.from("user").select("id, email, name").eq("id", p.ownerId).maybeSingle(),
    admin.from("note").select("id, title").eq("id", p.noteId).maybeSingle(),
  ]);
  const ownerName = ownerRow?.name || ownerRow?.email || "Someone";
  const noteTitle = (noteRow?.title as string | undefined)?.trim() || "an untitled note";
  const recipientName = p.recipient.name || p.recipient.email.split("@")[0];

  const link = `${p.requestOrigin}/notes?note=${encodeURIComponent(p.noteId)}`;
  const verb = p.isNew ? "shared" : "updated permissions on";
  const permLabel = p.permission === "edit" ? "view + edit" : "view-only";

  await createNotification({
    userId: p.recipient.id,
    type: p.isNew ? "note_shared" : "note_share_permission_changed",
    title: p.isNew ? `${ownerName} shared a note with you` : `${ownerName} updated your note access`,
    body: `"${noteTitle}" — ${permLabel}`,
    link,
    payload: {
      noteId: p.noteId,
      ownerId: p.ownerId,
      ownerEmail: ownerRow?.email ?? null,
      permission: p.permission,
    },
  });

  if (!p.recipient.email) return;

  const safeOwner = escapeHtml(ownerName);
  const safeNote = escapeHtml(noteTitle);
  const safeRecipient = escapeHtml(recipientName);
  const subject = p.isNew
    ? `${ownerName} shared a note with you on AI Tools`
    : `${ownerName} updated your access to a shared note`;

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background:#fafafa;">
      <div style="background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; padding:28px;">
        <h1 style="margin:0 0 8px; font-size:20px; color:#0f172a;">Hi ${safeRecipient},</h1>
        <p style="margin:0 0 16px; color:#334155; line-height:1.55;">
          <strong>${safeOwner}</strong> ${verb} the note
          <strong>"${safeNote}"</strong> with you (${escapeHtml(permLabel)}).
        </p>
        <p style="margin:24px 0;">
          <a href="${link}" style="display:inline-block; padding:11px 22px; background:linear-gradient(135deg,#10b981,#0d9488); color:#ffffff; text-decoration:none; border-radius:10px; font-weight:600;">
            Open the shared note
          </a>
        </p>
        <p style="margin:24px 0 0; color:#64748b; font-size:12px; line-height:1.55;">
          You're receiving this because someone shared a note with the email
          ${escapeHtml(p.recipient.email)} on AI Tools. If you didn't expect
          this, you can safely ignore the email.
        </p>
      </div>
    </div>
  `;

  await sendEmail({
    to: p.recipient.email,
    subject,
    html,
    text: `${ownerName} ${verb} the note "${noteTitle}" with you (${permLabel}).\n\nOpen it: ${link}`,
    ...(ownerRow?.email ? { replyTo: ownerRow.email as string } : {}),
  });
}
