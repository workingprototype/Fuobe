"use client";

import { Check, Loader2, Plus, ScanSearch, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/av/tool-shell";
import { Segmented } from "@/components/faceless/controls";
import { SCENE_THRESHOLD } from "@/lib/av/scene-cuts";
import { addCut, at, MODE_LABELS, moveCut, removeCut, secondsLabel, shotsFromCuts, tidyCuts, type ShotMode } from "@/lib/catalog/swap-studio";
import { cn } from "@/lib/utils";
import { Note } from "./parts";
import { useSceneCuts } from "./use-scene-cuts";
import type { StageProps } from "./workbench";

const key = (a: number, b: number) => `${a}-${b}`;
const pct = (f: number, total: number) => `${(f / total) * 100}%`;

/** Shots: find the edits (FFmpeg's scene score at 0.32), move, add or remove cuts, Replace character or Keep original per shot. */
export function ShotsStage({ project, clip, edit, src }: StageProps) {
  const video = useRef<HTMLVideoElement>(null);
  const scene = useSceneCuts();
  const [draft, setDraft] = useState<number[] | null>(null);
  const [modes, setModes] = useState<Record<string, ShotMode>>({});
  const [frame, setFrame] = useState(0);
  const [saving, setSaving] = useState(false);
  const cuts = draft ?? clip.cuts;
  const total = clip.frames;
  const shots = useMemo(() => shotsFromCuts(clip, cuts, project.defaults), [clip, cuts, project.defaults]);
  const modeOf = (a: number, b: number, fallback: ShotMode) => modes[key(a, b)] ?? fallback;
  const changed = draft !== null || Object.keys(modes).length > 0;

  const seek = (f: number) => {
    if (video.current) video.current.currentTime = at(f) + 0.5 / 24;
    setFrame(f);
  };
  const detect = async () => {
    const found = await scene.detect(src, total);
    if (!found) return;
    await edit({ type: "detected", clipId: clip.id, cuts: found });
    toast(found.length ? `Found ${found.length} edit${found.length === 1 ? "" : "s"} — check them, then save the shots` : "No edits found: one continuous shot");
  };
  const save = async () => {
    setSaving(true);
    const p = await edit({ type: "cuts", clipId: clip.id, cuts, modes: shots.map((s) => modeOf(s.start, s.end, s.mode)) });
    setSaving(false);
    if (p) {
      setDraft(null);
      setModes({});
    }
  };

  return (
    <div className="space-y-3">
      <Panel>
        <video
          ref={video}
          src={src}
          controls
          playsInline
          preload="metadata"
          onTimeUpdate={(e) => setFrame(Math.min(total - 1, Math.floor(e.currentTarget.currentTime * 24)))}
          className="max-h-[46vh] w-full rounded-xl bg-media"
        />
        {/* The timeline: shots by colour, cuts as lines, detected edits dashed, the playhead. */}
        <div
          className="relative mt-3 h-10 cursor-pointer overflow-hidden rounded-lg bg-muted"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(Math.min(total - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * total))));
          }}
          aria-hidden
        >
          {shots.map((s) => (
            <div key={s.id} className={cn("absolute inset-y-0", modeOf(s.start, s.end, s.mode) === "generate" ? "bg-brand-faint" : "bg-muted")} style={{ left: pct(s.start, total), width: pct(s.end - s.start, total) }} />
          ))}
          {(clip.detected ?? []).map((c) => (
            <div key={`d${c}`} className="absolute inset-y-1 border-l-2 border-dashed border-warning" style={{ left: pct(c, total) }} />
          ))}
          {cuts.map((c) => (
            <div key={c} className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: pct(c, total) }} />
          ))}
          <div className="absolute inset-y-0 w-0.5 bg-primary" style={{ left: pct(frame, total) }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
            Frame {frame} · {secondsLabel(frame)}
          </span>
          <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => setDraft(addCut(cuts, frame, total))} disabled={frame <= 0 || cuts.includes(frame)}>
            <Plus className="size-3.5" /> Cut at the playhead
          </Button>
          <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => void detect()} disabled={scene.busy}>
            {scene.busy ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
            {scene.busy ? `Detecting… ${Math.round(scene.progress * 100)}%` : "Detect edits"}
          </Button>
          {scene.busy && (
            <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={scene.cancel}>
              Stop
            </Button>
          )}
        </div>
        {scene.error && <p className="mt-2 text-[12px] text-destructive">{scene.error}</p>}
        {clip.detected && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-warning/60 px-3 py-2 text-[12px]">
            <span className="min-w-0 flex-1">
              {clip.detected.length ? `Detected ${clip.detected.length} edit${clip.detected.length === 1 ? "" : "s"} at frames ${clip.detected.join(", ")}` : "No edits detected"} (scene score over {SCENE_THRESHOLD}).
            </span>
            <Button size="sm" className="h-7 rounded-full px-2.5 text-[12px]" onClick={() => setDraft(tidyCuts(clip.detected!))}>
              <Check className="size-3.5" /> Use them
            </Button>
            <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-[12px]" onClick={() => void edit({ type: "detected", clipId: clip.id, cuts: [] })}>
              <X className="size-3.5" /> Dismiss
            </Button>
          </div>
        )}
      </Panel>

      <Panel
        title={`Shots · ${shots.length}`}
        aside={
          <Button size="sm" className="h-8 rounded-full" onClick={() => void save()} disabled={saving || (!changed && clip.cutsReviewed)}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {changed || !clip.cutsReviewed ? "Save shots" : "Saved"}
          </Button>
        }
      >
        {!clip.cutsReviewed && !changed && <Note className="mb-3">Confirm the shots before generating: detect the edits (or add cuts at the playhead), then save. H3 swaps one continuous shot at a time.</Note>}
        {changed && <Note className="mb-3">Changed shots lose their masks, anchors and segments when saved; shots whose frames stay the same keep everything.</Note>}
        <ol className="space-y-2">
          {shots.map((s, i) => {
            const m = modeOf(s.start, s.end, s.mode);
            const cutAt = i > 0 ? s.start : null;
            return (
              <li key={s.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2">
                <button type="button" onClick={() => seek(s.start)} className="min-w-0 text-left text-[13px] font-medium hover:underline">
                  Shot {i + 1}
                  <span className="ml-2 font-mono text-[12px] font-normal text-muted-foreground tabular-nums">
                    {s.start}–{s.end} · {secondsLabel(s.end - s.start)}
                  </span>
                </button>
                <Segmented
                  label={`Shot ${i + 1}`}
                  value={m}
                  options={(["generate", "preserve"] as const).map((v) => ({ value: v, label: MODE_LABELS[v].label, hint: MODE_LABELS[v].hint }))}
                  onChange={(v) => setModes((x) => ({ ...x, [key(s.start, s.end)]: v }))}
                  className="ml-auto"
                />
                {cutAt !== null && (
                  <div className="flex w-full items-center gap-2 text-[12px] text-muted-foreground">
                    <label className="flex items-center gap-1.5">
                      Cut at frame
                      <input
                        key={cutAt}
                        type="number"
                        defaultValue={cutAt}
                        min={1}
                        max={total - 1}
                        onBlur={(e) => {
                          const n = Math.round(Number(e.currentTarget.value));
                          if (Number.isFinite(n) && n !== cutAt) setDraft(moveCut(cuts, cutAt, n, total));
                        }}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        className="h-7 w-20 rounded-md border bg-background px-2 font-mono tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                    <button type="button" onClick={() => setDraft(removeCut(cuts, cutAt))} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted hover:text-foreground" aria-label={`Remove the cut at frame ${cutAt}`}>
                      <Trash2 className="size-3.5" /> Remove cut
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}
