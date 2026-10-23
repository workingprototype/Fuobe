"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Browser notifications are opt-in and per browser: the choice lives in localStorage (the site's
 * permission is the browser's anyway). Settings → Notifications and the one-time offer use this.
 */
const ENABLED_KEY = "fuobe.notifications";
const ASKED_KEY = "fuobe.notifications.asked";

export type Permission = NotificationPermission | "unsupported";

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
  changed();
}

/** The site's notification permission; "unsupported" without the API (plain http on a LAN address, some browsers). */
export function notificationPermission(): Permission {
  if (typeof window === "undefined" || typeof Notification === "undefined" || !window.isSecureContext) return "unsupported";
  return Notification.permission;
}

export const notificationsEnabled = () => read(ENABLED_KEY) === "on" && notificationPermission() === "granted";

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

const snapshot = () => `${read(ENABLED_KEY) ?? ""}|${read(ASKED_KEY) ?? ""}|${notificationPermission()}`;

/** Notification preferences for this browser, kept in sync across tabs and with the site permission. */
export function useNotificationPrefs() {
  const snap = useSyncExternalStore(subscribe, snapshot, () => "||unsupported");
  const [on, asked, permission] = snap.split("|") as [string, string, Permission];
  // The permission changes in the browser's own UI too.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    navigator.permissions
      ?.query({ name: "notifications" })
      .then((s) => {
        status = s;
        s.onchange = changed;
      })
      .catch(() => {});
    return () => {
      if (status) status.onchange = null;
    };
  }, []);
  /** Turn notifications on (asking the browser first when it hasn't been asked) or off. Resolves to whether they're on. */
  const setEnabled = useCallback(async (v: boolean): Promise<boolean> => {
    write(ASKED_KEY, "1");
    if (!v) {
      write(ENABLED_KEY, "off");
      return false;
    }
    let p = notificationPermission();
    if (p === "default") p = await Notification.requestPermission();
    write(ENABLED_KEY, p === "granted" ? "on" : "off");
    return p === "granted";
  }, []);
  const markAsked = useCallback(() => write(ASKED_KEY, "1"), []);
  return { enabled: on === "on" && permission === "granted", asked: asked === "1", permission, setEnabled, markAsked };
}
