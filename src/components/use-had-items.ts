"use client";

import { createElement, useEffect, useLayoutEffect } from "react";

/*
 * Whether a list was non-empty the last time this browser loaded it, so its loading state can take
 * the shape that's coming (a row of skeletons, or the empty state) instead of a guess swapped for
 * something of another height. The answer lives in localStorage and, for CSS, in a `data-had-<name>`
 * attribute on <html>, set before the first paint by <HadItemsScript> (the server's shell renders
 * both shapes; a class like `[html[data-had-home-recent='1']_&]:block` picks one). A browser that has
 * never loaded the list gets the "empty" shape.
 */

const storageKey = (name: string) => `fuobe:had:${name}`;
const attr = (name: string) => `data-had-${name}`;

function apply(name: string, had: boolean) {
  if (had) document.documentElement.setAttribute(attr(name), "1");
  else document.documentElement.removeAttribute(attr(name));
}

/** The pre-paint script's text (exported for tests). */
export function hadItemsScript(name: string): string {
  return `(function(){try{if(localStorage.getItem(${JSON.stringify(storageKey(name))})==="1")document.documentElement.setAttribute(${JSON.stringify(attr(name))},"1")}catch(e){}})()`;
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

/** Remember whether the list (`count`, undefined while it loads) had anything, and keep <html>'s attribute in step. */
export function useHadItems(name: string, count: number | undefined) {
  useLayoutEffect(() => {
    try {
      apply(name, localStorage.getItem(storageKey(name)) === "1");
    } catch {}
  }, [name]);
  useEffect(() => {
    if (count === undefined) return;
    try {
      localStorage.setItem(storageKey(name), count ? "1" : "0");
    } catch {}
    apply(name, count > 0);
  }, [name, count]);
}
