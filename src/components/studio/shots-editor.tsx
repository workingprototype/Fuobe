"use client";

import { Clapperboard, FileVideo2, Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GenParams, ModelDef } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

type Shot = NonNullable<GenParams["shots"]>[number];

const chip = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors";

/** Off · Auto (the model cuts by itself) · Custom (you write each shot). */
export function MultiShotChip({ model, params, onChange }: { model: ModelDef; params: GenParams; onChange: (p: Partial<GenParams>) => void }) {
  const [open, setOpen] = useState(false);
  const ms = model.options.multiShot!;
  const mode = params.shots ? "custom" : params.multiShot === "auto" ? "auto" : "off";
  const each = Math.max(1, Math.floor((params.duration ?? model.defaults?.duration ?? 6) / 2));
  const options = [
    { id: "off", label: "Off", hint: "One continuous shot" },
    { id: "auto", label: "Auto", hint: "The model plans the cuts" },
    { id: "custom", label: "Custom", hint: `Write up to ${ms.maxShots} shots` },
  ] as const;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(chip, mode !== "off" ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary text-secondary-foreground hover:bg-accent")}>
          <Clapperboard className="size-3.5" />
          {mode === "custom" ? `${params.shots!.length} shots` : mode === "auto" ? "Multi-shot · Auto" : "Multi-shot"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start" side="top">
        <p className="px-1 pb-2 text-[13px] font-medium">Multi-shot</p>
        <div className="space-y-1">
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                if (o.id === "off") onChange({ shots: undefined, multiShot: undefined });
                if (o.id === "auto") onChange({ shots: undefined, multiShot: "auto" });
                if (o.id === "custom" && !params.shots)
                  onChange({
                    multiShot: undefined,
                    shots: [
                      { prompt: "", duration: each },
                      { prompt: "", duration: each },
                    ],
                  });
                setOpen(false);
              }}
              className={cn("flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent", mode === o.id && "bg-brand-faint")}
            >
              <span className={cn("text-[13px] font-medium", mode === o.id && "text-brand-text")}>{o.label}</span>
              <span className="text-[12px] text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </div>
        <p className="px-1 pt-2 text-[11px] text-muted-foreground">
          {ms.mode === "native" ? `${model.name} takes each shot as its own prompt.` : `${model.name} follows shots written into the prompt.`}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** Per-shot prompts and durations, shown under the main prompt in Custom mode. */
export function ShotsEditor({ model, shots, onChange }: { model: ModelDef; shots: Shot[]; onChange: (s: Shot[] | undefined) => void }) {
  const max = Math.max(...(model.options.durations ?? [15]));
  const total = shots.reduce((n, s) => n + s.duration, 0);
  const maxShots = model.options.multiShot?.maxShots ?? 6;
  const set = (i: number, patch: Partial<Shot>) => onChange(shots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const starts = shots.map((_, i) => shots.slice(0, i).reduce((n, s) => n + s.duration, 0));
  return (
    <div className="space-y-1.5 px-1.5 pb-2">
      {shots.map((s, i) => {
        const from = starts[i];
        return (
          <div key={i} className="flex items-start gap-2 rounded-xl border bg-muted/40 p-1.5 pl-2.5">
            <span className="mt-1.5 flex shrink-0 flex-col items-center text-[11px] leading-tight font-medium text-muted-foreground">
              <FileVideo2 className="mb-0.5 size-3.5" />
              {i + 1}
            </span>
            <textarea
              value={s.prompt}
              onChange={(e) => set(i, { prompt: e.target.value.slice(0, 512) })}
              rows={1}
              placeholder={i === 0 ? "Shot 1 — e.g. “wide: she steps out of the taxi into the rain”" : `Shot ${i + 1} — e.g. “close-up: she looks up at the neon sign”`}
              className="field-sizing-content max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1 text-[14px] leading-snug outline-none placeholder:text-subtle-foreground"
            />
            <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-background p-0.5 shadow-soft">
              <button onClick={() => set(i, { duration: Math.max(1, s.duration - 1) })} className="grid size-6 place-items-center rounded-full hover:bg-accent" aria-label="Shorter">
                <Minus className="size-3" />
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-8 text-center font-mono text-[12px] tabular-nums">{s.duration}s</span>
                </TooltipTrigger>
                <TooltipContent>
                  {from}–{from + s.duration}s
                </TooltipContent>
              </Tooltip>
              <button
                onClick={() => set(i, { duration: Math.min(15, s.duration + 1) })}
                disabled={total >= max}
                className="grid size-6 place-items-center rounded-full hover:bg-accent disabled:opacity-40"
                aria-label="Longer"
              >
                <Plus className="size-3" />
              </button>
            </div>
            <button
              onClick={() => onChange(shots.length > 1 ? shots.filter((_, j) => j !== i) : undefined)}
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Remove shot ${i + 1}`}
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-3 px-1">
        {shots.length < maxShots && (
          <button
            onClick={() => onChange([...shots, { prompt: "", duration: Math.max(1, Math.min(3, max - total)) }])}
            disabled={total >= max}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-text hover:underline disabled:opacity-40"
          >
            <Plus className="size-3" /> Add shot
          </button>
        )}
        <span className={cn("ml-auto font-mono text-[11px] text-muted-foreground", total > max && "text-destructive")}>
          {total}s of {max}s
        </span>
      </div>
    </div>
  );
}
