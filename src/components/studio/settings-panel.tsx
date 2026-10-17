"use client";

import { ChevronDown, Loader2, Shuffle, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { OPERATION_LABELS, type GenParams, type ModelDef, type Operation } from "@/lib/catalog/types";
import { durationLabel, hiddenChanges, settingsSummary, type SettingsShape } from "@/lib/composer";
import { ratioValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SliderControls } from "./audio-controls";
import { Chip } from "./chip";
import { ResponsivePanel } from "./responsive-panel";
import { MultiShotControl } from "./shots-editor";

function RatioGlyph({ ratio }: { ratio: string }) {
  const r = ratioValue(ratio === "auto" ? "1:1" : ratio);
  const w = r >= 1 ? 18 : 18 * r;
  const h = r >= 1 ? 18 / r : 18;
  return <span className="inline-block rounded-[3px] border-[1.5px] border-current" style={{ width: w, height: h }} />;
}

function Section({ label, children, id }: { label: string; children: React.ReactNode; id?: string }) {
  return (
    <div className="space-y-1.5">
      <p id={id} className="text-[12px] font-medium text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({ label, options, value, onChange, format = (v) => String(v) }: { label: string; options: T[]; value: T; onChange: (v: T) => void; format?: (v: T) => string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-0.5 rounded-full bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={String(o)}
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "h-7 min-w-11 flex-1 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground tabular-nums transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            value === o && "bg-background text-foreground shadow-soft",
          )}
        >
          {format(o)}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange, children }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; children?: React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer">
          <span className="block text-[13px] font-medium">{label}</span>
          <span className="block text-[12px] leading-snug text-muted-foreground">{hint}</span>
        </label>
        {children}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export interface SettingsPanelProps {
  model?: ModelDef;
  op?: Operation;
  shape: SettingsShape;
  params: GenParams;
  setP: (patch: Partial<GenParams>) => void;
  setExtra: (key: string, v: unknown) => void;
  negativePrompt: string;
  setNegativePrompt: (v: string) => void;
  kind: "image" | "video" | string;
  enhancing: boolean;
  onRewrite: () => void;
  opNote?: string;
}

/**
 * One summary chip ("16:9 · 720p · 5s · ×1") for every output setting, opening a popover (a
 * bottom sheet on phones) with segmented controls, the mode toggles and Advanced.
 */
export function SettingsChip(props: SettingsPanelProps) {
  const { model, shape, params, negativePrompt } = props;
  const [open, setOpen] = useState(false);
  const parts = settingsSummary(shape, params, model);
  const extra = hiddenChanges(params, negativePrompt, model);
  const text = parts.length ? parts.join(" · ") : "Settings";
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title="Settings"
      className="w-[min(92vw,400px)] p-3.5"
      trigger={
        <Chip icon={SlidersHorizontal} aria-label={`Settings: ${parts.join(", ") || "defaults"}${extra ? `, ${extra} more changed` : ""}`} className="tabular-nums">
          {text}
          {extra > 0 && <span aria-hidden className="-mr-0.5 size-1.5 rounded-full bg-primary" />}
        </Chip>
      }
    >
      <SettingsBody {...props} />
    </ResponsivePanel>
  );
}

