"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export function RemindersPanel({ variant = "full" }: Props) {
  const { addToast } = useToast();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [title, setTitle] = useState("");
  const [renewalLocal, setRenewalLocal] = useState("");
  const [note, setNote] = useState("");
  const [notifyHours, setNotifyHours] = useState("24");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setReminders(loadReminders());
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
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
        description: "Notifications are not available in this browser.",
      });
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      addToast({
        title: "Notifications enabled",
        description:
          "We’ll alert you while this site is open. Add this app to your home screen for alerts on your phone (PWA).",
      });
    } else {
      addToast({
        variant: "error",
        title: "Permission denied",
        description: "Enable notifications in your browser settings to use alerts.",
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
      addToast({ variant: "error", title: "Pick a renewal date & time" });
      return;
    }
    const d = new Date(renewalLocal);
    if (Number.isNaN(d.getTime())) {
      addToast({ variant: "error", title: "Invalid date" });
      return;
    }
    const h = Math.max(0, Math.min(168, Number(notifyHours) || 24));
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
    addToast({ title: "Reminder saved", description: "Stored on this device only." });
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
        "space-y-6",
        embedded ? "rounded-xl border bg-card p-4" : "",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className={cn(
              "font-semibold text-foreground",
              embedded ? "text-lg" : "text-xl",
            )}
          >
            Renewals & reminders
          </h2>
          <p className="text-sm text-muted-foreground">
            Track memberships and billing dates. Data stays in this browser
            until you clear site data.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={requestNotify}>
            {typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted" ? (
              <>
                <Bell className="mr-1.5 h-4 w-4" />
                Alerts on
              </>
            ) : (
              <>
                <BellOff className="mr-1.5 h-4 w-4" />
                Enable web alerts
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-4">
        <p className="mb-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Phone:</strong> install this site to your
          home screen (Share → Add to Home Screen / Install app) and allow
          notifications. Alerts fire while the site is open; background push
          when the app is fully closed needs a future server feature.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rem-title">Title</Label>
            <Input
              id="rem-title"
              placeholder="e.g. ChatGPT Plus"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-when">Next renewal</Label>
            <Input
              id="rem-when"
              type="datetime-local"
              value={renewalLocal}
              onChange={(e) => setRenewalLocal(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rem-note">Note (optional)</Label>
            <Input
              id="rem-note"
              placeholder="Plan details, card, etc."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-hours">Notify before (hours)</Label>
            <Input
              id="rem-hours"
              type="number"
              min={0}
              max={168}
              value={notifyHours}
              onChange={(e) => setNotifyHours(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={addReminder} className="w-full sm:w-auto">
              <Plus className="mr-1.5 h-4 w-4" />
              Add reminder
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Upcoming</h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders yet.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((r) => {
              const ms = msUntilRenewal(r.renewalAt, now);
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{r.title}</p>
                    {r.note ? (
                      <p className="text-xs text-muted-foreground">{r.note}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Renews{" "}
                      {new Date(r.renewalAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p
                        className={cn(
                          "font-mono text-lg tabular-nums",
                          ms <= 0 ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {formatCountdown(ms)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        alert {r.notifyBeforeHours ?? 24}h before
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      title="Remove"
                      onClick={() => remove(r.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
