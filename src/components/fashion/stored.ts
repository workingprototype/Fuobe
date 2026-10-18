"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A small localStorage-backed value that survives reloads (a wizard's progress). The server and the
 * first client render see `initial`, so hydration matches; the saved value arrives right after.
 */
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
/** Values that couldn't be saved (private mode, full storage) live here for this page's life. */
const memory = new Map<string, unknown>();

function read<T>(key: string, initial: T): T {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = localStorage.getItem(key);
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.value as T;
    const value = raw ? ({ ...initial, ...(JSON.parse(raw) as T) } as T) : initial;
    cache.set(key, { raw, value });
    return value;
  } catch {
    return initial;
  }
}

function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the state just won't survive a reload.
    memory.set(key, value);
  }
  listeners.get(key)?.forEach((l) => l());
}

export function useStoredReducer<S, A>(key: string, reducer: (s: S, a: A) => S, initial: S): [S, (a: A) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(cb);
      listeners.set(key, set);
      const onStorage = (e: StorageEvent) => e.key === key && cb();
      window.addEventListener("storage", onStorage);
      return () => {
        set.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => read(key, initial),
    () => initial,
  );
  const dispatch = useCallback(
    (a: A) => {
      const next = reducer(read(key, initial), a);
      write(key, next);
    },
    [key, reducer, initial],
  );
  return [state, dispatch];
}
