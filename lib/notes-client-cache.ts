import type { Note, NotePage } from "@/lib/supabase";

const BOOT_PREFIX = "ai-notes-bootstrap-v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — refresh after that

export type NotesBootstrapPayload = {
  pages: NotePage[];
  notes: Note[];
  initialPageId: string | null;
};

type StoredBootstrap = {
  storedAt: number;
  payload: NotesBootstrapPayload;
};

export function readNotesBootstrapFromSession(
  userId: string,
): NotesBootstrapPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${BOOT_PREFIX}:${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBootstrap;
    if (
      !parsed?.payload ||
      !Array.isArray(parsed.payload.pages) ||
      typeof parsed.storedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.storedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(`${BOOT_PREFIX}:${userId}`);
      return null;
    }
    return parsed.payload;
  } catch {
    return null;
  }
}

export function writeNotesBootstrapToSession(
  userId: string,
  payload: NotesBootstrapPayload,
): void {
  try {
    const stored: StoredBootstrap = {
      storedAt: Date.now(),
      payload,
    };
    sessionStorage.setItem(`${BOOT_PREFIX}:${userId}`, JSON.stringify(stored));
  } catch {
    /* quota / private mode */
  }
}

export function clearNotesBootstrapFromSession(userId: string): void {
  try {
    sessionStorage.removeItem(`${BOOT_PREFIX}:${userId}`);
  } catch {
    /* ignore */
  }
}
