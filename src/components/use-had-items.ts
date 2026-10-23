"use client";

import { createElement, useEffect, useLayoutEffect } from "react";

/*
 * How many items a list had the last time this browser loaded it (capped, 0 for none), so its
 * loading state can take the shape that's coming (that many skeletons, or the empty state) instead
 * of a guess swapped for something of another height. The answer lives in localStorage and, for CSS,
 * in a `data-had-<name>="<count>"` attribute on <html> (absent for none), set before the first paint
 * by <HadItemsScript> (the server's shell renders both shapes; a class like
 * `[html[data-had-home-recent]_&]:block` or `[html[data-had-cinema-projects='1']_&]:grid` picks one).
 * A browser that has never loaded the list gets the "empty" shape.
 */

const storageKey = (name: string) => `fuobe:had:${name}`;
const attr = (name: string) => `data-had-${name}`;

/** A stored count as the attribute's value: "1"… for some, null for none (or anything unexpected). */
export function hadValue(stored: string | null): string | null {
  return stored && /^[1-9][0-9]?$/.test(stored) ? stored : null;
}

function apply(name: string, value: string | null) {
  if (value) document.documentElement.setAttribute(attr(name), value);
  else document.documentElement.removeAttribute(attr(name));
}

/** The pre-paint script's text (exported for tests): hadValue, inlined. */
export function hadItemsScript(name: string): string {
  return `(function(){try{var v=localStorage.getItem(${JSON.stringify(storageKey(name))});if(v&&/^[1-9][0-9]?$/.test(v))document.documentElement.setAttribute(${JSON.stringify(attr(name))},v)}catch(e){}})()`;
}

/**
 * Runs while the HTML is parsed, so the remembered shape shows from the first paint. On the client it
 * renders as inert text/plain (React warns about executable scripts it renders itself), like the
 * sidebar's state script; useHadItems covers pages opened by client-side navigation.
 */
export function HadItemsScript({ name }: { name: string }) {
  return createElement("script", {
    type: typeof window === "undefined" ? "text/javascript" : "text/plain",
    suppressHydrationWarning: true,
    dangerouslySetInnerHTML: { __html: hadItemsScript(name) },
  });
}

/**
 * Remember how many the list had (`count`, undefined while it loads), up to `max` (1: just whether it
 * had any), and keep <html>'s attribute in step.
 */
export function useHadItems(name: string, count: number | undefined, max = 1) {
  useLayoutEffect(() => {
    try {
      apply(name, hadValue(localStorage.getItem(storageKey(name))));
    } catch {}
  }, [name]);
  useEffect(() => {
    if (count === undefined) return;
    const value = String(Math.max(0, Math.min(count, max, 99)));
    try {
      localStorage.setItem(storageKey(name), value);
    } catch {}
    apply(name, hadValue(value));
  }, [name, count, max]);
}
