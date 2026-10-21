"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { sizeFor } from "./layout";
import { renderAd, type RenderInput } from "./render";

/**
 * A creative drawn on a canvas at the size it's shown (device pixels), redrawn when its input
 * changes. `lazy` waits until the card scrolls near the viewport (the Ads grid can hold hundreds).
 */
export function AdCanvas({ input, className, lazy, label }: { input: RenderInput; className?: string; lazy?: boolean; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [width, setWidth] = useState(0);
  const key = JSON.stringify(input);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    let io: IntersectionObserver | null = null;
    if (lazy) {
      io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "400px" });
      io.observe(el);
    }
    return () => {
      ro.disconnect();
      io?.disconnect();
    };
  }, [lazy]);
  useEffect(() => {
    if (!visible || !width || !canvas.current) return;
    let live = true;
    const c = canvas.current;
    const scale = (width * Math.min(2, window.devicePixelRatio || 1)) / sizeFor(input.ratio).w;
    const off = document.createElement("canvas");
    void renderAd(off, input, scale).then(() => {
      if (!live) return;
      c.width = off.width;
      c.height = off.height;
      c.getContext("2d")?.drawImage(off, 0, 0);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible, width]);
  const { w, h } = sizeFor(input.ratio);
  return (
    <div ref={box} className={cn("relative w-full overflow-hidden bg-muted", className)} style={{ aspectRatio: `${w} / ${h}` }}>
      <canvas ref={canvas} role="img" aria-label={label} className="absolute inset-0 size-full" />
    </div>
  );
}
