"use client";

import { ArrowUp, AtSign, Loader2, Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { estimateCost, planGeneration, routesFor } from "@/lib/catalog/plan";
import type { GenerationRequest, MediaKind, ModelDef, Operation, Preset } from "@/lib/catalog/types";
import { enhance, useCreateGeneration, useElements, useEngine, useHydrated, useStatus } from "@/lib/api";
import { applyMentions, type StudioElement } from "@/lib/catalog/elements";
import { applySketch, stripMotionPaths } from "@/lib/catalog/sketch";
import { blockerFor, costLabel, filterModels, firstMissingSlot, PLACEHOLDER, pushRecent, settingsShape } from "@/lib/composer";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AttachMenu } from "./attach-menu";
import { useAttach, useComposerBridge, useUploadReaper } from "./attachments";
import { DialogueEditor, LanguageChip, VoicePicker } from "./audio-controls";
import { loadFullCatalog, useCatalog } from "./catalog";
import { Chip } from "./chip";
import { MediaSlot, SlotPreview, type SlotValue } from "./media-slot";
import { ControlsChip, ProviderPresetChip } from "./model-controls";
import { ModelPicker } from "./model-picker";
import { ELEMENT_ICONS, PromptInput, type PromptInputHandle } from "./prompt-input";
import { SettingsChip } from "./settings-panel";
import { ShotsEditor } from "./shots-editor";
import { SketchTools } from "./sketch-tools";
import { RECENT_MODELS, useStoredList } from "./stored-list";
import { useStudio, type Draft } from "./studio-context";
import { useEdgeFade } from "./use-edge-fade";

const EMPTY: StudioElement[] = [];

/** The motion / effect picker (and its preset icons) is its own chunk: only video studios load it. */
const PresetChips = dynamic(() => import("./preset-chips"), {
  loading: () => <span aria-hidden className="h-8 w-32 shrink-0 animate-pulse rounded-full bg-secondary" />,
});

/** Two speakers to start a dialogue with. */
const defaultLines = (m: ModelDef) => {
  const v = m.options.voices ?? [];
  return [
    { text: "", voice: v[0]?.id },
    { text: "", voice: v[1]?.id ?? v[0]?.id },
  ];
};

// ---------------------------------------------------------------------------

