"use client";

import { useEffect, useRef } from "react";
import type { Reminder } from "@/lib/reminders";

const CHECK_MS = 45_000;
const FIRED_PREFIX = "reminder-fired:";

function wasAlreadyFired(id: string, fireKey: string): boolean {
  try {
    return sessionStorage.getItem(FIRED_PREFIX + id) === fireKey;
  } catch {
    return false;
  }
}

function markFired(id: string, fireKey: string) {
  try {
    sessionStorage.setItem(FIRED_PREFIX + id, fireKey);
  } catch {
    /* ignore */
  }
}

/**
 * While the tab is open, fires browser notifications when a reminder crosses
 * its alert window (renewal − notifyBeforeHours) or the renewal time itself.
 */
export function useReminderNotifications(reminders: Reminder[]) {
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const tick = () => {
      if (Notification.permission !== "granted") return;
      const now = Date.now();
      for (const r of remindersRef.current) {
        const renewal = new Date(r.renewalAt).getTime();
        if (Number.isNaN(renewal)) continue;
        const hours = r.notifyBeforeHours ?? 24;
        const alertAt = renewal - hours * 3600 * 1000;

        const fireKeys = [
          { t: alertAt, label: "alert" as const },
          { t: renewal, label: "due" as const },
        ];

        for (const { t, label } of fireKeys) {
          if (now < t || now > t + CHECK_MS * 2) continue;
          const fireKey = `${label}:${t}`;
          if (wasAlreadyFired(r.id, fireKey)) continue;
          markFired(r.id, fireKey);
          const title =
            label === "due"
              ? `Due: ${r.title}`
              : `Renewal soon: ${r.title}`;
          const body =
            label === "due"
              ? "This renewal time has been reached."
              : `About ${hours}h before renewal.`;
          try {
            new Notification(title, { body, tag: r.id + label });
          } catch {
            /* ignore */
          }
        }
      }
    };

    tick();
    const id = window.setInterval(tick, CHECK_MS);
    return () => window.clearInterval(id);
  }, []);
}
