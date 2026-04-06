export type Reminder = {
  id: string;
  title: string;
  /** ISO 8601 — next renewal / due moment */
  renewalAt: string;
  /** Optional note (e.g. plan name) */
  note?: string;
  /** Notify this many hours before renewalAt (default 24) */
  notifyBeforeHours: number;
  createdAt: string;
};

const STORAGE_KEY = "ai-tools-reminders-v1";

function safeParse(json: string | null): Reminder[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is Reminder =>
        r &&
        typeof r === "object" &&
        typeof (r as Reminder).id === "string" &&
        typeof (r as Reminder).title === "string" &&
        typeof (r as Reminder).renewalAt === "string",
    );
  } catch {
    return [];
  }
}

export function loadReminders(): Reminder[] {
  if (typeof window === "undefined") return [];
  try {
    return safeParse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveReminders(reminders: Reminder[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
  } catch {
    /* ignore quota */
  }
}

export function newReminderId(): string {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Milliseconds until renewal (negative if past). */
export function msUntilRenewal(renewalAtIso: string, nowMs = Date.now()): number {
  const t = new Date(renewalAtIso).getTime();
  if (Number.isNaN(t)) return 0;
  return t - nowMs;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "Due now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
