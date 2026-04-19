import { supabaseAdmin } from "@/lib/supabase";

/**
 * Server-side notification helpers. All inserts go through the service-role
 * client so we can write notifications for OTHER users (e.g. when User A
 * shares a note with User B, we need to insert a row for User B).
 */

export type NotificationType =
  | "note_shared"
  | "note_unshared"
  | "note_share_permission_changed";

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  payload?: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export async function createNotification(
  params: CreateNotificationParams,
): Promise<NotificationRow | null> {
  const admin = supabaseAdmin as any;
  const { data, error } = await admin
    .from("notification")
    .insert([
      {
        user_id: params.userId,
        type: params.type,
        title: params.title,
        body: params.body ?? null,
        link: params.link ?? null,
        payload: params.payload ?? null,
      },
    ])
    .select("id, user_id, type, title, body, link, payload, is_read, created_at")
    .single();
  if (error) {
    console.error("[notifications] insert failed:", error);
    return null;
  }
  return data as NotificationRow;
}
