"use client";

import { FileVideo2, Minus, Plus, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GenParams, ModelDef } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { radioKeys, radioTab } from "./radio-keys";

type Shot = NonNullable<GenParams["shots"]>[number];

/** Off · Auto (the model cuts by itself) · Custom (you write each shot): a segmented control for the settings panel. */
export function MultiShotControl({ model, params, onChange }: { model: ModelDef; params: GenParams; onChange: (p: Partial<GenParams>) => void }) {
  const ms = model.options.multiShot!;
  const mode = params.shots ? "custom" : params.multiShot === "auto" ? "auto" : "off";
  const concat = ms.mode === "concat";
  const each = concat ? (model.defaults?.duration ?? 5) : Math.max(1, Math.floor((params.duration ?? model.defaults?.duration ?? 6) / 2));
  const options = [
    { id: "off", label: "Off", hint: "One continuous shot" },
    // Open models can't plan their own cuts.
    ...(concat ? [] : [{ id: "auto", label: "Auto", hint: "The model plans the cuts" } as const]),
    { id: "custom", label: "Custom", hint: `Write up to ${ms.maxShots} shots` },
  ] as const;
  const pick = (id: (typeof options)[number]["id"]) => {
    if (id === "off") onChange({ shots: undefined, multiShot: undefined });
    if (id === "auto") onChange({ shots: undefined, multiShot: "auto" });
    if (id === "custom" && !params.shots)
      onChange({
        multiShot: undefined,
        shots: [
          { prompt: "", duration: each },
          { prompt: "", duration: each },
        ],
      });
  };
  return (
    <div className="space-y-1.5">
      <div role="radiogroup" aria-label="Multi-shot" onKeyDown={radioKeys} className="flex rounded-full bg-muted p-0.5">
        {options.map((o) => (
          <Tooltip key={o.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={mode === o.id}
                tabIndex={radioTab(mode === o.id)}
                onClick={() => pick(o.id)}
                className={cn("h-7 flex-1 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition", mode === o.id && "bg-background text-foreground shadow-soft")}
              >
                {o.label}
              </button>
            </TooltipTrigger>
            <TooltipContent>{o.hint}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {ms.mode === "native"
          ? `${model.name} takes each shot as its own prompt.`
          : concat
            ? `Each shot renders as its own ${model.name} clip, then they're joined into one video.`
            : `${model.name} follows shots written into the prompt.`}
        {mode === "custom" && " Write each shot under the prompt."}
      </p>
    </div>
  );
}

/** Per-shot prompts and durations, shown under the main prompt in Custom mode. */
export function ShotsEditor({ model, shots, onChange }: { model: ModelDef; shots: Shot[]; onChange: (s: Shot[] | undefined) => void }) {
  const max = Math.max(...(model.options.durations ?? [15]));
  const total = shots.reduce((n, s) => n + s.duration, 0);
  const maxShots = model.options.multiShot?.maxShots ?? 6;
  // Joined films: every shot is a separate clip, so it takes one of the model's own durations.
  const concat = model.options.multiShot?.mode === "concat";
  const steps = concat ? [...(model.options.durations ?? [5])].sort((a, b) => a - b) : null;
  const stepTo = (d: number, dir: 1 | -1) => {
    if (!steps) return dir > 0 ? Math.min(15, d + 1) : Math.max(1, d - 1);
    return (dir > 0 ? steps.find((x) => x > d) : steps.findLast((x) => x < d)) ?? d;
  };
  const full = !concat && total >= max;
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
              <button onClick={() => set(i, { duration: stepTo(s.duration, -1) })} className="grid size-6 place-items-center rounded-full hover:bg-accent" aria-label="Shorter">
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
                onClick={() => set(i, { duration: stepTo(s.duration, 1) })}
                disabled={full || (!!steps && s.duration >= steps[steps.length - 1])}
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
            onClick={() => onChange([...shots, { prompt: "", duration: steps ? (model.defaults?.duration ?? steps[0]) : Math.max(1, Math.min(3, max - total)) }])}
            disabled={full}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-text hover:underline disabled:opacity-40"
          >
            <Plus className="size-3" /> Add shot
          </button>
        )}
        <span className={cn("ml-auto font-mono text-[11px] text-muted-foreground", !concat && total > max && "text-destructive")}>
          {concat ? `${total}s film · up to ${max}s a shot` : `${total}s of ${max}s`}
        </span>
      </div>
    </div>
  );
}
