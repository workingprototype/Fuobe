"use client";

import { useCallback, useSyncExternalStore } from "react";

/** A small id list kept in localStorage and shared live across components and tabs (recent and starred models). */
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; value: string[] }>();
const EMPTY: string[] = [];

function read(key: string): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {}
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value;
  let value = EMPTY;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    value = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : EMPTY;
  } catch {}
  cache.set(key, { raw, value });
  return value;
}

export function writeStoredList(key: string, next: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
  listeners.get(key)?.forEach((l) => l());
}

export function useStoredList(key: string): [string[], (update: (prev: string[]) => string[]) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(cb);
      const onStorage = (e: StorageEvent) => e.key === key && cb();
      window.addEventListener("storage", onStorage);
      return () => {
        set.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => read(key),
    () => EMPTY,
  );
  const update = useCallback((fn: (prev: string[]) => string[]) => writeStoredList(key, fn(read(key))), [key]);
  return [value, update];
}

export const RECENT_MODELS = "fuobe.recentModels";
export const STARRED_MODELS = "fuobe.starredModels";