function SettingsBody({ model, op, shape, params: p, setP, setExtra, negativePrompt, setNegativePrompt, kind, enhancing, onRewrite, opNote }: SettingsPanelProps) {
  const opts = model?.options ?? {};
  const d = model?.defaults ?? {};
  const [advanced, setAdvanced] = useState(p.seed !== undefined || !!negativePrompt);
  return (
    <div className="space-y-4">
      {shape.aspect && (
        <Section label="Aspect ratio">
          <div role="radiogroup" aria-label="Aspect ratio" className="grid grid-cols-4 gap-1 sm:grid-cols-5">
            {shape.aspect.map((o) => {
              const sel = (p.aspectRatio ?? d.aspectRatio ?? shape.aspect![0]) === o;
              return (
                <button
                  key={o}
                  role="radio"
                  aria-checked={sel}
                  onClick={() => setP({ aspectRatio: o })}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-1.5 rounded-lg text-[11px] font-medium text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                    sel && "bg-brand-faint text-brand-text hover:bg-brand-faint-hover",
                  )}
                >
                  <span className="grid h-5 place-items-center">
                    <RatioGlyph ratio={o} />
                  </span>
                  {o === "auto" ? "Auto" : o}
                </button>
              );
            })}
          </div>
        </Section>
      )}
      {shape.resolution && (
        <Section label="Quality">
          <Segmented label="Quality" options={shape.resolution} value={p.resolution ?? d.resolution ?? shape.resolution[0]} onChange={(v) => setP({ resolution: v })} />
        </Section>
      )}
      {shape.duration && (
        <Section label="Duration">
          <Segmented label="Duration" options={shape.duration} value={p.duration ?? d.duration ?? shape.duration[0]} onChange={(v) => setP({ duration: v })} format={durationLabel} />
        </Section>
      )}
      {shape.count && (
        <Section label={kind === "video" ? "Videos" : "Images"}>
          <Segmented label={kind === "video" ? "Videos" : "Images"} options={[1, 2, 3, 4]} value={p.numOutputs ?? 1} onChange={(v) => setP({ numOutputs: v })} format={(v) => `×${v}`} />
        </Section>
      )}
      {shape.multiShot && model && (
        <Section label="Multi-shot">
          <MultiShotControl model={model} params={p} onChange={setP} />
        </Section>
      )}
      {(shape.draft || shape.audio || shape.enhance) && (
        <div className="divide-y rounded-xl border px-3">
          {shape.draft && (
            <Toggle label="Draft" hint={p.draft ? "Cheap 480p take — finish the one you like in 1080p" : "Preview at 480p first, then render the keeper in 1080p"} checked={!!p.draft} onChange={(v) => setP({ draft: v })} />
          )}
          {shape.audio && (
            <Toggle label="Audio" hint={p.generateAudio === false ? "Silent video (cheaper)" : "Native sound, music and dialogue"} checked={p.generateAudio !== false} onChange={(v) => setP({ generateAudio: v })} />
          )}
          {shape.enhance && (
            <Toggle label="Enhance prompt" hint="An LLM rewrites your prompt before generating" checked={!!p.enhancePrompt} onChange={(v) => setP({ enhancePrompt: v })}>
              <button
                type="button"
                onClick={onRewrite}
                disabled={enhancing}
                className="mt-1 inline-flex items-center gap-1 rounded text-[12px] font-medium text-brand-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
              >
                {enhancing ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />} Rewrite my prompt now
              </button>
            </Toggle>
          )}
        </div>
      )}
      {shape.sliders && model && (
        <Section label="Model settings">
          <SliderControls model={model} values={p.extra ?? {}} onChange={setExtra} />
        </Section>
      )}
      <Collapsible open={advanced} onOpenChange={setAdvanced}>
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md text-[12px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
          <Sparkles className="size-3.5" /> Advanced
          <ChevronDown className={cn("ml-auto size-3.5 transition-transform", advanced && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>Seed</span>
              <label className="flex items-center gap-2">
                Random
                <Switch checked={p.seed === undefined} onCheckedChange={(r) => setP({ seed: r ? undefined : Math.floor(Math.random() * 1e9) })} aria-label="Random seed" />
              </label>
            </div>
            {p.seed !== undefined && (
              <div className="flex gap-1.5">
                <input
                  type="number"
                  value={p.seed}
                  onChange={(e) => setP({ seed: Number(e.target.value) })}
                  aria-label="Seed"
                  className="h-8 flex-1 rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus:border-primary"
                />
                <Button variant="secondary" size="icon" className="size-8" onClick={() => setP({ seed: Math.floor(Math.random() * 1e9) })} aria-label="New random seed">
                  <Shuffle className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
          {opts.negativePrompt && (
            <div className="space-y-1.5">
              <span className="text-[12px] text-muted-foreground">Negative prompt</span>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={3}
                aria-label="Negative prompt"
                placeholder="blurry, low quality, extra fingers…"
                className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>
          )}
          {model && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {model.name} via {model.engine === "open" ? "ComfyUI" : [...new Set(model.routes.map((r) => r.provider))].join(" / ")}
              {op ? ` · ${OPERATION_LABELS[op]}` : ""}
              {opNote ? ` · ${opNote}` : ""}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
