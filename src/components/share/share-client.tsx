"use client";

import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyWithToast } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/** "Recreate in your Fuobe": copies the prompt, to paste into a studio with the same model. */
export function RecreateButton({ prompt, model, className }: { prompt: string; model: string; className?: string }) {
  return (
    <Button
      size="sm"
      className={cn("rounded-full", className)}
      onClick={() => void copyWithToast(prompt, `Prompt copied: paste it into a Fuobe studio with ${model}`)}
      aria-label={`Recreate in your Fuobe: copy the prompt (made with ${model})`}
    >
      <Copy /> Recreate in your Fuobe
    </Button>
  );
}

/** Slides in a scroll-snap track: swipe, scroll, the arrow buttons or the arrow keys; "3 / 8" says where you are. */
export function Carousel({ count, labels, children }: { count: number; labels: string[]; children: React.ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const go = useCallback(
    (i: number) => {
      const el = track.current;
      if (!el) return;
      const next = Math.max(0, Math.min(count - 1, i));
      el.scrollTo({ left: next * el.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setAt(next);
    },
    [count],
  );
  return (
    <section aria-roledescription="carousel" aria-label="Pieces" className="min-w-0">
      <div
        ref={track}
        tabIndex={0}
        aria-live="polite"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            go(at + (e.key === "ArrowRight" ? 1 : -1));
          }
        }}
        className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </div>
      {count > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" className="rounded-full" onClick={() => go(at - 1)} disabled={at <= 0} aria-label="Previous">
            <ChevronLeft />
          </Button>
          <p className="min-w-16 text-center font-mono text-[12px] text-muted-foreground tabular-nums" aria-label={`${labels[at] ?? ""}, ${at + 1} of ${count}`}>
            {at + 1} / {count}
          </p>
          <Button variant="outline" size="icon" className="rounded-full" onClick={() => go(at + 1)} disabled={at >= count - 1} aria-label="Next">
            <ChevronRight />
          </Button>
        </div>
      )}
    </section>
  );
}
