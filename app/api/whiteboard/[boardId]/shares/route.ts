import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserId } from "@/lib/notes-auth";
import { resolveWhiteboardAccess } from "@/lib/whiteboard-auth";
import { createNotification } from "@/lib/notifications";
import { sendEmail, escapeHtml } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * GET  /api/whiteboard/:boardId/shares
 *   → list all shares for a board (owner only).
 *
 * POST /api/whiteboard/:boardId/shares
 *   → share a board with another user by email.
 *   Body: { email: string, permission?: "view" | "edit", boardName?: string }
 */

interface ShareRow {
  id: string;
  board_id: string;
  owner_id: string;
  shared_with_id: string;
  board_name: string | null;
  permission: "view" | "edit";
  created_at: string;
  updated_at: string;
}

async function lookupBoardName(
  ownerId: string,
  boardId: string,
): Promise<string | null> {
  const admin = supabaseAdmin as any;
  try {
    const { data } = await admin.storage
      .from("user-whiteboard")
      .download(`${ownerId}/__boards__.json`);
    if (!data) return null;
    const text = await (data as Blob).text();
    const parsed = JSON.parse(text) as Array<{ id: string; name: string }>;
    if (!Array.isArray(parsed)) return null;
    return parsed.find((b) => b.id === boardId)?.name ?? null;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { boardId } = await params;

    const access = await resolveWhiteboardAccess(userId, boardId, userId);
    if (access.kind !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = supabaseAdmin as any;
    const { data: shares, error } = await admin
      .from("whiteboard_share")
      .select(
        "id, board_id, owner_id, shared_with_id, board_name, permission, created_at, updated_at",
      )
      .eq("board_id", boardId)
      .eq("owner_id", userId)
      .order("created_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const recipientIds = Array.from(
      new Set((shares ?? []).map((s: ShareRow) => s.shared_with_id)),
    );
    const userMap = new Map<
      string,
      { id: string; email: string; name: string | null; avatar_url: string | null }
    >();
    if (recipientIds.length > 0) {
      const { data: users } = await admin
        .from("user")
        .select("id, email, name, avatar_url")
        .in("id", recipientIds);
      for (const u of users ?? []) userMap.set(u.id, u);
    }

    const enriched = (shares ?? []).map((s: ShareRow) => ({
      ...s,
      sharedWith: userMap.get(s.shared_with_id) ?? null,
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
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { boardId } = await params;
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const permission =
      body?.permission === "edit" ? "edit" : "view";
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const access = await resolveWhiteboardAccess(userId, boardId, userId);
    if (access.kind !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can share" },
        { status: 403 },
      );
    }

    const admin = supabaseAdmin as any;
    const { data: targetUser, error: findErr } = await admin
      .from("user")
      .select("id, email, name, avatar_url")
      .ilike("email", email)
      .maybeSingle();
    if (findErr) {
      return NextResponse.json({ error: findErr.message }, { status: 500 });
    }
    if (!targetUser) {
      return NextResponse.json(
        { error: "No account found for that email" },
        { status: 404 },
      );
    }
    if (targetUser.id === userId) {
      return NextResponse.json(
        { error: "You can't share a board with yourself" },
        { status: 400 },
      );
    }

    const boardName =
      (typeof body?.boardName === "string" && body.boardName.trim()) ||
      (await lookupBoardName(userId, boardId)) ||
      "Untitled board";

    const { data: existing } = await admin
      .from("whiteboard_share")
      .select("id")
      .eq("board_id", boardId)
      .eq("shared_with_id", targetUser.id)
      .maybeSingle();

    let row: ShareRow;
    if (existing?.id) {
      const { data, error } = await admin
        .from("whiteboard_share")
        .update({ permission, board_name: boardName })
        .eq("id", existing.id)
        .select(
          "id, board_id, owner_id, shared_with_id, board_name, permission, created_at, updated_at",
        )
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      row = data;
    } else {
      const { data, error } = await admin
        .from("whiteboard_share")
        .insert([
          {
            board_id: boardId,
            owner_id: userId,
            shared_with_id: targetUser.id,
            board_name: boardName,
            permission,
          },
        ])
        .select(
          "id, board_id, owner_id, shared_with_id, board_name, permission, created_at, updated_at",
        )
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      row = data;
    }

    void notifyWhiteboardShare({
      boardId,
      boardName,
      ownerId: userId,
      recipient: targetUser,
      permission,
      isNew: !existing?.id,
      requestOrigin: request.nextUrl.origin,
    }).catch((e) =>
      console.error("[whiteboard-share] notify failed:", e),
    );

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

interface NotifyParams {
  boardId: string;
  boardName: string;
  ownerId: string;
  recipient: { id: string; email: string; name: string | null };
  permission: "view" | "edit";
  isNew: boolean;
  requestOrigin: string;
}

async function notifyWhiteboardShare(p: NotifyParams): Promise<void> {
  const admin = supabaseAdmin as any;
  const { data: ownerRow } = await admin
    .from("user")
    .select("id, email, name")
    .eq("id", p.ownerId)
    .maybeSingle();
  const ownerName = ownerRow?.name || ownerRow?.email || "Someone";
  const recipientName = p.recipient.name || p.recipient.email.split("@")[0];

  // Notes live at /notes — point recipients at the whiteboard sub-view
  // and pass the board+owner so WhiteboardPanel auto-selects it.
  const link = `${p.requestOrigin}/notes?tab=whiteboard&board=${encodeURIComponent(p.boardId)}&owner=${encodeURIComponent(p.ownerId)}`;
  const verb = p.isNew ? "shared" : "updated permissions on";
  const permLabel = p.permission === "edit" ? "view + edit" : "view-only";

  await createNotification({
    userId: p.recipient.id,
    type: p.isNew ? "whiteboard_shared" : "whiteboard_share_permission_changed",
    title: p.isNew
      ? `${ownerName} shared a whiteboard with you`
      : `${ownerName} updated your whiteboard access`,
    body: `"${p.boardName}" — ${permLabel}`,
    link,
    payload: {
      boardId: p.boardId,
      ownerId: p.ownerId,
      ownerEmail: ownerRow?.email ?? null,
      permission: p.permission,
    },
  });

  if (!p.recipient.email) return;

  const safeOwner = escapeHtml(ownerName);
  const safeName = escapeHtml(p.boardName);
  const safeRecipient = escapeHtml(recipientName);
  const subject = p.isNew
    ? `${ownerName} shared a whiteboard with you on AI Tools`
    : `${ownerName} updated your access to a shared whiteboard`;

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background:#fafafa;">
      <div style="background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; padding:28px;">
        <h1 style="margin:0 0 8px; font-size:20px; color:#0f172a;">Hi ${safeRecipient},</h1>
        <p style="margin:0 0 16px; color:#334155; line-height:1.55;">
          <strong>${safeOwner}</strong> ${verb} the whiteboard
          <strong>"${safeName}"</strong> with you (${escapeHtml(permLabel)}).
        </p>
        <p style="margin:24px 0;">
          <a href="${link}" style="display:inline-block; padding:11px 22px; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#ffffff; text-decoration:none; border-radius:10px; font-weight:600;">
            Open the shared whiteboard
          </a>
        </p>
        <p style="margin:24px 0 0; color:#64748b; font-size:12px; line-height:1.55;">
          You're receiving this because someone shared a whiteboard with the
          email ${escapeHtml(p.recipient.email)} on AI Tools. If you didn't
          expect this, you can safely ignore the email.
        </p>
      </div>
    </div>
  `;

  await sendEmail({
    to: p.recipient.email,
    subject,
    html,
    text: `${ownerName} ${verb} the whiteboard "${p.boardName}" with you (${permLabel}).\n\nOpen it: ${link}`,
    ...(ownerRow?.email ? { replyTo: ownerRow.email as string } : {}),
  });
}
