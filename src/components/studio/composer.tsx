"use client";

import {
  ArrowUp,
  AtSign,
  FileVideo2,
  Clock,
  Copy as CopyIcon,
  Film,
  Loader2,
  Maximize,
  Ratio,
  Settings2,
  Shuffle,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { EFFECTS, getModel, getPreset, modelsFor, MOTIONS } from "@/lib/catalog";
import { estimateCost, planGeneration, routesFor } from "@/lib/catalog/plan";
import { OPERATION_LABELS, type GenerationRequest, type MediaKind, type ModelDef, type Operation, type Preset } from "@/lib/catalog/types";
import { enhance, useCreateGeneration, useElements, useEngine, useStatus } from "@/lib/api";
import { applyMentions, type StudioElement } from "@/lib/catalog/elements";
import { applySketch, stripMotionPaths } from "@/lib/catalog/sketch";
import { formatCost, ratioValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PRESET_ICONS } from "@/components/preset-icons";
import { fileToSlot, MediaSlot, SlotPreview, type SlotValue } from "./media-slot";
import { ControlsChip, ProviderPresetChip } from "./model-controls";
import { ModelPicker } from "./model-picker";
import { ELEMENT_ICONS, PromptInput, type PromptInputHandle } from "./prompt-input";
import { SketchTools } from "./sketch-tools";
import { MultiShotChip, ShotsEditor } from "./shots-editor";
import { DialogueEditor, LanguageChip, SlidersChip, VoicePicker } from "./audio-controls";
import { useStudio } from "./studio-context";
import { nanoid } from "nanoid";

const EMPTY: StudioElement[] = [];

/** Operations that transform one input into one result — no batch count. */
const SINGLE_TAKE = new Set<Operation | undefined>(["lipsync", "avatar", "upscale-video", "dub", "extend", "reframe", "finalize", "v2a", "interpolate"]);

/** Two speakers to start a dialogue with. */
const defaultLines = (m: ModelDef) => {
  const v = m.options.voices ?? [];
  return [
    { text: "", voice: v[0]?.id },
    { text: "", voice: v[1]?.id ?? v[0]?.id },
  ];
};

// ---------------------------------------------------------------------------
// Chips

function Chip({
  icon: Icon,
  children,
  active,
  ...props
}: React.ComponentProps<"button"> & { icon?: typeof Ratio; active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
        active ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary text-secondary-foreground hover:bg-accent",
        props.className,
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {children}
    </button>
  );
}

function RatioGlyph({ ratio }: { ratio: string }) {
  const r = ratioValue(ratio === "auto" ? "1:1" : ratio);
  const w = r >= 1 ? 18 : 18 * r;
  const h = r >= 1 ? 18 / r : 18;
  return <span className="inline-block rounded-[3px] border-[1.5px] border-current" style={{ width: w, height: h }} />;
}

function AspectChip({ options, value, onChange }: { options: string[]; value?: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip icon={Ratio}>{value ?? options[0]}</Chip>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start" side="top">
        <p className="px-1 pb-2 text-[13px] font-medium">Aspect ratio</p>
        <div className="grid grid-cols-4 gap-1">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1.5 rounded-lg text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent",
                value === o && "bg-brand-faint text-brand-text",
              )}
            >
              <span className="grid h-5 place-items-center">
                <RatioGlyph ratio={o} />
              </span>
              {o === "auto" ? "Auto" : o}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SegmentChip<T extends string | number>({
  icon,
  label,
  options,
  value,
  onChange,
  format = (v) => String(v),
}: {
  icon: typeof Ratio;
  label: string;
  options: T[];
  value?: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip icon={icon}>{value !== undefined ? format(value) : format(options[0])}</Chip>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-44 p-2" align="start" side="top">
        <p className="px-1 pb-2 text-[13px] font-medium">{label}</p>
        <div className="flex flex-wrap gap-1 rounded-full bg-muted p-0.5">
          {options.map((o) => (
            <button
              key={String(o)}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={cn(
                "h-7 min-w-12 flex-1 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition",
                value === o && "bg-background text-foreground shadow-soft",
              )}
            >
              {format(o)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PresetGrid({ list, value, onPick }: { list: Preset[]; value?: string; onPick: (id: string) => void }) {
  const [cat, setCat] = useState<string>("All");
  const cats = ["All", ...new Set(list.map((p) => p.category))];
  return (
    <>
      <div className="scrollbar-none mb-2 flex gap-1 overflow-x-auto">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={cn("h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-accent", cat === c && "bg-secondary text-foreground")}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto">
        {list
          .filter((p) => cat === "All" || p.category === cat)
          .map((p) => {
            const PI = PRESET_ICONS[p.look.icon] ?? Film;
            return (
              <button
                key={p.id}
                onClick={() => onPick(p.id)}
                className={cn("group flex flex-col items-start gap-1 overflow-hidden rounded-lg p-1 text-left ring-primary transition hover:bg-accent", value === p.id && "ring-2")}
              >
                <span className="grid aspect-video w-full place-items-center rounded-md text-white" style={{ background: `linear-gradient(135deg, ${p.look.from}, ${p.look.to})` }}>
                  <PI className="size-5 transition-transform duration-300 group-hover:scale-125" />
                </span>
                <span className="truncate px-0.5 text-[12px] font-medium">{p.name}</span>
              </button>
            );
          })}
      </div>
    </>
  );
}

function PresetChip({ type, value, onChange }: { type: "motion" | "effect"; value?: string; onChange: (id?: string) => void }) {
  const [open, setOpen] = useState(false);
  const list = type === "motion" ? MOTIONS : EFFECTS;
  const selected = value ? getPreset(value) : undefined;
  const Icon = selected ? (PRESET_ICONS[selected.look.icon] ?? Film) : Film;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip icon={Icon} active={!!selected}>
          {selected?.name ?? (type === "motion" ? "Camera motion" : "Effect")}
          {selected && (
            <X
              className="-mr-1 size-3.5 opacity-70 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined);
              }}
            />
          )}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,460px)] p-2" align="start" side="top" collisionPadding={12}>
        <PresetGrid
          list={list}
          value={value}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

const MIXABLE = [...MOTIONS, ...EFFECTS];
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Higgsfield's Mix: a second motion or effect on top of the first, each with a strength. */
function MixChip({
  primary,
  strength,
  mix,
  onChange,
}: {
  primary: Preset;
  strength: number;
  mix?: { presetId: string; strength: number };
  onChange: (patch: { presetStrength?: number; mix?: { presetId: string; strength: number } | undefined }) => void;
}) {
  const [open, setOpen] = useState(false);
  const second = mix ? getPreset(mix.presetId) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip icon={Shuffle} active={!!second}>
          {second ? `+ ${second.name}` : "Mix"}
          {second && (
            <X
              className="-mr-1 size-3.5 opacity-70 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange({ mix: undefined });
              }}
            />
          )}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,460px)] space-y-3 p-3" align="start" side="top" collisionPadding={12}>
        <div className="space-y-2.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium">{primary.name}</span>
              <span className="font-mono text-muted-foreground">{pct(strength)}</span>
            </div>
            <Slider min={0.1} max={1} step={0.05} value={[strength]} onValueChange={([v]) => onChange({ presetStrength: v })} aria-label={`${primary.name} strength`} />
          </div>
          {second && mix && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium">{second.name}</span>
                <span className="font-mono text-muted-foreground">{pct(mix.strength)}</span>
              </div>
              <Slider min={0.1} max={1} step={0.05} value={[mix.strength]} onValueChange={([v]) => onChange({ mix: { ...mix, strength: v } })} aria-label={`${second.name} strength`} />
            </div>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">{second ? "Swap the second preset:" : "Pick a second motion or effect to combine with it:"}</p>
        <PresetGrid
          list={MIXABLE.filter((p) => p.id !== primary.id && !p.inputs.some((i) => i.key === "endImage"))}
          value={mix?.presetId}
          onPick={(id) => onChange({ mix: { presetId: id, strength: mix?.strength ?? 0.6 } })}
        />
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------

function buildRequest(
  feature: string,
  draft: ReturnType<typeof useStudio>["draft"],
  op: Operation | undefined,
  promptSuffix?: string,
  refKind: MediaKind = "image",
): GenerationRequest {
  const s = draft.slots;
  const refs = draft.refs.filter((x) => !!x?.ref).map((x) => x.ref);
  const images = [s.image, s.image2, s.image3].filter((x): x is SlotValue => !!x?.ref).map((x) => x.ref).concat(refKind === "image" ? refs : []);
  const videos = refKind === "video" ? refs : [];
  return {
    feature,
    presetId: draft.presetId,
    modelId: draft.modelId,
    op,
    prompt: promptSuffix && draft.prompt.trim() ? `${draft.prompt.trim().replace(/[.\s]+$/, "")}. ${promptSuffix}` : draft.prompt,
    negativePrompt: draft.negativePrompt || undefined,
    inputs: {
      images: images.length ? images : undefined,
      endImage: s.endImage?.ref || undefined,
      mask: s.mask?.ref || undefined,
      sketch: s.sketch?.ref || undefined,
      voiceAudio: s.voiceAudio?.ref || undefined,
      voiceAudio2: s.voiceAudio2?.ref || undefined,
      video: s.video?.ref || undefined,
      audio: s.audio?.ref || undefined,
      videos: videos.length ? videos : undefined,
    },
    params: draft.params,
    presetOptions: draft.presetOptions,
    ...(draft.presetId && draft.presetStrength !== undefined && draft.presetStrength < 1 && { presetStrength: draft.presetStrength }),
    ...(draft.presetId && draft.mix && { mix: draft.mix }),
  };
}

export function Composer({ docked }: { docked: boolean }) {
  const { config, draft, setDraft, setSlot, addImage } = useStudio();
  const [engine, setEngine] = useEngine();
  const create = useCreateGeneration();
  const [enhancing, setEnhancing] = useState(false);
  const promptRef = useRef<PromptInputHandle>(null);
  const status = useStatus().data;
  const elements = useElements().data ?? EMPTY;

  const preset: Preset | undefined = draft.presetId ? getPreset(draft.presetId) : config.preset;
  const lockedModel = preset?.type === "app";
  const models = useMemo(() => modelsFor({ kind: config.kind, ops: config.ops }), [config.kind, config.ops]);
  const model: ModelDef | undefined = getModel(draft.modelId);

  // Keep the selected model in sync with the engine switch.
  useEffect(() => {
    if (!model || model.engine === engine) return;
    const next = lockedModel
      ? (engine === "open" ? preset?.open?.modelId : preset?.cloud?.modelId)
      : config.defaultModels[engine];
    if (next && getModel(next)) setDraft((d) => ({ modelId: next, params: { ...getModel(next)!.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt } }));
  }, [engine, model, lockedModel, preset, config.defaultModels, setDraft]);

  // Single-purpose studios (Extend, Reframe, Edit video…) pin their operation.
  const studioOp = config.ops.length === 1 && !preset ? config.ops[0] : undefined;
  const rawRequest = buildRequest(config.feature, draft, studioOp, config.promptSuffix, config.multiRef?.kind);
  const mentions = model ? applyMentions(rawRequest, model, elements) : { request: rawRequest, mentioned: [], notes: [] };
  const sketched = model ? applySketch(mentions.request, model) : { request: mentions.request };
  const request = model ? stripMotionPaths(sketched.request, model) : sketched.request;
  const resolvesOnServer = mentions.mentioned.length > 0 || !!draft.slots.mask?.ref || !!draft.slots.sketch?.ref;
  let op: Operation | undefined;
  let blocker: string | null = null;
  let cost: number | null = null;
  try {
    if (!model) throw new Error("Pick a model");
    if (lockedModel && preset && !(engine === "open" ? preset.open : preset.cloud)) {
      throw new Error(`${preset.name} has no ${engine === "open" ? "open-source" : "cloud"} version yet`);
    }
    const plan = planGeneration({ ...request, prompt: request.prompt || (config.promptOptional ? " " : "") }, getModel, getPreset);
    op = plan.op;
    cost = estimateCost(plan.model, plan.params, plan.jobs);
    for (const s of preset?.inputs ?? config.slots) {
      if (s.required && !draft.slots[s.key]?.ref) throw new Error(`Add ${s.label.toLowerCase()}`);
    }
    if (Object.values(draft.slots).some((v) => v?.uploading) || draft.refs.some((r) => r.uploading)) throw new Error("Uploading…");
    if (!config.promptOptional && preset?.userPrompt !== "none" && preset?.userPrompt !== "optional" && !draft.prompt.trim() && !draft.params.shots?.some((s) => s.prompt.trim())) {
      throw new Error("Write a prompt first");
    }
  } catch (e) {
    blocker = (e as Error).message;
  }

  const submit = () => {
    if (blocker || create.isPending) {
      if (blocker) toast(blocker);
      return;
    }
    // The server resolves @mentions and drawings itself; only pin the operation when there are none.
    create.mutate(buildRequest(config.feature, draft, resolvesOnServer ? studioOp : op, config.promptSuffix, config.multiRef?.kind), {
      onSuccess: (items) => {
        toast.success(items.length > 1 ? `${items.length} jobs queued` : "Queued", { duration: 1500 });
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  const runEnhance = async () => {
    if (!draft.prompt.trim()) return toast("Write a short idea first, then enhance it");
    setEnhancing(true);
    try {
      const p = await enhance(draft.prompt, config.kind, op ?? (config.kind === "video" ? "t2v" : "t2i"));
      setDraft({ prompt: p });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnhancing(false);
    }
  };

  // Paste images from the clipboard.
  const onPaste = (e: React.ClipboardEvent) => {
    const file = [...e.clipboardData.files].find((f) => /^(image|video|audio)\//.test(f.type));
    if (!file) return;
    e.preventDefault();
    const id = nanoid(6);
    void fileToSlot(file, (v) => {
      if (!v) return;
      addImage({ ...v, id });
    });
  };

  const slots = preset?.inputs ?? config.slots;
  const opts = model?.options ?? {};
  // Clips: ComfyUI joins 4 at a time. Images: what the model takes beyond the fixed image slots.
  const refMax = !config.multiRef
    ? 0
    : config.multiRef.kind === "video"
      ? Math.min(config.multiRef.max, model?.engine === "open" ? 4 : config.multiRef.max)
      : Math.min(config.multiRef.max, Math.max(0, (opts.maxImages ?? 1) - slots.filter((s) => s.accept === "image").length));
  const p = draft.params;
  const setP = (patch: Partial<typeof p>) => setDraft((d) => ({ params: { ...d.params, ...patch } }));
  const setExtra = (key: string, v: unknown) =>
    setDraft((d) => {
      const extra = { ...d.params.extra };
      if (v === undefined) delete extra[key];
      else extra[key] = v;
      return { params: { ...d.params, extra: Object.keys(extra).length ? extra : undefined } };
    });
  const opNote = op && model ? routesFor(model, op)[0]?.note : undefined;
  const showPrompt = !config.hidePrompt && preset?.userPrompt !== "none";

  return (
    <div
      className={cn(
        "group/composer w-full rounded-[20px] border bg-background p-2.5 shadow-soft transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint sm:rounded-composer",
        docked && "shadow-normal",
      )}
      onPaste={onPaste}
    >
      {/* Attachments */}
      {(slots.length > 0 || config.multiRef) && (
        <div className="scrollbar-none flex items-center gap-2 overflow-x-auto px-1 pt-1 pb-2">
          {slots.map((s) => (
            <MediaSlot
              key={s.key}
              label={s.label}
              kind={s.accept}
              required={s.required}
              value={draft.slots[s.key] ?? null}
              onChange={(v) => {
                setSlot(s.key, v);
                // A drawing belongs to the image it was made on.
                if (s.key === "image") setDraft((d) => ({ slots: { ...d.slots, mask: null, sketch: null } }));
              }}
            />
          ))}
          {config.sketch && draft.slots.image?.ref && !draft.slots.image.uploading && (
            <SketchTools modes={config.sketch} image={draft.slots.image.ref} autoOpen={config.sketchAutoOpen} />
          )}
          {config.multiRef &&
            draft.refs.map((r) => (
              <div key={r.id ?? r.ref} className="relative size-14 shrink-0 overflow-hidden rounded-xl border bg-muted">
                <SlotPreview value={r} />
                {r.uploading && (
                  <div className="absolute inset-0 grid place-items-center bg-background/60">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                )}
                <button
                  onClick={() => setDraft((d) => ({ refs: d.refs.filter((x) => x !== r) }))}
                  className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-foreground/80 text-background"
                  aria-label="Remove reference"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          {config.multiRef && draft.refs.length < refMax && (
            <MediaSlot
              label={config.multiRef.label}
              kind={config.multiRef.kind ?? "image"}
              value={null}
              onFile={(f) => {
                const id = nanoid(6);
                void fileToSlot(f, (v) =>
                  setDraft((d) => {
                    if (!v) return { refs: d.refs.filter((r) => r.id !== id) };
                    const exists = d.refs.some((r) => r.id === id);
                    return { refs: exists ? d.refs.map((r) => (r.id === id ? { ...v, id } : r)) : [...d.refs, { ...v, id }] };
                  }),
                );
              }}
              onChange={(v) => v && setDraft((d) => ({ refs: [...d.refs, { ...v, id: nanoid(6) }] }))}
            />
          )}
        </div>
      )}

      {/* Prompt */}
      {showPrompt && (
        <PromptInput
          ref={promptRef}
          value={draft.prompt}
          onChange={(v) => setDraft({ prompt: v })}
          onSubmit={submit}
          placeholder={preset?.promptPlaceholder ?? config.placeholder}
          elements={elements}
        />
      )}

      {/* Dialogue script */}
      {model && (studioOp ?? op) === "dialogue" && (
        <DialogueEditor model={model} lines={p.dialogue ?? defaultLines(model)} onChange={(dialogue) => setP({ dialogue })} />
      )}

      {/* Multi-shot */}
      {model?.options.multiShot && p.shots && <ShotsEditor model={model} shots={p.shots} onChange={(shots) => setP({ shots })} />}

      {/* @mentioned elements */}
      {mentions.mentioned.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          {mentions.mentioned.map((el) => {
            const Icon = ELEMENT_ICONS[el.kind];
            const words = mentions.notes.find((n) => n.startsWith(`${el.name} `));
            return (
              <Tooltip key={el.id}>
                <TooltipTrigger asChild>
                  <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border bg-background pr-2.5 pl-0.5 text-[12px] font-medium", words && "border-dashed text-muted-foreground")}>
                    <span className="grid size-6 place-items-center overflow-hidden rounded-full bg-muted">
                      {el.references[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={el.references[0]} alt="" className="size-full object-cover" />
                      ) : (
                        <Icon className="size-3.5" />
                      )}
                    </span>
                    {el.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {words ??
                    (el.loras.some((l) => l.modelId === model?.id)
                      ? `Uses ${el.name}'s trained LoRA on ${model?.name}`
                      : `${el.name}'s photos are sent as reference images`)}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}

      {/* Preset options (apps) */}
      {preset?.options?.length ? (
        <div className="flex flex-wrap gap-3 px-1.5 pb-2">
          {preset.options.map((o) => (
            <div key={o.key} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[12px] text-muted-foreground">{o.label}</span>
              {o.choices.map((c) => {
                const sel = (draft.presetOptions[o.key] ?? o.default ?? o.choices[0].value) === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setDraft((d) => ({ presetOptions: { ...d.presetOptions, [o.key]: c.value } }))}
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
                      sel ? "border-primary bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="flex items-end gap-2">
        <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible">
          {!lockedModel ? (
            <ModelPicker
              models={models}
              value={model}
              engine={engine}
              onEngineChange={setEngine}
              onChange={(m) => {
                setDraft((d) => ({ modelId: m.id, params: { ...m.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt, seed: d.params.seed } }));
                if (m.engine !== engine) setEngine(m.engine);
              }}
            />
          ) : (
            <Chip icon={Sparkles}>{model?.name}</Chip>
          )}
          {showPrompt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => promptRef.current?.startMention()}
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-accent"
                  aria-label="Add an element"
                >
                  <AtSign className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add a character, location or prop · type @</TooltipContent>
            </Tooltip>
          )}
          {config.presetPicker && (
            <PresetChip
              type={config.presetPicker}
              value={draft.presetId}
              onChange={(id) => setDraft(id ? { presetId: id } : { presetId: undefined, mix: undefined, presetStrength: undefined })}
            />
          )}
          {preset && (preset.type === "motion" || preset.type === "effect") && (
            <MixChip primary={preset} strength={draft.presetStrength ?? 1} mix={draft.mix} onChange={(patch) => setDraft(patch)} />
          )}
          {opts.aspectRatios && opts.aspectRatios.length > 1 && op !== "i2v" && op !== "flf2v" && (
            <AspectChip options={opts.aspectRatios} value={p.aspectRatio} onChange={(v) => setP({ aspectRatio: v })} />
          )}
          {opts.resolutions && opts.resolutions.length > 1 && (
            <SegmentChip icon={Maximize} label="Quality" options={opts.resolutions} value={p.resolution} onChange={(v) => setP({ resolution: v })} />
          )}
          {opts.durations && opts.durations.length > 1 && !p.shots && (
            <SegmentChip
              icon={Clock}
              label="Duration"
              options={opts.durations}
              value={p.duration}
              onChange={(v) => setP({ duration: v })}
              format={(v) => (v >= 1000 ? `${Math.round(v / 1000)}s` : `${v}s`)}
            />
          )}
          {config.kind === "image" && (
            <SegmentChip icon={CopyIcon} label="Images" options={[1, 2, 3, 4]} value={p.numOutputs ?? 1} onChange={(v) => setP({ numOutputs: v })} format={(v) => `×${v}`} />
          )}
          {config.kind === "video" && !SINGLE_TAKE.has((studioOp ?? op)!) && (
            <SegmentChip icon={CopyIcon} label="Videos" options={[1, 2, 3, 4]} value={p.numOutputs ?? 1} onChange={(v) => setP({ numOutputs: v })} format={(v) => `×${v}`} />
          )}
          {model && (opts.voices?.length || opts.voiceClone) && (studioOp ?? op) !== "dialogue" && (
            <VoicePicker
              model={model}
              voice={p.voice}
              sample={draft.slots.voiceAudio}
              label={(studioOp ?? op) === "voice-change" ? "New voice" : "Voice"}
              onChange={(c) => {
                if (c?.kind === "preset") setDraft((d) => ({ params: { ...d.params, voice: c.id }, slots: { ...d.slots, voiceAudio: null } }));
                if (c?.kind === "sample") setSlot("voiceAudio", c.value);
              }}
            />
          )}
          {/* Open-source dialogue clones each speaker from a sample. */}
          {model && opts.voiceClone && (studioOp ?? op) === "dialogue" &&
            (["voiceAudio", "voiceAudio2"] as const).map((key, i) => (
              <VoicePicker
                key={key}
                model={{ ...model, options: { ...model.options, voices: [] } }}
                sample={draft.slots[key]}
                label={`Speaker ${i ? "B" : "A"}`}
                onChange={(c) => c?.kind === "sample" && setSlot(key, c.value)}
              />
            ))}
          {model && opts.languages && (
            <LanguageChip
              languages={opts.languages}
              value={p.targetLanguage}
              label={(studioOp ?? op) === "dub" ? "Translate to…" : "Language"}
              onChange={(targetLanguage) => setP({ targetLanguage })}
            />
          )}
          {model && opts.sliders && <SlidersChip model={model} values={p.extra ?? {}} onChange={setExtra} />}
          {opts.multiShot && model && <MultiShotChip model={model} params={p} onChange={setP} />}
          {opts.draft && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Chip icon={FileVideo2} active={!!p.draft} onClick={() => setP({ draft: !p.draft })}>
                  Draft
                </Chip>
              </TooltipTrigger>
              <TooltipContent>{p.draft ? "Cheap 480p take — finish the one you like in 1080p" : "Draft mode: preview at 480p first, then render the keeper in 1080p"}</TooltipContent>
            </Tooltip>
          )}
          {opts.presets && (
            <ProviderPresetChip
              spec={opts.presets}
              value={p.extra?.[opts.presets.param] as string | undefined}
              onChange={(id) => setExtra(opts.presets!.param, id)}
            />
          )}
          {opts.controls && <ControlsChip controls={opts.controls} values={p.extra ?? {}} onChange={setExtra} />}
          {opts.audio === true && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Chip icon={p.generateAudio === false ? VolumeX : Volume2} active={p.generateAudio !== false} onClick={() => setP({ generateAudio: p.generateAudio === false })}>
                  Audio
                </Chip>
              </TooltipTrigger>
              <TooltipContent>{p.generateAudio === false ? "Silent video (cheaper)" : "Native sound, music and dialogue"}</TooltipContent>
            </Tooltip>
          )}
          {showPrompt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Chip icon={enhancing ? Loader2 : Sparkles} active={!!p.enhancePrompt} onClick={() => setP({ enhancePrompt: !p.enhancePrompt })} onDoubleClick={runEnhance} className={enhancing ? "[&>svg]:animate-spin" : undefined}>
                  Enhance
                </Chip>
              </TooltipTrigger>
              <TooltipContent>Rewrite the prompt with an LLM before generating · double-click to rewrite now</TooltipContent>
            </Tooltip>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Advanced settings">
                <Settings2 className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-3" align="start" side="top">
              <p className="text-[13px] font-medium">Advanced</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>Seed</span>
                  <span className="flex items-center gap-2">
                    Random
                    <Switch checked={p.seed === undefined} onCheckedChange={(r) => setP({ seed: r ? undefined : Math.floor(Math.random() * 1e9) })} />
                  </span>
                </div>
                {p.seed !== undefined && (
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      value={p.seed}
                      onChange={(e) => setP({ seed: Number(e.target.value) })}
                      className="h-8 flex-1 rounded-md border bg-background px-2 font-mono text-sm outline-none focus:border-primary"
                    />
                    <Button variant="secondary" size="icon" className="size-8" onClick={() => setP({ seed: Math.floor(Math.random() * 1e9) })}>
                      <Shuffle className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              {opts.negativePrompt && (
                <div className="space-y-1.5">
                  <span className="text-[12px] text-muted-foreground">Negative prompt</span>
                  <textarea
                    value={draft.negativePrompt}
                    onChange={(e) => setDraft({ negativePrompt: e.target.value })}
                    rows={3}
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
            </PopoverContent>
          </Popover>
        </div>
        <span className="hidden shrink-0 font-mono text-[12px] text-muted-foreground sm:inline">
          {model && status && status.demoMode !== "off" && !model.routes.some((r) => status.providers[r.provider]?.configured)
            ? "Demo · free"
            : cost === 0
              ? "Free"
              : cost != null
                ? `≈ ${formatCost(cost)}`
                : ""}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              onClick={submit}
              disabled={create.isPending}
              aria-label="Generate"
              className={cn("size-10 shrink-0 rounded-full", blocker && "bg-muted text-subtle-foreground hover:bg-muted")}
            >
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {blocker ?? (
              <span className="flex items-center gap-1.5">
                Generate <Kbd>↵</Kbd>
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
      {sketched.note && <p className="px-2 pt-1 text-[12px] text-muted-foreground">{sketched.note}</p>}
      {model && op && model.options.endFrame === undefined && draft.slots.endImage?.ref && (
        <p className="px-2 pt-1 text-[12px] text-warning">{model.name} ignores the end frame — pick Kling 2.5, Veo 3.1, Seedance or Wan 2.2 to use it.</p>
      )}
    </div>
  );
}

export { buildRequest };
