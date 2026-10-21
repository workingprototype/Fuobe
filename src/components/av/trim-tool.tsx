"use client";

import { Loader2, Pause, Play, Scissors } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Feed } from "@/components/studio/feed";
import type { SlotValue } from "@/components/studio/media-slot";
import { useCreateGeneration, useEngine, useGenerations } from "@/lib/api";
import { formatCueTime, parseCueTime } from "@/lib/av/cue-edit";
import { cn } from "@/lib/utils";
import { sampleFrames, spacedTimes } from "./frame-sampler";
import { MediaDrop } from "./media-drop";
import { useDraft } from "./use-draft";
import { Panel, ToolHero, ToolShell } from "./tool-shell";

export const TRIM_FEATURE = "trim";
const MIN_LENGTH = 0.5;

/**
 * Trim (Video tools → Trim): keep the part between two times, with its sound. fal's trim utility on
 * the cloud, ComfyUI's core Trim Video on the open engine (CPU). A minimal in/out picker; Shorts
 * Studio's video trimmer can replace VideoRange when it lands.
 */
export function TrimTool({ tabs }: { tabs?: React.ReactNode }) {
  const [engine] = useEngine();
  const create = useCreateGeneration();
  const results = useGenerations({ features: [TRIM_FEATURE], limit: 24 });
  const [video, setVideo] = useState<SlotValue | null>(null);
  const [duration, setDuration] = useState(0);
  const [unreadable, setUnreadable] = useState(false);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  // The preview above plays the selection.
  const preview = useRef<HTMLVideoElement>(null);
  const trim = () => {
    if (!video || video.uploading) return void toast("Add the video first");
    if (range[1] - range[0] < MIN_LENGTH) return void toast(`Keep at least ${MIN_LENGTH} s`);
    create.mutate(
      {
        feature: TRIM_FEATURE,
        modelId: engine === "open" ? "oss-trim" : "trim-video",
        op: "trim",
        inputs: { video: video.ref },
        params: { startTime: Math.round(range[0] * 100) / 100, endTime: Math.round(range[1] * 100) / 100 },
        title: `Trim · ${formatCueTime(range[0])}–${formatCueTime(range[1])}`,
      },
      { onSuccess: () => toast.success("Trimming"), onError: (e) => toast.error((e as Error).message) },
    );
  };
  return (
    <ToolShell title="Video tools" tabs={tabs}>
      {!video && <ToolHero title="Keep just the part you need" subtitle="Pick where it starts and ends — the sound comes along. Free on your ComfyUI (CPU), fractions of a cent on the cloud." />}
      <div className={cn("mx-auto max-w-[820px] space-y-3", video ? "pt-4" : "mt-8")}>
        <MediaDrop
          kind="video"
          player={preview}
          value={video}
          onChange={(v) => {
            setVideo(v);
            setUnreadable(false);
            if (!v) setDuration(0);
          }}
          onDuration={(d) => {
            setDuration(d);
            setRange([0, d]);
          }}
          onUnreadable={() => setUnreadable(true)}
          title="Add a video to trim"
          hint="MP4, MOV or WebM up to 200 MB"
          compact
        />
        {video && !video.uploading && (duration > 0 || unreadable) && (
          <Panel title="Keep">
            {duration > 0 ? <VideoRange src={video.ref} duration={duration} value={range} onChange={setRange} player={preview} /> : <ManualRange value={range} onChange={setRange} />}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <p className="flex-1 text-[13px] text-muted-foreground">
                Keeps <span className="font-mono text-foreground">{formatCueTime(Math.max(0, range[1] - range[0]))}</span>
                {duration > 0 && ` of ${formatCueTime(duration)}`}
              </p>
              <Button className="rounded-full" onClick={trim} disabled={create.isPending}>
                {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />} Trim
              </Button>
            </div>
          </Panel>
        )}
      </div>
      {(results.data?.length ?? 0) > 0 && (
        <section className="mt-10" aria-labelledby="trimmed">
          <h3 id="trimmed" className="mb-3 font-heading text-[22px]">
            Trimmed clips
          </h3>
          <Feed items={results.data!} />
        </section>
      )}
    </ToolShell>
  );
}

/**
 * Filmstrip + two-handle range + exact times + play the selection — in the visible preview passed as
 * `player`, else in a hidden one of its own (sound only).
 */
