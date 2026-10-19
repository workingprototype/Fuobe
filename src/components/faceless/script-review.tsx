"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Check, Info, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { blockId, formatLength, secondsFor, tooLong, totalSeconds, wordCount, type EpisodeView, type ScriptBlock } from "@/lib/catalog/faceless";
import { cn } from "@/lib/utils";
import { EstimateLine } from "./controls";
import { useEpisodeAction, useEstimate, useUpdateEpisode } from "./hooks";

const field = "w-full resize-none rounded-lg border bg-background px-2.5 py-2 text-[14px] leading-relaxed outline-none transition-colors [field-sizing:content] focus:border-primary placeholder:text-subtle-foreground";

function SceneCard({
  block,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  onAdd,
}: {
  block: ScriptBlock;
  index: number;
  count: number;
  onChange: (p: Partial<ScriptBlock>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onAdd: () => void;
}) {
  const long = tooLong(block.narration);
  const secs = secondsFor(block.narration);
  return (
    <li className="group/scene rounded-2xl border bg-background p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted font-mono text-[12px] font-semibold">{index + 1}</span>
        <span className={cn("font-mono text-[12px] tabular-nums", long ? "text-warning" : "text-muted-foreground")}>
          ≈ {secs} s · {wordCount(block.narration)} words
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move scene ${index + 1} up`}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move scene ${index + 1} down`}>
            <ArrowDown />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onAdd} aria-label={`Add a scene after scene ${index + 1}`}>
            <Plus />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={count === 1} onClick={onRemove} aria-label={`Delete scene ${index + 1}`}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <label className="block min-w-0 space-y-1">
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Narration</span>
          <textarea value={block.narration} onChange={(e) => onChange({ narration: e.target.value })} rows={3} maxLength={2000} className={field} placeholder="What the narrator says over this scene" />
          {long && (
            <span className="flex items-center gap-1 text-[12px] text-warning">
              <AlertTriangle className="size-3" /> More than 10 seconds — it&apos;ll be split into two scenes.
            </span>
          )}
        </label>
        <div className="min-w-0 space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Picture</span>
            <textarea value={block.visual} onChange={(e) => onChange({ visual: e.target.value })} rows={2} maxLength={1200} className={cn(field, "text-[13px]")} placeholder="What the picture shows" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Movement</span>
            <input value={block.motion} onChange={(e) => onChange({ motion: e.target.value })} maxLength={400} className={cn(field, "h-9 py-0 text-[13px]")} placeholder="e.g. slow push-in, leaves drift" />
          </label>
        </div>
      </div>
    </li>
  );
}

/**
 * Review the script before anything renders: every scene's narration, picture and movement, editable,
 * reorderable; saved as you type. Render starts the whole episode.
 */
export function ScriptReview({ view }: { view: EpisodeView }) {
  const ep = view.episode;
  const [blocks, setBlocks] = useState<ScriptBlock[]>(ep.script.blocks);
  const [dirty, setDirty] = useState(false);
  const update = useUpdateEpisode(ep.id);
  const action = useEpisodeAction(ep.id);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(blocks);
  const estimate = useEstimate({ kind: ep.kind, settings: ep.settings, blocks });

  // A rewrite brings a new script.
  const scriptKey = ep.script.blocks.map((b) => b.id).join("|");
  const seen = useRef(scriptKey);
  useEffect(() => {
    if (seen.current === scriptKey || dirty) return;
    seen.current = scriptKey;
    setBlocks(ep.script.blocks);
  }, [scriptKey, dirty, ep.script.blocks]);

  const save = async (bs = latest.current) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = await update.mutateAsync({ blocks: bs.map(({ id, narration, visual, motion }) => ({ id, narration, visual, motion })) });
    seen.current = v.episode.script.blocks.map((b) => b.id).join("|");
    setDirty(false);
    return v;
  };

  const edit = (next: ScriptBlock[]) => {
    setBlocks(next);
    latest.current = next;
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save().catch((e) => toast.error((e as Error).message)), 900);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const change = (i: number, p: Partial<ScriptBlock>) => edit(blocks.map((b, j) => (j === i ? { ...b, ...p, ...(p.narration !== undefined && { seconds: secondsFor(p.narration) }) } : b)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...blocks];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    edit(next);
  };

  const render = async () => {
    try {
      if (dirty) {
        const v = await save();
        setBlocks(v.episode.script.blocks);
      }
      await action.mutateAsync("render");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const seconds = totalSeconds(blocks.map((b) => ({ seconds: secondsFor(b.narration) })));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-[26px] leading-tight">Review the script</h2>
          <p className="text-[13px] text-muted-foreground">Edit any scene before it renders. Each scene is about 10 seconds of narration with its own picture.</p>
        </div>
        <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => action.mutate("rewrite", { onError: (e) => toast.error((e as Error).message) })}>
          <Wand2 /> Write it again
        </Button>
      </div>
      {ep.script.offline && (
        <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" /> {ep.script.note}
        </p>
      )}
      {ep.error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> {ep.error}
        </p>
      )}
      <ol className="space-y-3" aria-label="Scenes">
        {blocks.map((b, i) => (
          <SceneCard
            key={b.id}
            block={b}
            index={i}
            count={blocks.length}
            onChange={(p) => change(i, p)}
            onMove={(d) => move(i, d)}
            onRemove={() => edit(blocks.filter((_, j) => j !== i))}
            onAdd={() => edit([...blocks.slice(0, i + 1), { id: blockId(), narration: "", visual: "", motion: "", seconds: 4 }, ...blocks.slice(i + 1)])}
          />
        ))}
      </ol>
      <div className="sticky bottom-0 z-10 -mx-3 border-t bg-background/90 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" aria-live="polite">
            {update.isPending ? <Loader2 className="size-3 animate-spin" /> : dirty ? null : <Check className="size-3" />}
            {update.isPending ? "Saving…" : dirty ? "Unsaved" : "Saved"}
          </span>
          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{formatLength(seconds)}</span>
          <EstimateLine data={estimate.data} loading={estimate.isFetching} engine={ep.settings.engine} className="min-w-0 flex-1" />
          <Button onClick={() => void render()} disabled={action.isPending || update.isPending} className="rounded-full">
            {action.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} Render episode
          </Button>
        </div>
      </div>
    </div>
  );
}
