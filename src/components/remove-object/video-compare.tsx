"use client";

import { MoveHorizontal, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Before / after for a video: the result plays underneath and the original on top, cut at the handle; drag it
 * (or use ← → on the slider) to wipe between them. The original follows the result's clock from `start` (the
 * selection's start in the original clip), so both show the same moment.
 */
export function VideoCompare({
  before,
  after,
  start = 0,
  ratio,
  label = "Compare the original and the result",
}: {
  before: string;
  after: string;
  start?: number;
  /** The clip's width / height: the box keeps that shape while the videos load. */
  ratio?: number;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const [pos, setPos] = useState(50);
  const [playing, setPlaying] = useState(false);
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  // Keep the original on the result's clock.
  useEffect(() => {
    const va = a.current;
    const vb = b.current;
    if (!va || !vb) return;
    const sync = () => {
      const want = start + va.currentTime;
      if (Math.abs(vb.currentTime - want) > 0.12) vb.currentTime = want;
    };
    const onPlay = () => {
      sync();
      void vb.play().catch(() => {});
      setPlaying(true);
    };
    const onPause = () => {
      vb.pause();
      setPlaying(false);
    };
    va.addEventListener("timeupdate", sync);
    va.addEventListener("seeked", sync);
    va.addEventListener("play", onPlay);
    va.addEventListener("pause", onPause);
    return () => {
      va.removeEventListener("timeupdate", sync);
      va.removeEventListener("seeked", sync);
      va.removeEventListener("play", onPlay);
      va.removeEventListener("pause", onPause);
    };
  }, [start, before, after]);
  const toggle = () => {
    const va = a.current;
    if (!va) return;
    if (va.paused) void va.play().catch(() => {});
    else va.pause();
  };
  return (
    <div className="space-y-2">
      <div
        ref={box}
        className="relative mx-auto grid touch-none place-items-center overflow-hidden rounded-xl bg-media select-none"
        style={ratio ? { aspectRatio: String(ratio), maxHeight: "56vh" } : undefined}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          move(e.clientX);
        }}
        onPointerMove={(e) => e.buttons && move(e.clientX)}
      >
        <video
          ref={a}
          src={after}
          playsInline
          loop
          className={ratio ? "absolute inset-0 size-full object-contain" : "block max-h-[56vh] w-full object-contain"}
          onLoadedMetadata={() => b.current && (b.current.currentTime = start)} />
        <video
          ref={b}
          src={before}
          playsInline
          muted
          preload="auto"
          aria-hidden
          className="absolute inset-0 size-full object-contain"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
          onLoadedMetadata={(e) => (e.currentTarget.currentTime = start)}
        />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,.5)]" style={{ left: `${pos}%` }}>
          <span className="absolute top-1/2 left-1/2 grid size-9 -translate-1/2 place-items-center rounded-full bg-white text-black shadow-normal">
            <MoveHorizontal className="size-4" />
          </span>
        </div>
        <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">Before</span>
        <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">After</span>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" className="rounded-full" onClick={toggle}>
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {playing ? "Pause" : "Play both"}
        </Button>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(pos)}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label={label}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
        />
      </div>
    </div>
  );
}
