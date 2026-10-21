"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pageAfter, progressiveStart, syncProgressive, type ProgressiveState } from "@/lib/progressive";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea';

/**
 * Render a long list a page at a time: `first` items up front (and in the server HTML), `page` more
 * whenever the sentinel element nears the viewport or is clicked. Starts over when `resetKey` changes
 * (a new search or filter).
 *
 * `moreFrom(event, list)` is the click handler for a "Show more" button: pressed from the keyboard,
 * it also moves focus to the first new item in `list` (the button itself may be gone afterwards).
 */
export function useProgressive<T extends HTMLElement = HTMLButtonElement>(total: number, resetKey: string, first = 30, page = 40) {
  const [state, setState] = useState<ProgressiveState>(() => progressiveStart(resetKey, first));
  const synced = syncProgressive(state, resetKey, first);
  if (synced !== state) setState(synced);
  const shown = synced.shown;
  const more = useCallback(() => setState((s) => ({ ...s, shown: pageAfter(s.shown, page) })), [page]);
  const moreFrom = useCallback(
    (e: React.MouseEvent, list: HTMLElement | null) => {
      const from = shown;
      more();
      // A click from Enter/Space has no pointer position (detail 0).
      if (e.detail !== 0 || !list) return;
      requestAnimationFrame(() => {
        const item = list.children[from] as HTMLElement | undefined;
        (item?.matches(FOCUSABLE) ? item : item?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
      });
    },
    [more, shown],
  );
  const sentinel = useRef<T>(null);
  const hasMore = shown < total;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, more, shown]);
  return { shown, hasMore, more, moreFrom, sentinel, left: Math.max(0, total - shown) };
}
