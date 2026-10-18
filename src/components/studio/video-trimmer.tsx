"use client";

import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { clampRange, clock, initialRange, moveRange, setEdge, thumbTimes, trimHint, type TrimLimits, type TrimRange } from "@/lib/trim-range";
import { cn } from "@/lib/utils";

export type { TrimRange } from "@/lib/trim-range";

/**
 * Pick a part of a clip: a filmstrip of frames grabbed in the browser, a draggable window with two
 * handles (min/max length enforced), "play the selection", and typed start/end times. Keyboard: the
 * handles and the window are sliders (arrows 0.1 s, Shift ×10, Page Up/Down 5 s, Home/End).
 * Used by Shorts Studio and Mixed Media; reusable anywhere a clip needs trimming (Ad Multiplier,
 * Motion control).
 */

export interface VideoTrimmerHandle {
  /** A still of the clip at `time` (default: the selection's start) as a JPEG, or null if this browser can't decode it. */
  grabFrame(time?: number, maxSide?: number): Promise<Blob | null>;
}

export interface VideoTrimmerProps {
  src: string;
  /** The selection (null until the clip's length is known: the trimmer then proposes one). */
  value: TrimRange | null;
  onChange: (v: TrimRange) => void;
  /** Shortest and longest selection, in seconds. */
  min?: number;
  max?: number;
  /** The clip's length when known from elsewhere (some formats don't report one in the browser). */
  duration?: number;
  /** Accessible name of the control. */
  label?: string;
  /** Overrides the "Select a 10-second segment" line. */
  hint?: string;
  onMeta?: (m: { duration: number; width: number; height: number }) => void;
  /** Hide the clip preview above the filmstrip. */
  noPreview?: boolean;
  className?: string;
}

/** Seek a (hidden) video and wait for the frame. */
function seek(v: HTMLVideoElement, t: number, ms = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("error", onError);
      resolve(ok);
    };
    const onSeeked = () => done(true);
    const onError = () => done(false);
    const timer = setTimeout(() => done(false), ms);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("error", onError);
    v.currentTime = Math.max(0, t);
  });
}

function loaded(v: HTMLVideoElement, ms = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    if (v.readyState >= 2) return resolve(true);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      v.removeEventListener("loadeddata", onData);
      v.removeEventListener("error", onError);
      resolve(ok);
    };
    const onData = () => done(true);
    const onError = () => done(false);
    const timer = setTimeout(() => done(false), ms);
    v.addEventListener("loadeddata", onData);
    v.addEventListener("error", onError);
  });
}

function draw(v: HTMLVideoElement, height: number, maxSide?: number): HTMLCanvasElement | null {
  if (!v.videoWidth || !v.videoHeight) return null;
  const c = document.createElement("canvas");
  let w = Math.round((v.videoWidth / v.videoHeight) * height);
  let h = height;
  if (maxSide && Math.max(w, h) > maxSide) {
    const k = maxSide / Math.max(w, h);
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(v, 0, 0, w, h);
  return c;
}

function makeVideo(src: string): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.src = src;
  return v;
}

const STEP = 0.1;

