"use client";

import { useSyncExternalStore } from "react";

/*
 * A shared clock: one setInterval per interval while anything listens (every running tile on the
 * page ticks from the same timer), stopped when the last listener goes.
 */
interface Clock {
  now: number;
  subscribe: (cb: () => void) => () => void;
  read: () => number;
}

const clocks = new Map<number, Clock>();

function clock(ms: number): Clock {
  const known = clocks.get(ms);
  if (known) return known;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const c: Clock = {
    now: Date.now(),
    // One function per clock: a new one each render would make React subscribe again every render.
    subscribe: (cb) => {
      listeners.add(cb);
      if (!timer) {
        // Fresh once subscribed (React reads the time again after subscribing).
        c.now = Date.now();
        timer = setInterval(() => {
          c.now = Date.now();
          listeners.forEach((l) => l());
        }, ms);
      }
      return () => {
        listeners.delete(cb);
        if (!listeners.size && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    read: () => c.now,
  };
  clocks.set(ms, c);
  return c;
}

/** The time now, re-rendering every `ms` while mounted. */
export function useNow(ms = 1000): number {
  const c = clock(ms);
  return useSyncExternalStore(c.subscribe, c.read, c.read);
}
