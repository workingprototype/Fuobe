"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Render a long list a page at a time: `first` items up front (and in the server HTML), `page` more
 * whenever the sentinel element nears the viewport or is clicked. Starts over when `resetKey` changes
 * (a new search or filter).
 */
export function useProgressive<T extends HTMLElement = HTMLButtonElement>(total: number, resetKey: string, first = 30, page = 40) {
  const [shown, setShown] = useState(first);
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setShown(first);
  }
  const more = useCallback(() => setShown((n) => n + page), [page]);
  const sentinel = useRef<T>(null);
  const hasMore = shown < total;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, more, shown]);
  return { shown, hasMore, more, sentinel, left: Math.max(0, total - shown) };
}