export const VideoTrimmer = forwardRef<VideoTrimmerHandle, VideoTrimmerProps>(function VideoTrimmer(
  { src, value, onChange, min, max, duration: knownDuration, label = "Part of the clip", hint, onMeta, noPreview, className },
  ref,
) {
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [shape, setShape] = useState(16 / 9);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [unsupported, setUnsupported] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(0);
  const d = duration ?? knownDuration ?? 0;
  const limits: TrimLimits = { duration: d, min, max };
  const range = value ?? (d ? initialRange(d, max) : null);

  // Read the latest props from long-lived handlers (drag, playback loop).
  const latest = useRef({ range, limits, onChange });
  useEffect(() => {
    latest.current = { range, limits, onChange };
  });

  // Propose a selection as soon as the length is known; keep an old one valid for a new clip.
  useEffect(() => {
    if (!d) return;
    const { range: r, limits: l, onChange: set } = latest.current;
    if (!value) set(initialRange(d, max));
    else {
      const ok = clampRange(r!, l, "end");
      if (ok.startTime !== r!.startTime || ok.endTime !== r!.endTime) set(ok);
    }
    // Only when the clip (or its length) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, src]);

  // Filmstrip: frames grabbed from a hidden copy of the clip, one by one, as soon as they decode.
  const [stripFor, setStripFor] = useState(src);
  if (stripFor !== src) {
    setStripFor(src);
    setThumbs([]);
    setUnsupported(false);
  }
  useEffect(() => {
    let cancelled = false;
    const v = makeVideo(src);
    (async () => {
      const ok = await loaded(v);
      if (cancelled) return;
      const len = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (knownDuration ?? 0);
      if (!ok || !v.videoWidth || !len) {
        setUnsupported(true);
        return;
      }
      // Without the preview, this copy is where the length and shape come from.
      if (noPreview) {
        setDuration((cur) => cur ?? len);
        onMeta?.({ duration: len, width: v.videoWidth, height: v.videoHeight });
      }
      const width = track.current?.clientWidth ?? 640;
      const tile = 56 * (v.videoWidth / v.videoHeight);
      const n = Math.max(4, Math.min(14, Math.round(width / Math.max(28, tile))));
      for (const t of thumbTimes(len, n)) {
        if (cancelled) return;
        if (!(await seek(v, Math.min(t, len - 0.05)))) break;
        const c = draw(v, 112);
        if (!c || cancelled) break;
        const url = c.toDataURL("image/jpeg", 0.7);
        setThumbs((xs) => [...xs, url]);
      }
    })();
    return () => {
      cancelled = true;
      v.removeAttribute("src");
      v.load();
    };
    // knownDuration only matters for formats without a length; don't re-grab when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useImperativeHandle(
    ref,
    () => ({
      async grabFrame(time, maxSide = 1536) {
        const v = makeVideo(src);
        try {
          if (!(await loaded(v))) return null;
          if (!(await seek(v, time ?? latest.current.range?.startTime ?? 0))) return null;
          const c = draw(v, v.videoHeight, maxSide);
          if (!c) return null;
          return await new Promise<Blob | null>((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", 0.92));
        } catch {
          return null;
        } finally {
          v.removeAttribute("src");
          v.load();
        }
      },
    }),
    [src],
  );

  // Play the selection, then stop at its end (back to its start).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      const r = latest.current.range;
      if (v && r) {
        setNow(v.currentTime);
        if (v.currentTime >= r.endTime - 0.02 || v.ended) {
          v.pause();
          v.currentTime = r.startTime;
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const togglePlay = () => {
    const v = video.current;
    if (!v || !range) return;
    if (playing) {
      v.pause();
      setPlaying(false);
      return;
    }
    if (v.currentTime < range.startTime || v.currentTime >= range.endTime - 0.05) v.currentTime = range.startTime;
    void v
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  };

  /** Show the frame at an edge while it's being moved. */
  const scrub = useCallback((t: number) => {
    const v = video.current;
    if (!v || !v.paused) return;
    v.currentTime = t;
    setNow(t);
  }, []);

  const commit = useCallback(
    (next: TrimRange, show?: number) => {
      latest.current.onChange(next);
      if (show !== undefined) scrub(show);
    },
    [scrub],
  );

  // Dragging: an edge, the whole window, or a press on the strip (the window jumps there).
  const drag = useRef<{ kind: "start" | "end" | "move"; x0: number; r0: TrimRange } | null>(null);
  const timeAt = (clientX: number) => {
    const el = track.current;
    if (!el || !d) return 0;
    const box = el.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((clientX - box.left) / box.width) * d));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!range || !d || e.button > 0) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-trim]");
    const kind = (target?.dataset.trim as "start" | "end" | "move" | undefined) ?? null;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (kind) {
      drag.current = { kind, x0: e.clientX, r0: range };
      target?.focus({ preventScroll: true });
      return;
    }
    // A press outside the window moves it there (keeping its length), then drags it.
    const len = range.endTime - range.startTime;
    const next = moveRange(range, timeAt(e.clientX) - len / 2 - range.startTime, limits);
    commit(next, next.startTime);
    drag.current = { kind: "move", x0: e.clientX, r0: next };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    const el = track.current;
    if (!g || !el || !d) return;
    const dt = ((e.clientX - g.x0) / el.getBoundingClientRect().width) * d;
    const l = latest.current.limits;
    if (g.kind === "move") {
      const next = moveRange(g.r0, dt, l);
      commit(next, next.startTime);
    } else {
      const next = setEdge(g.r0, g.kind, (g.kind === "start" ? g.r0.startTime : g.r0.endTime) + dt, l);
      commit(next, g.kind === "start" ? next.startTime : next.endTime);
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const kind = e.currentTarget.dataset.trim as "start" | "end" | "move" | undefined;
    if (!range || !d || !kind) return;
    const big = e.shiftKey ? 10 : 1;
    let delta: number | null = null;
    let to: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -STEP * big;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = STEP * big;
    else if (e.key === "PageDown") delta = -5;
    else if (e.key === "PageUp") delta = 5;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = d;
    else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      togglePlay();
      return;
    } else return;
    e.preventDefault();
    if (kind === "move") {
      const next = moveRange(range, to !== null ? (to === 0 ? -range.startTime : d - range.endTime) : delta!, limits);
      commit(next, next.startTime);
    } else {
      const cur = kind === "start" ? range.startTime : range.endTime;
      const next = setEdge(range, kind, to ?? cur + delta!, limits);
      commit(next, kind === "start" ? next.startTime : next.endTime);
    }
  };

  const pct = (t: number) => (d ? `${(t / d) * 100}%` : "0%");
  const len = range ? range.endTime - range.startTime : 0;
  const line = hint ?? (d ? trimHint(limits) : null);

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      {!noPreview && (
        <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: shape, maxHeight: 360, maxWidth: shape < 1 ? 360 * shape : undefined }}>
          <video
            ref={video}
            src={src}
            playsInline
            muted={muted}
            preload="metadata"
            className="size-full object-contain"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const len = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (knownDuration ?? 0);
              if (v.videoWidth && v.videoHeight) setShape(v.videoWidth / v.videoHeight);
              if (len) setDuration(len);
              onMeta?.({ duration: len, width: v.videoWidth, height: v.videoHeight });
            }}
            onPause={() => setPlaying(false)}
            onClick={togglePlay}
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent p-2 text-white">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!range}
              aria-label={playing ? "Pause" : "Play the selection"}
              title={playing ? "Pause" : "Play the selection"}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-white/20 backdrop-blur transition-colors hover:bg-white/30 disabled:opacity-50"
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <span className="min-w-0 truncate font-mono text-[11px] tabular-nums opacity-90">
              {clock(now)}
              <span className="opacity-70"> / {clock(d)}</span>
            </span>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Unmute" : "Mute"}
              className="ml-auto grid size-8 place-items-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25"
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            </button>
          </div>
        </div>
      )}

      <div role="group" aria-label={label} className="space-y-2">
        <div
          ref={track}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn("relative h-14 touch-none overflow-hidden rounded-lg bg-muted select-none", !range && "animate-pulse")}
        >
          <div className="absolute inset-0 flex" aria-hidden>
            {unsupported ? (
              <div className="size-full bg-[repeating-linear-gradient(135deg,var(--muted)_0_10px,var(--accent)_10px_20px)]" />
            ) : (
              thumbs.map((t, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={t} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
              ))
            )}
          </div>
          {range && d > 0 && (
            <>
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/55" style={{ width: pct(range.startTime) }} />
              <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/55" style={{ width: `calc(100% - ${pct(range.endTime)})` }} />
              <div
                data-trim="move"
                role="slider"
                tabIndex={0}
                aria-label="Selection position"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, Math.round((d - len) * 10) / 10)}
                aria-valuenow={range.startTime}
                aria-valuetext={`${clock(range.startTime)} to ${clock(range.endTime)}`}
                onKeyDown={onKey}
                className="absolute inset-y-0 cursor-grab rounded-md border-2 border-primary outline-none focus-visible:ring-4 focus-visible:ring-brand-faint active:cursor-grabbing"
                style={{ left: pct(range.startTime), width: pct(len) }}
              />
              {(["start", "end"] as const).map((edge) => (
                <div
                  key={edge}
                  data-trim={edge}
                  role="slider"
                  tabIndex={0}
                  aria-label={edge === "start" ? "Start of selection" : "End of selection"}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(d * 10) / 10}
                  aria-valuenow={edge === "start" ? range.startTime : range.endTime}
                  aria-valuetext={clock(edge === "start" ? range.startTime : range.endTime)}
                  onKeyDown={onKey}
                  className="group/handle absolute inset-y-0 z-10 flex w-6 cursor-ew-resize items-center justify-center outline-none"
                  style={{ left: `calc(${pct(edge === "start" ? range.startTime : range.endTime)} - ${edge === "start" ? "4px" : "20px"})` }}
                >
                  <span className="h-full w-2.5 rounded-sm bg-primary shadow-soft transition-transform group-focus-visible/handle:scale-x-125 group-focus-visible/handle:ring-4 group-focus-visible/handle:ring-brand-faint">
                    <span className="mx-auto mt-[22px] block h-3 w-0.5 rounded-full bg-primary-foreground/80" />
                  </span>
                </div>
              ))}
              {!noPreview && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow" style={{ left: pct(now) }} aria-hidden />}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted-foreground">
          <TimeField label="Start" value={range?.startTime} disabled={!range} onCommit={(t) => range && commit(setEdge(range, "start", t, limits), t)} />
          <span className="font-mono tabular-nums text-foreground" aria-live="polite">
            {range ? `${len.toFixed(1)} s selected` : "Reading the clip…"}
          </span>
          <TimeField label="End" value={range?.endTime} disabled={!range} onCommit={(t) => range && commit(setEdge(range, "end", t, limits), t)} />
          {line && <span className="w-full text-[12px] text-brand-text sm:ml-auto sm:w-auto">{line}</span>}
          {unsupported && <span className="w-full text-[12px]">This browser can&apos;t show frames of this clip — pick the part by time.</span>}
        </div>
      </div>
    </div>
  );
});

/** A seconds field that commits on Enter or blur (typing "12.5" or "0:12.5"). */
function TimeField({ label, value, disabled, onCommit }: { label: string; value?: number; disabled?: boolean; onCommit: (t: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value !== undefined ? value.toFixed(1) : "");
  const parse = (s: string) => {
    const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*s?\s*$/.exec(s);
    return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : NaN;
  };
  const done = () => {
    if (draft !== null) {
      const t = parse(draft);
      if (Number.isFinite(t)) onCommit(t);
    }
    setDraft(null);
  };
  return (
    <label className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={shown}
        aria-label={`${label} (seconds)`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            done();
          } else if (e.key === "Escape") setDraft(null);
        }}
        className="h-7 w-16 rounded-md border bg-background px-2 font-mono text-[12px] text-foreground tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-brand-faint disabled:opacity-50"
      />
      <span aria-hidden>s</span>
    </label>
  );
}
