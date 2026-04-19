import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Thin wrapper around Resend so the rest of the app doesn't have to
 * re-implement the "is the API key configured?" branch every time.
 *
 * Required env vars (set in Vercel + .env.local):
 *   RESEND_API_KEY   – your Resend API key (starts with `re_`)
 *   RESEND_FROM      – verified sender, e.g. `AI Tools <noreply@yourdomain.com>`
 *                      Until you verify a domain you can use the Resend
 *                      sandbox: `Acme <onboarding@resend.dev>`
 */

const apiKey = process.env.RESEND_API_KEY ?? "";
const defaultFrom =
  process.env.RESEND_FROM ?? "AI Tools <onboarding@resend.dev>";

const resend = apiKey ? new Resend(apiKey) : null;

export function isEmailConfigured(): boolean {
  return resend !== null;
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Override `RESEND_FROM` for a one-off send. */
  from?: string;
}

/**
 * Sends an email via Resend. NEVER throws — failures are logged so a
 * downed email provider can't break user-facing actions like "share note".
 */
export async function sendEmail(params: SendEmailParams): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
}> {
  if (!resend) {
    console.warn(
      "[email] RESEND_API_KEY not configured; skipping email to",
      params.to,
    );
    return { ok: false, error: "email_not_configured" };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: params.from ?? defaultFrom,
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.text ? { text: params.text } : {}),
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    });
    if (error) {
      console.error("[email] Resend error:", error);
      return { ok: false, error: error.message ?? String(error) };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error("[email] Unexpected send error:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Returns false if the recipient has opted out of share-related emails
 * via Profile settings. Defaults to true (send) when the column is null,
 * the row is missing, or the lookup fails — never block emails because
 * Supabase had a hiccup.
 */
export async function shouldEmailUser(userId: string): Promise<boolean> {
  if (!userId) return true;
  try {
    const admin = supabaseAdmin as any;
    const { data } = await admin
      .from("user")
      .select("email_notifications")
      .eq("id", userId)
      .maybeSingle();
    if (!data) return true;
    return data.email_notifications !== false;
  } catch {
    return true;
  }
}

/** Minimal HTML escaper for interpolating untrusted text into email bodies. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
