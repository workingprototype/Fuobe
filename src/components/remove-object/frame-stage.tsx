"use client";

import { Crosshair, X } from "lucide-react";
import { useRef, useState } from "react";
import type { PixelPoint } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

export interface Frame {
  /** The first frame of the selection as the browser grabbed it (an object URL). */
  url: string;
  width: number;
  height: number;
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/**
 * The selection's first frame with what you marked on it: clicked points (green = remove, grey = keep) or the
 * painted area. In click mode it takes clicks, and the keyboard: arrows move a crosshair (Shift: further),
 * Enter adds a point where it is, Delete takes the last one away.
 */
export function FrameStage({
  frame,
  points,
  onPoints,
  pointLabel,
  overlay,
  clickable,
  maxPoints,
  children,
}: {
  frame: Frame;
  points: PixelPoint[];
  onPoints?: (p: PixelPoint[]) => void;
  /** What a new point marks. */
  pointLabel: "positive" | "negative";
  /** The painted area (the editor's red-tinted copy of the frame). */
  overlay?: string;
  clickable: boolean;
  maxPoints: number;
  children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const add = (x: number, y: number) => {
    if (!onPoints || points.length >= maxPoints) return;
    onPoints([...points, { x: Math.round(x * frame.width), y: Math.round(y * frame.height), label: pointLabel }]);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!clickable) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const c = cursor ?? { x: 0.5, y: 0.5 };
    const move = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
    if (move) {
      e.preventDefault();
      setCursor({ x: Math.min(1, Math.max(0, c.x + move[0])), y: Math.min(1, Math.max(0, c.y + move[1])) });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      add(c.x, c.y);
      setCursor(c);
    } else if ((e.key === "Delete" || e.key === "Backspace") && points.length) {
      e.preventDefault();
      onPoints?.(points.slice(0, -1));
    }
  };
  return (
    <div className="space-y-2">
      <div className="grid place-items-center overflow-hidden rounded-xl bg-media">
        <div
          ref={box}
          tabIndex={clickable ? 0 : -1}
          role={clickable ? "application" : undefined}
          aria-label={
            clickable
              ? `First frame. Click what to remove${pointLabel === "negative" ? " — marking what to keep" : ""}. Arrow keys move a crosshair, Enter adds a point, Delete removes the last. ${points.length} point${points.length === 1 ? "" : "s"} so far.`
              : undefined
          }
          onKeyDown={onKey}
          onFocus={() => clickable && setCursor((c) => c ?? { x: 0.5, y: 0.5 })}
          onBlur={() => setCursor(null)}
          onClick={(e) => {
            if (!clickable) return;
            const r = box.current!.getBoundingClientRect();
            add((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
          }}
          className={cn("relative outline-none focus-visible:ring-2 focus-visible:ring-ring", clickable && "cursor-crosshair")}
          // The box has the frame's own shape (as wide as fits, at most 46vh tall), so points land where they're clicked.
          style={{ aspectRatio: `${frame.width} / ${frame.height}`, width: `min(100%, calc(min(46vh, 520px) * ${(frame.width / frame.height).toFixed(4)}))` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={overlay ?? frame.url} alt="The first frame of the selection" className="absolute inset-0 size-full object-contain select-none" draggable={false} />
          {points.map((p, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "absolute grid size-6 -translate-1/2 place-items-center rounded-full border-2 border-white text-[11px] font-semibold text-white shadow-normal",
                p.label === "negative" ? "bg-zinc-500" : "bg-success",
              )}
              style={{ left: pct(p.x / frame.width), top: pct(p.y / frame.height) }}
            >
              {i + 1}
            </span>
          ))}
          {clickable && cursor && (
            <span aria-hidden className="pointer-events-none absolute -translate-1/2 text-white mix-blend-difference" style={{ left: pct(cursor.x), top: pct(cursor.y) }}>
              <Crosshair className="size-7" />
            </span>
          )}
          {children}
        </div>
      </div>
      {points.length > 0 && onPoints && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Points">
          {points.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPoints(points.filter((_, j) => j !== i))}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-muted px-2.5 text-[12px] font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label={`Take away point ${i + 1} (${p.label === "negative" ? "keep" : "remove"})`}
              >
                <span className={cn("size-2 rounded-full", p.label === "negative" ? "bg-zinc-500" : "bg-success")} />
                {i + 1} · {p.label === "negative" ? "keep" : "remove"}
                <X className="size-3 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A frame of a clip as a still: the browser's own decode, at most `maxSide` px. */
export async function frameFromBlob(blob: Blob): Promise<Frame> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { url, width: img.naturalWidth, height: img.naturalHeight };
}
