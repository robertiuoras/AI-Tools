"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Plus, Trash2, Clock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import {
  formatCountdown,
  loadReminders,
  msUntilRenewal,
  newReminderId,
  saveReminders,
  type Reminder,
} from "@/lib/reminders";
import { useReminderNotifications } from "@/hooks/useReminderNotifications";
import { cn } from "@/lib/utils";

type Props = {
  /** Tighter layout when embedded on Projects */
  variant?: "full" | "embedded";
};

const QUICK_NOTIFY_OPTIONS = [
  { label: "1h", hours: 1 },
  { label: "12h", hours: 12 },
  { label: "1d", hours: 24 },
  { label: "3d", hours: 72 },
  { label: "1w", hours: 168 },
];

/**
 * Reminders panel — minimalist redesign.
 *
 * The previous version stacked two redundant blurbs ("data stays in browser",
 * "Phone: install this site…") above a 2-column grid. The new layout collapses
 * the form to a single tidy row with progressive disclosure for the optional
 * note + custom alert window — closer to a quick-add control than a full form.
 */
export function RemindersPanel({ variant = "full" }: Props) {
  const { addToast } = useToast();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [title, setTitle] = useState("");
  const [renewalLocal, setRenewalLocal] = useState("");
  const [note, setNote] = useState("");
  const [notifyHours, setNotifyHours] = useState(24);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [notificationPerm, setNotificationPerm] =
    useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setReminders(loadReminders());
  }, []);

  // Keep countdowns ticking but don't burn a frame every second — once a
  // reminder is more than a minute away, second-precision is just noise.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPerm("unsupported");
      return;
    }
    setNotificationPerm(Notification.permission);
  }, []);

  useReminderNotifications(reminders);

  const sorted = useMemo(
    () =>
      [...reminders].sort(
        (a, b) =>
          new Date(a.renewalAt).getTime() - new Date(b.renewalAt).getTime(),
      ),
    [reminders],
  );

  const persist = useCallback((next: Reminder[]) => {
    setReminders(next);
    saveReminders(next);
  }, []);

  const requestNotify = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      addToast({
        variant: "error",
        title: "Not supported",
        description: "Notifications aren't available in this browser.",
      });
      return;
    }
    const perm = await Notification.requestPermission();
    setNotificationPerm(perm);
    if (perm === "granted") {
      addToast({ title: "Alerts on", description: "We'll notify you while this site is open." });
    } else {
      addToast({
        variant: "error",
        title: "Permission denied",
        description: "Enable notifications in browser settings to use alerts.",
      });
    }
  }, [addToast]);

  const addReminder = useCallback(() => {
    const t = title.trim();
    if (!t) {
      addToast({ variant: "error", title: "Add a title" });
      return;
    }
    if (!renewalLocal) {
      addToast({ variant: "error", title: "Pick a date & time" });
      return;
    }
    const d = new Date(renewalLocal);
    if (Number.isNaN(d.getTime())) {
      addToast({ variant: "error", title: "Invalid date" });
      return;
    }
    const h = Math.max(0, Math.min(168, notifyHours || 24));
    const r: Reminder = {
      id: newReminderId(),
      title: t,
      renewalAt: d.toISOString(),
      note: note.trim() || undefined,
      notifyBeforeHours: h,
      createdAt: new Date().toISOString(),
    };
    persist([...reminders, r]);
    setTitle("");
    setRenewalLocal("");
    setNote("");
    setShowAdvanced(false);
    addToast({ title: "Saved", description: "Reminder added." });
  }, [title, renewalLocal, note, notifyHours, reminders, persist, addToast]);

  const remove = useCallback(
    (id: string) => {
      persist(reminders.filter((x) => x.id !== id));
    },
    [reminders, persist],
  );

  const embedded = variant === "embedded";

  return (
    <div
      className={cn(
        "space-y-5",
        embedded && "rounded-xl border bg-card p-4",
      )}
    >
      {/* Header — single line, no marketing copy */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2
            className={cn(
              "font-semibold tracking-tight text-foreground",
              embedded ? "text-base" : "text-lg",
            )}
          >
            Reminders
          </h2>
          <p className="text-xs text-muted-foreground">
            {sorted.length === 0
              ? "Stored in this browser"
              : `${sorted.length} upcoming`}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 gap-1.5 px-2 text-xs",
            notificationPerm === "granted"
              ? "text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={requestNotify}
          disabled={notificationPerm === "unsupported"}
          title={
            notificationPerm === "granted"
              ? "Notifications enabled"
              : "Enable browser notifications"
          }
        >
          {notificationPerm === "granted" ? (
            <Bell className="h-3.5 w-3.5" />
          ) : (
            <BellOff className="h-3.5 w-3.5" />
          )}
          {notificationPerm === "granted" ? "Alerts on" : "Enable alerts"}
        </Button>
      </div>

      {/* Quick-add — single compact row */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-3 transition-colors focus-within:border-primary/40 focus-within:bg-card">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto]">
          <Input
            id="rem-title"
            placeholder="What renews? (e.g. ChatGPT Plus)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim() && renewalLocal) {
                e.preventDefault();
                addReminder();
              }
            }}
            className="h-9 border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
          />
          <Input
            id="rem-when"
            type="datetime-local"
            value={renewalLocal}
            onChange={(e) => setRenewalLocal(e.target.value)}
            className="h-9 border-border/40 bg-background/60 text-sm sm:w-[200px]"
          />
          <Button
            type="button"
            size="sm"
            onClick={addReminder}
            disabled={!title.trim() || !renewalLocal}
            className="h-9 gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        {/* Advanced (collapsed by default) */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              showAdvanced && "rotate-180",
            )}
          />
          {showAdvanced ? "Hide" : "Add note · alert window"}
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
            <Input
              id="rem-note"
              placeholder="Note (plan details, card last 4, etc.)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-8 text-sm"
            />
            <div>
              <p className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3 w-3" />
                Alert me
              </p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_NOTIFY_OPTIONS.map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    onClick={() => setNotifyHours(opt.hours)}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                      notifyHours === opt.hours
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {opt.label} before
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* List */}
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No reminders yet — add your first above.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/50">
          {sorted.map((r) => {
            const ms = msUntilRenewal(r.renewalAt, now);
            const overdue = ms <= 0;
            const soon = !overdue && ms < 24 * 60 * 60 * 1000;
            return (
              <li
                key={r.id}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40",
                  overdue && "bg-destructive/5",
                )}
              >
                <div
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    overdue
                      ? "bg-destructive"
                      : soon
                        ? "bg-amber-500"
                        : "bg-emerald-500",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {r.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(r.renewalAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-mono text-xs tabular-nums",
                    overdue
                      ? "text-destructive"
                      : soon
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                  )}
                >
                  {formatCountdown(ms)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  title="Remove"
                  onClick={() => remove(r.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