export function VideoRange({
  src,
  duration,
  value,
  onChange,
  player: shown,
}: {
  src: string;
  duration: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  player?: React.RefObject<HTMLVideoElement | null>;
}) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const own = useRef<HTMLVideoElement>(null);
  const player = shown ?? own;
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    sampleFrames(src, spacedTimes(duration, 10), { width: 96, jpeg: true, signal: ctl.signal })
      .then((f) => !ctl.signal.aborted && setThumbs(f.map((x) => x.url!)))
      .catch(() => {});
    return () => ctl.abort();
  }, [src, duration]);
  // Playing the selection stops at the out point (or when the player's own controls pause it).
  useEffect(() => {
    const v = player.current;
    if (!v || !playing) return;
    const tick = () => {
      if (v.currentTime >= value[1]) {
        v.pause();
        setPlaying(false);
      }
    };
    const paused = () => setPlaying(false);
    v.addEventListener("timeupdate", tick);
    v.addEventListener("pause", paused);
    return () => {
      v.removeEventListener("timeupdate", tick);
      v.removeEventListener("pause", paused);
    };
  }, [player, playing, value]);
  const play = () => {
    const v = player.current;
    if (!v) return;
    if (playing) {
      v.pause();
      return setPlaying(false);
    }
    v.currentTime = value[0];
    void v.play().then(() => setPlaying(true)).catch(() => toast("This browser can't play the clip — the trim still works"));
  };
  const set = (i: 0 | 1, raw: string) => {
    const t = parseCueTime(raw);
    if (t === null) return;
    const next: [number, number] = i === 0 ? [Math.min(t, value[1] - MIN_LENGTH), value[1]] : [value[0], Math.max(t, value[0] + MIN_LENGTH)];
    onChange([Math.max(0, next[0]), Math.min(duration, next[1])]);
  };
  return (
    <div className="space-y-3">
      {!shown && <video ref={own} src={src} playsInline preload="metadata" className="hidden" />}
      <div className="relative h-12 overflow-hidden rounded-lg bg-muted" aria-hidden>
        <div className="flex h-full">
          {thumbs.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" className="h-full min-w-0 flex-1 object-cover" />
          ))}
        </div>
        <div className="absolute inset-y-0 left-0 bg-background/70" style={{ width: `${(value[0] / duration) * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-background/70" style={{ width: `${100 - (value[1] / duration) * 100}%` }} />
        <div className="absolute inset-y-0 rounded-lg border-2 border-primary" style={{ left: `${(value[0] / duration) * 100}%`, right: `${100 - (value[1] / duration) * 100}%` }} />
      </div>
      <Slider
        min={0}
        max={duration}
        step={0.05}
        minStepsBetweenThumbs={Math.round(MIN_LENGTH / 0.05)}
        value={value}
        onValueChange={(v) => onChange([v[0], v[1]])}
        aria-label="Part to keep"
        thumbLabels={["Start", "End"]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <TimeField label="Start" value={value[0]} onCommit={(s) => set(0, s)} />
        <TimeField label="End" value={value[1]} onCommit={(s) => set(1, s)} />
        <Button variant="outline" size="sm" className="ml-auto rounded-full" onClick={play}>
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {playing ? "Pause" : "Play selection"}
        </Button>
      </div>
    </div>
  );
}

/** When the browser can't decode the clip: type the times (the server still trims it). */
function ManualRange({ value, onChange }: { value: [number, number]; onChange: (v: [number, number]) => void }) {
  const set = (i: 0 | 1, raw: string) => {
    const t = parseCueTime(raw);
    if (t === null) return;
    onChange(i === 0 ? [t, Math.max(value[1], t + MIN_LENGTH)] : [value[0], Math.max(t, value[0] + MIN_LENGTH)]);
  };
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">This browser can&apos;t preview the clip, but it can still be trimmed — type the times (e.g. 0:03.5).</p>
      <div className="flex flex-wrap items-center gap-2">
        <TimeField label="Start" value={value[0]} onCommit={(s) => set(0, s)} />
        <TimeField label="End" value={value[1]} onCommit={(s) => set(1, s)} />
      </div>
    </div>
  );
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (raw: string) => void }) {
  const [text, setText] = useDraft(formatCueTime(value));
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      {label}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        inputMode="decimal"
        className="h-8 w-20 rounded-full border bg-background px-2.5 text-center font-mono text-[12px] text-foreground tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-brand-faint"
      />
    </label>
  );
}
