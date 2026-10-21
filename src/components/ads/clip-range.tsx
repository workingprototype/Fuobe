"use client";

import { Play, Scissors } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clampClip, commitClipTime, initialClip, MULTIPLIER, parseClipTime, type ClipRange as Range } from "@/lib/catalog/marketing";
import { cn } from "@/lib/utils";

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * An in/out time: what's typed stays as typed until Enter or leaving the field (then the range is
 * clamped), so "20" isn't cut to the 4 s minimum at its first digit. Arrow keys step 0.1 s at once;
 * Escape goes back to the current value.
 */
function TimeField({ label, value, max, onCommit }: { label: string; value: number; max: number; onCommit: (text: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const invalid = text != null && parseClipTime(text) == null;
  const commit = () => {
    if (text == null) return;
    setText(null);
    onCommit(text);
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape" && text != null) {
            e.preventDefault();
            setText(null);
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = parseClipTime(text ?? String(value)) ?? value;
            setText(null);
            onCommit(String(Math.min(max, Math.max(0, r1(base + (e.key === "ArrowUp" ? 0.1 : -0.1))))));
          }
        }}
        aria-invalid={invalid || undefined}
        className={cn("h-8 w-20 rounded-lg border bg-background px-2 font-mono text-[13px] tabular-nums outline-none focus:border-primary", invalid && "border-destructive")}
      />
    </label>
  );
}

/**
 * A plain in/out picker for the reference ad: the player, a bar showing the kept part, two time
 * fields and "set from the playhead" buttons. (A drop-in for a fuller trimmer later.)
 */
export function ClipRange({ src, duration, value, onChange, onDuration, onUnplayable, className }: { src: string; duration: number | null; value: Range | null; onChange: (r: Range) => void; onDuration: (d: number) => void; onUnplayable?: () => void; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const unplayable = failed === src;
  const stopAt = useRef<number | null>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const tick = () => {
      if (stopAt.current != null && v.currentTime >= stopAt.current) {
        v.pause();
        stopAt.current = null;
      }
    };
    v.addEventListener("timeupdate", tick);
    return () => v.removeEventListener("timeupdate", tick);
  }, []);
  const d = duration ?? 0;
  const range = value ?? (d ? initialClip(d) : null);
  const length = range ? range.end - range.start : 0;
  const outside = !!range && (length < MULTIPLIER.minSeconds - 0.05 || length > MULTIPLIER.maxSeconds + 0.05);
  const set = (k: "start" | "end", n: number) => range && d && onChange(clampClip({ ...range, [k]: n }, d, k));
  const here = (k: "start" | "end") => video.current && set(k, video.current.currentTime);
  const preview = () => {
    const v = video.current;
    if (!v || !range) return;
    v.currentTime = range.start;
    stopAt.current = range.end;
    void v.play();
  };
  return (
    <div className={cn("min-w-0", className)}>
      <video
        ref={video}
        src={src}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && onDuration(e.currentTarget.duration)}
        onError={() => {
          setFailed(src);
          onUnplayable?.();
        }}
        className={cn("mx-auto max-h-[46vh] w-full rounded-xl bg-black object-contain", unplayable && "hidden")}
        aria-label="Reference ad"
      />
      {unplayable && (
        <div className="grid aspect-video place-items-center rounded-xl bg-muted px-6 text-center text-[13px] text-muted-foreground">
          This browser can&apos;t play this clip&apos;s format, so there&apos;s no preview here. It&apos;s still used as it is — set the in and out points by time.
        </div>
      )}
      {range && d > 0 && (
        <div className="mt-3 space-y-2.5">
          <div className="relative h-2 rounded-full bg-muted" aria-hidden>
            <div className={cn("absolute inset-y-0 rounded-full", outside ? "bg-destructive/60" : "bg-primary")} style={{ left: `${(range.start / d) * 100}%`, width: `${(length / d) * 100}%` }} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {(["start", "end"] as const).map((k) => (
              <div key={k} className="flex items-end gap-1">
                <TimeField
                  label={k === "start" ? "In (s)" : "Out (s)"}
                  value={range[k]}
                  max={r1(d)}
                  onCommit={(text) => {
                    const next = commitClipTime(text, range, d, k);
                    if (next) onChange(next);
                  }}
                />
                <button type="button" onClick={() => here(k)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-secondary px-2 text-[12px] font-medium hover:bg-accent" title={`Set the ${k === "start" ? "in" : "out"} point at the playhead`}>
                  <Scissors className="size-3" /> {k === "start" ? "Set in here" : "Set out here"}
                </button>
              </div>
            ))}
            <button type="button" onClick={preview} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              <Play className="size-3" /> Play the cut
            </button>
          </div>
          <p className={cn("text-[12px]", outside ? "text-destructive" : "text-muted-foreground")} role={outside ? "alert" : undefined}>
            {fmt(range.start)} – {fmt(range.end)} · {length.toFixed(1)} s of {d.toFixed(1)} s{outside ? ` — the reference must be ${MULTIPLIER.minSeconds}–${MULTIPLIER.maxSeconds} s` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
