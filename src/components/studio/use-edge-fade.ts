"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FADE = 24;

/**
 * Fade the edges of a horizontally scrolling row where more content hides (a mask, so it works
 * over any background). Returns a ref for the scroller and the style to put on it.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Chips come and go with the model: watch the content too.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${edges.left ? FADE : 0}px, #000 calc(100% - ${edges.right ? FADE : 0}px), ${edges.right ? "transparent" : "#000"} 100%)`
      : undefined;
  return [ref, mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined] as const;
}