function buildRequest(
  feature: string,
  draft: Pick<Draft, "slots" | "refs" | "presetId" | "modelId" | "prompt" | "negativePrompt" | "params" | "presetOptions" | "presetStrength" | "mix">,
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

/** Point at an attachment tile: scroll it into view and pulse its outline. */
function pulseSlot(root: HTMLElement | null, key: string) {
  const el = root?.querySelector<HTMLElement>(`[data-slot-key="${key}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "currentColor";
  el.animate(
    [
      { boxShadow: `0 0 0 0 color-mix(in oklab, ${primary} 70%, transparent)` },
      { boxShadow: `0 0 0 7px color-mix(in oklab, ${primary} 0%, transparent)` },
    ],
    { duration: 650, iterations: 2, easing: "ease-out" },
  );
}

export function Composer({ docked }: { docked: boolean }) {
  const { config, draft, setDraft, setSlot } = useStudio();
  const catalog = useCatalog();
  const [engine, setEngine] = useEngine();
  const create = useCreateGeneration();
  const [enhancing, setEnhancing] = useState(false);
  const [focused, setFocused] = useState(false);
  const promptRef = useRef<PromptInputHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  // Connection status can arrive before this Suspense subtree hydrates: render the server's view (no status) until then.
  const hydrated = useHydrated();
  const liveStatus = useStatus().data;
  const status = hydrated ? liveStatus : undefined;
  const liveElements = useElements().data;
  const elements = (hydrated && liveElements) || EMPTY;
  const [, setRecent] = useStoredList(RECENT_MODELS);
  const bridgeRef = useComposerBridge();
  const [chipRow, fade] = useEdgeFade<HTMLDivElement>();
  useUploadReaper(draft);

  const preset: Preset | undefined = draft.presetId ? catalog.getPreset(draft.presetId) : config.preset;
  const lockedModel = preset?.type === "app";
  const models = useMemo(() => filterModels(catalog.models, { kind: config.kind, ops: config.ops }), [catalog.models, config.kind, config.ops]);
  const model: ModelDef | undefined = catalog.getModel(draft.modelId);
  const presetLoading = !!draft.presetId && !preset && !catalog.complete;

  // Presets handed over in the URL, a Mix, or a model outside this studio's slice: fetch the full catalog.
  const needsFull = presetLoading || (!!draft.mix && !catalog.getPreset(draft.mix.presetId)) || (catalog.ready && !model);
  useEffect(() => {
    if (needsFull) void loadFullCatalog();
  }, [needsFull]);

  // Keep the selected model in sync with the engine switch.
  useEffect(() => {
    if (!model || model.engine === engine) return;
    const next = lockedModel ? (engine === "open" ? preset?.open?.modelId : preset?.cloud?.modelId) : config.defaultModels[engine];
    const m = next ? catalog.getModel(next) : undefined;
    if (m) setDraft((d) => ({ modelId: m.id, params: { ...m.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt } }));
  }, [engine, model, lockedModel, preset, config.defaultModels, setDraft, catalog]);

  // Single-purpose studios (Extend, Reframe, Edit video…) pin their operation.
  const studioOp = config.ops.length === 1 && !preset ? config.ops[0] : undefined;
  const slots = preset?.inputs ?? config.slots;
  const opts = model?.options ?? {};
  // Clips: ComfyUI joins 4 at a time. Images: what the model takes beyond the fixed image slots.
  const refMax = !config.multiRef
    ? 0
    : config.multiRef.kind === "video"
      ? Math.min(config.multiRef.max, model?.engine === "open" ? 4 : config.multiRef.max)
      : Math.min(config.multiRef.max, Math.max(0, (opts.maxImages ?? 1) - slots.filter((s) => s.accept === "image").length));
  const attach = useAttach(slots, refMax);

  // The page's drop zone hands its files to this composer.
  useEffect(() => {
    if (!bridgeRef) return;
    bridgeRef.current = attach.attachFiles;
    return () => {
      if (bridgeRef.current === attach.attachFiles) bridgeRef.current = null;
    };
  }, [bridgeRef, attach.attachFiles]);

  const prepare = (d: typeof draft) => {
    const raw = buildRequest(config.feature, d, studioOp, config.promptSuffix, config.multiRef?.kind);
    const mentions = model ? applyMentions(raw, model, elements) : { request: raw, mentioned: [], notes: [] };
    const sketched = model ? applySketch(mentions.request, model) : { request: mentions.request };
    return { mentions, sketched, request: model ? stripMotionPaths(sketched.request, model) : sketched.request };
  };
  const { mentions, sketched } = prepare(draft);
  const resolvesOnServer = mentions.mentioned.length > 0 || !!draft.slots.mask?.ref || !!draft.slots.sketch?.ref;

  // Plan with stand-ins for attachments that are missing or still uploading, so the cost and the
  // operation are known up front and the blocker can name the slot in the studio's own words.
  const missing = firstMissingSlot(slots, draft.slots);
  const uploading = Object.values(draft.slots).some((v) => v?.uploading) || draft.refs.some((r) => r.uploading);
  const engineError = lockedModel && preset && !(engine === "open" ? preset.open : preset.cloud) ? `${preset.name} has no ${engine === "open" ? "open-source" : "cloud"} version yet` : null;
  let op: Operation | undefined;
  let cost: number | null = null;
  let planError: string | null = null;
  if (model && !engineError && !presetLoading) {
    try {
      const stand = (v: SlotValue | null | undefined, kind: MediaKind): SlotValue | null | undefined => (v?.uploading ? { ...v, ref: PLACEHOLDER[kind] } : v);
      const planSlots: Draft["slots"] = Object.fromEntries(Object.entries(draft.slots).map(([k, v]) => [k, stand(v, v?.kind ?? "image")]));
      for (const s of slots) if (s.required && !planSlots[s.key]?.ref) planSlots[s.key] = { ref: PLACEHOLDER[s.accept], preview: "", kind: s.accept };
      const { request: planned } = prepare({ ...draft, slots: planSlots, refs: draft.refs.map((r) => stand(r, r.kind) as SlotValue) });
      const plan = planGeneration({ ...planned, prompt: planned.prompt || (config.promptOptional ? " " : "") }, catalog.getModel, catalog.getPreset);
      op = plan.op;
      cost = estimateCost(plan.model, plan.params, plan.jobs);
    } catch (e) {
      planError = (e as Error).message;
    }
  }
  const promptMissing =
    !config.promptOptional && preset?.userPrompt !== "none" && preset?.userPrompt !== "optional" && !draft.prompt.trim() && !draft.params.shots?.some((s) => s.prompt.trim());
  const blocker = blockerFor({
    loading: !catalog.ready ? "Loading models…" : presetLoading ? "Loading presets…" : null,
    model: !!model,
    engineError,
    missing,
    uploading,
    planError,
    promptMissing,
  });

  const submit = () => {
    if (blocker || create.isPending) {
      if (blocker) {
        toast(blocker.message);
        // Point at the tile to fill: the missing slot, or the clip list of a tool that only takes clips.
        const target = blocker.slot ?? (config.multiRef && config.hidePrompt && draft.refs.length < 2 ? "refs" : undefined);
        if (target) pulseSlot(root.current, target);
      }
      return;
    }
    setRecent((r) => pushRecent(r, draft.modelId));
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

  // Paste images, clips or audio from the clipboard (text pastes as usual).
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => /^(image|video|audio)\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    attach.attachFiles(files);
  };

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
  const effectiveOp = studioOp ?? op;
  const shape = settingsShape(model, effectiveOp, config.kind, showPrompt, p, config.ops);
  const demo = !!(model && status && status.demoMode !== "off" && !model.routes.some((r) => status.providers[r.provider]?.configured));
  const costText = costLabel({ demo, cost }, formatCost);

  // Attachments: only when something is attached or a required slot is still empty (U8).
  const kinds = [...attach.kinds];
  const hasAttachment = slots.some((s) => draft.slots[s.key]) || draft.refs.length > 0;
  // Tools whose only input is a list of clips (Join clips) keep their "Add clip" tile in view.
  const showAttachments =
    (slots.length > 0 || !!config.multiRef) && (hasAttachment || !!slots.find((s) => s.required && !draft.slots[s.key]) || (!!config.multiRef && !showPrompt));
  const collapsed = docked && !focused;

  return (
    <div
      ref={root}
      className={cn(
        "group/composer w-full rounded-[20px] border bg-background p-2.5 shadow-soft transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint sm:rounded-composer",
        docked && "shadow-normal",
      )}
      onPaste={onPaste}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        const to = e.relatedTarget as HTMLElement | null;
        // Moving into one of the composer's own popovers or sheets keeps it open.
        if (e.currentTarget.contains(to) || to?.closest("[data-radix-popper-content-wrapper],[role=dialog]")) return;
        setFocused(false);
      }}
      onKeyDown={(e) => {
        // ⌘/Ctrl+Enter generates from any field (shots, dialogue lines); the prompt handles Enter itself.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.defaultPrevented && !e.nativeEvent.isComposing) {
          e.preventDefault();
          submit();
        }
      }}
    >
      {showAttachments && (
        <div className="scrollbar-none flex items-center gap-2 overflow-x-auto px-1 pt-1.5 pb-2">
          {slots.map((s) => (
            <MediaSlot
              key={s.key}
              slotKey={s.key}
              label={s.label}
              kind={s.accept}
              required={s.required}
              value={draft.slots[s.key] ?? null}
              onChange={(v) => attach.setSlotValue(s.key, v)}
              onFile={(f) => attach.uploadToSlot(s.key, f, s.accept)}
            />
          ))}
          {config.sketch && draft.slots.image?.ref && !draft.slots.image.uploading && (
            <SketchTools modes={config.sketch} image={draft.slots.image.ref} autoOpen={config.sketchAutoOpen} />
          )}
          {config.multiRef &&
            draft.refs.map((r, i) => (
              <div key={r.id ?? r.ref} className="relative size-14 shrink-0 overflow-hidden rounded-xl border bg-muted">
                <SlotPreview value={r} />
                {r.uploading && (
                  <div className="absolute inset-0 grid place-items-center bg-background/60" role="status" aria-label="Uploading">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                )}
                <button
                  onClick={() => attach.removeRef(r)}
                  className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-foreground/80 text-background"
                  aria-label={`Remove ${config.multiRef?.kind === "video" ? "clip" : "reference"} ${i + 1}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          {config.multiRef && draft.refs.length < refMax && (
            <MediaSlot
              slotKey="refs"
              label={config.multiRef.label}
              kind={config.multiRef.kind ?? "image"}
              value={null}
              onFile={attach.addRefFile}
              onChange={(v) => v && setDraft((d) => ({ refs: [...d.refs, v] }))}
            />
          )}
        </div>
      )}

      {showPrompt && (
        <PromptInput
          ref={promptRef}
          value={draft.prompt}
          onChange={(v) => setDraft({ prompt: v })}
          onSubmit={submit}
          placeholder={preset?.promptPlaceholder ?? config.placeholder}
          elements={elements}
          collapsed={collapsed}
        />
      )}

      {model && effectiveOp === "dialogue" && <DialogueEditor model={model} lines={p.dialogue ?? defaultLines(model)} onChange={(dialogue) => setP({ dialogue })} />}

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
                  {words ?? (el.loras.some((l) => l.modelId === model?.id) ? `Uses ${el.name}'s trained LoRA on ${model?.name}` : `${el.name}'s photos are sent as reference images`)}
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
            <div key={o.key} role="radiogroup" aria-label={o.label} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[12px] text-muted-foreground">{o.label}</span>
              {o.choices.map((c) => {
                const sel = (draft.presetOptions[o.key] ?? o.default ?? o.choices[0].value) === c.value;
                return (
                  <button
                    key={c.value}
                    role="radio"
                    aria-checked={sel}
                    onClick={() => setDraft((d) => ({ presetOptions: { ...d.presetOptions, [o.key]: c.value } }))}
                    className={cn("h-7 rounded-full border px-2.5 text-[12px] font-medium transition-colors", sel ? "border-primary bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent")}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {/* Toolbar: one row; it scrolls (with faded edges) when it doesn't fit. */}
      <div className="flex items-center gap-2">
        <div ref={chipRow} style={fade} className="scrollbar-none -my-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1">
          {kinds.length > 0 && <AttachMenu kinds={kinds} onFiles={attach.attachFiles} onPick={attach.attach} />}
          {!lockedModel ? (
            catalog.ready ? (
              <ModelPicker
                models={models}
                value={model}
                engine={engine}
                onEngineChange={setEngine}
                defaultModels={config.defaultModels}
                onChange={(m) => {
                  setDraft((d) => ({ modelId: m.id, params: { ...m.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt, seed: d.params.seed } }));
                  if (m.engine !== engine) setEngine(m.engine);
                }}
              />
            ) : (
              <Chip icon={Loader2} disabled className="[&>svg]:animate-spin">
                Loading models…
              </Chip>
            )
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Chip icon={Sparkles}>{model?.name ?? "…"}</Chip>
              </TooltipTrigger>
              <TooltipContent>{preset?.name} runs on {model?.name ?? "its own model"}</TooltipContent>
            </Tooltip>
          )}
          {showPrompt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => promptRef.current?.startMention()}
                  // Phones: typing @ does the same, so the button gives its place to the settings chip.
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:order-last"
                  aria-label="Add an element"
                >
                  <AtSign className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add a character, location or prop · type @</TooltipContent>
            </Tooltip>
          )}
          {model && (opts.voices?.length || opts.voiceClone) && effectiveOp !== "dialogue" && (
            <VoicePicker
              model={model}
              voice={p.voice}
              sample={draft.slots.voiceAudio}
              label={effectiveOp === "voice-change" ? "New voice" : "Voice"}
              onChange={(c) => {
                if (c?.kind === "preset") setDraft((d) => ({ params: { ...d.params, voice: c.id }, slots: { ...d.slots, voiceAudio: null } }));
                if (c?.kind === "sample") setSlot("voiceAudio", c.value);
              }}
            />
          )}
          {/* Open-source dialogue clones each speaker from a sample. */}
          {model &&
            opts.voiceClone &&
            effectiveOp === "dialogue" &&
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
            <LanguageChip languages={opts.languages} value={p.targetLanguage} label={effectiveOp === "dub" ? "Translate to…" : "Language"} onChange={(targetLanguage) => setP({ targetLanguage })} />
          )}
          <SettingsChip
            model={model}
            op={op}
            shape={shape}
            params={p}
            setP={setP}
            setExtra={setExtra}
            negativePrompt={draft.negativePrompt}
            setNegativePrompt={(negativePrompt) => setDraft({ negativePrompt })}
            kind={config.kind}
            enhancing={enhancing}
            onRewrite={runEnhance}
            opNote={opNote}
          />
          {(config.presetPicker || (preset && (preset.type === "motion" || preset.type === "effect"))) && (
            <PresetChips
              picker={config.presetPicker}
              preset={preset}
              presetId={draft.presetId}
              strength={draft.presetStrength ?? 1}
              mix={draft.mix}
              onPreset={(id) => setDraft(id ? { presetId: id } : { presetId: undefined, mix: undefined, presetStrength: undefined })}
              onMix={(patch) => setDraft(patch)}
            />
          )}
          {opts.presets && <ProviderPresetChip spec={opts.presets} value={p.extra?.[opts.presets.param] as string | undefined} onChange={(id) => setExtra(opts.presets!.param, id)} />}
          {opts.controls && <ControlsChip controls={opts.controls} values={p.extra ?? {}} onChange={setExtra} />}
        </div>
        {costText && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 text-[12px] font-medium text-muted-foreground tabular-nums">
                <span className="sm:hidden">{costLabel({ demo, cost, compact: true }, formatCost)}</span>
                <span className="hidden sm:inline">{costText}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {demo ? "Demo mode: no key connected for this model, so outputs are free placeholders" : cost === 0 ? "Runs on your own GPU" : "Estimated cost, billed by the provider to your key"}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              onClick={submit}
              disabled={create.isPending}
              aria-label={blocker ? `Generate — ${blocker.message}` : "Generate"}
              className={cn("size-10 shrink-0 rounded-full", blocker && "bg-muted text-subtle-foreground hover:bg-muted")}
            >
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {blocker?.message ?? (
              <span className="flex items-center gap-1.5">
                Generate <Kbd>↵</Kbd>
                {costText && <span className="text-muted-foreground tabular-nums">· {costText}</span>}
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
