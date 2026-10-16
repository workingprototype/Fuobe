"use client";

import { MoveHorizontal } from "lucide-react";
import { useRef, useState } from "react";

/** Before/after slider: drag (or use ← →) to reveal the original under the result. */
export function CompareSlider({ before, after, alt }: { before: string; after: string; alt?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={box}
      className="relative max-h-full max-w-full touch-none select-none"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => e.buttons && move(e.clientX)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt={alt ?? ""} className="block max-h-[min(92vh,900px)] max-w-full object-contain" draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={before}
        alt="Original"
        className="absolute inset-0 size-full object-contain"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,.5)]" style={{ left: `${pos}%` }}>
        <span className="absolute top-1/2 left-1/2 grid size-9 -translate-1/2 place-items-center rounded-full bg-white text-black shadow-normal">
          <MoveHorizontal className="size-4" />
        </span>
      </div>
      <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">Before</span>
      <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">After</span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="sr-only"
        aria-label="Compare before and after"
      />
    </div>
  );
}
