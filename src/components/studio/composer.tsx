"use client";

import { ArrowUp, AtSign, GalleryHorizontalEnd, Loader2, Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { estimateCost, planGeneration, routesFor } from "@/lib/catalog/plan";
import type { GenerationRequest, MediaKind, ModelDef, Operation, Preset } from "@/lib/catalog/types";
import { enhance, useCreateGeneration, useElements, useEngine, useHydrated, useStatus } from "@/lib/api";
import { applyMentions, type StudioElement } from "@/lib/catalog/elements";
import { applySketch, stripMotionPaths } from "@/lib/catalog/sketch";
import { chainGapProblem, chainTiming, frameSupport, framesBlocker, framesDuration, framesDurations, framesNote, FRAMES_MODELS, frameTimes, keyframeChain, moveFrameAt, type FrameSupport } from "@/lib/catalog/keyframes";
import {
  blockerFor,
  costLabel,
  enterFrames,
  filterModels,
  firstMissingSlot,
  framesRequest,
  framesShape,
  leaveFrames,
  namedImageSlots,
  needsMask,
  onImageChange,
  PLACEHOLDER,
  promptShown,
  pushRecent,
  settingsShape,
  startStep,
} from "@/lib/composer";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AttachMenu } from "./attach-menu";
import { useAttach, useComposerBridge, useUploadReaper } from "./attachments";
import { DialogueEditor, LanguageChip, VoicePicker } from "./audio-controls";
import { FramesStrip, type FramesNotice } from "./frames-strip";
import { loadFullCatalog, useCatalog } from "./catalog";
import { Chip, chipBase, chipIdle } from "./chip";
import { MediaSlot, SlotPreview, type SlotValue } from "./media-slot";
import { ControlsChip, ProviderPresetChip } from "./model-controls";
import { ModelPicker } from "./model-picker";
import { ELEMENT_ICONS, PromptInput, type PromptInputHandle } from "./prompt-input";
import { radioKeys, radioTab } from "./radio-keys";
import { SettingsChip } from "./settings-panel";
import { ShotsEditor } from "./shots-editor";
import { SketchTools } from "./sketch-tools";
import { RECENT_MODELS, useStoredList } from "./stored-list";
import { useStartRequest, useStudio, type Draft } from "./studio-context";
import { useEdgeFade } from "./use-edge-fade";
import { useSignature } from "../palettes/use-signature";

const EMPTY: StudioElement[] = [];

/** The motion / effect picker (and its preset icons) is its own chunk: only video studios load it. */
const PresetChips = dynamic(() => import("./preset-chips"), {
  loading: () => <span aria-hidden className="h-8 w-32 shrink-0 animate-pulse rounded-full bg-secondary" />,
});

/** Color signature + Moodboard chips (studios with `signature`): their own chunk too. */
const SignatureChips = dynamic(() => import("../palettes/signature-chips"), {
  loading: () => <span aria-hidden className="h-8 w-40 shrink-0 animate-pulse rounded-full bg-secondary" />,
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

/** Frames mode, as the request needs it: what the model does with frames, the clip's length, and whether it's the open chain. */
interface FramesContext {
  support: FrameSupport;
  duration: number;
  chained: boolean;
}

function buildRequest(
  feature: string,
  draft: Pick<Draft, "slots" | "refs" | "presetId" | "modelId" | "prompt" | "negativePrompt" | "params" | "presetOptions" | "presetStrength" | "mix" | "frames">,
  op: Operation | undefined,
  promptSuffix?: string,
  refKind: MediaKind = "image",
  frames?: FramesContext,
): GenerationRequest {
  const s = draft.slots;
  const refs = draft.refs.filter((x) => !!x?.ref).map((x) => x.ref);
  let images = [s.image, s.image2, s.image3].filter((x): x is SlotValue => !!x?.ref).map((x) => x.ref).concat(refKind === "image" ? refs : []);
  const videos = refKind === "video" ? refs : [];
  let endImage = s.endImage?.ref || undefined;
  let params = draft.params;
  // Frames mode: the stills in order at their times (or the first and last as start and end frame), at the strip's length.
  if (draft.frames && frames) {
    const sent = framesRequest(draft.frames, frames);
    images = sent.images;
    endImage = sent.endImage;
    params = { ...params, ...sent.params };
  }
  return {
    feature,
    presetId: draft.presetId,
    modelId: draft.modelId,
    op,
    prompt: promptSuffix && draft.prompt.trim() ? `${draft.prompt.trim().replace(/[.\s]+$/, "")}. ${promptSuffix}` : draft.prompt,
    negativePrompt: draft.negativePrompt || undefined,
    inputs: {
      images: images.length ? images : undefined,
      endImage,
      mask: s.mask?.ref || undefined,
      sketch: s.sketch?.ref || undefined,
      voiceAudio: s.voiceAudio?.ref || undefined,
      voiceAudio2: s.voiceAudio2?.ref || undefined,
      video: s.video?.ref || undefined,
      audio: s.audio?.ref || undefined,
      videos: videos.length && !draft.frames ? videos : undefined,
    },
    params,
    presetOptions: draft.presetOptions,
    ...(draft.presetId && draft.presetStrength !== undefined && draft.presetStrength < 1 && { presetStrength: draft.presetStrength }),
    ...(draft.presetId && draft.mix && { mix: draft.mix }),
  };
}

/** Docked and collapsed, the composer hides its tiles: this event asks it to open first. */
const EXPAND_EVENT = "composer:expand";

/** Point at an attachment tile: scroll it into view and pulse its outline. */
function pulseSlot(root: HTMLElement | null, key: string, retried = false) {
  const el = root?.querySelector<HTMLElement>(`[data-slot-key="${key}"]`);
  if (!el) {
    if (retried || !root) return;
    root.dispatchEvent(new Event(EXPAND_EVENT));
    requestAnimationFrame(() => pulseSlot(root, key, true));
    return;
  }
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

/** An empty attachment tile's upload button (focus it, or click it from a toast action to open the file picker). */
function slotButton(root: HTMLElement | null, key: string) {
  return root?.querySelector<HTMLButtonElement>(`[data-slot-key="${key}"] button[aria-label$=": upload"]`) ?? null;
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
  // Typed into before the page hydrated: the prompt already has focus (onFocus never ran).
  useLayoutEffect(() => {
    if (root.current?.contains(document.activeElement)) setFocused(true);
  }, []);
  useEffect(() => {
    const el = root.current;
    const expand = () => setFocused(true);
    el?.addEventListener(EXPAND_EVENT, expand);
    return () => el?.removeEventListener(EXPAND_EVENT, expand);
  }, []);

  const preset: Preset | undefined = draft.presetId ? catalog.getPreset(draft.presetId) : config.preset;
  const lockedModel = preset?.type === "app";
  const pickerOps = config.pickerOps ?? config.ops;
  const models = useMemo(() => filterModels(catalog.models, { kind: config.kind, ops: pickerOps }), [catalog.models, config.kind, pickerOps]);
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
  const opts = model?.options ?? {};
  // Try-on names its images: "Person photo", then "Add garment" (instead of "Image" / "Add ref").
  const baseSlots = preset?.inputs ?? config.slots;
  const named = useMemo(
    () => namedImageSlots(baseSlots, model?.options.imageLabels, config.multiRef?.label, draft.refs.length),
    [baseSlots, model?.options.imageLabels, config.multiRef?.label, draft.refs.length],
  );
  const slots = named.slots;
  // Clips: ComfyUI joins 4 at a time. Images: what the model takes beyond the fixed image slots.
  const refMax = !config.multiRef
    ? 0
    : config.multiRef.kind === "video"
      ? Math.min(config.multiRef.max, model?.engine === "open" ? 4 : config.multiRef.max)
      : Math.min(config.multiRef.max, Math.max(0, (opts.maxImages ?? 1) - slots.filter((s) => s.accept === "image").length));
  const attach = useAttach(slots, refMax);

  // Frames mode (Video studio): up to 10 stills at their times, as the picked model can take them.
  const framesOn = !!config.frames && !!draft.frames;
  const framesCtx: FramesContext | undefined =
    framesOn && model ? { support: frameSupport(model), duration: framesDuration(model, draft.params.duration), chained: !!keyframeChain(model) } : undefined;

  // The page's drop zone hands its files to this composer.
  useEffect(() => {
    if (!bridgeRef) return;
    bridgeRef.current = attach.attachFiles;
    return () => {
      if (bridgeRef.current === attach.attachFiles) bridgeRef.current = null;
    };
  }, [bridgeRef, attach.attachFiles]);

  // A picked palette / moodboard routes the request (and can move it to another model) before anything else.
  const signature = useSignature(!!config.signature, draft.signature);
  const prepare = (d: typeof draft) => {
    const signed = signature.apply(buildRequest(config.feature, d, studioOp, config.promptSuffix, config.multiRef?.kind, framesCtx));
    // Planned with the signature's sentences in the prompt (as the server runs it); sent with them apart.
    const raw = signed.worded;
    const m = catalog.getModel(raw.modelId) ?? model;
    const mentions = m ? applyMentions(raw, m, elements) : { request: raw, mentioned: [], notes: [] };
    const sketched = m ? applySketch(mentions.request, m) : { request: mentions.request };
    return { mentions, sketched, signed, request: m ? stripMotionPaths(sketched.request, m) : sketched.request };
  };
  const { mentions, sketched, signed } = prepare(draft);
  const resolvesOnServer = mentions.mentioned.length > 0 || !!draft.slots.mask?.ref || !!draft.slots.sketch?.ref;

  // Plan with stand-ins for attachments that are missing or still uploading, so the cost and the
  // operation are known up front and the blocker can name the slot in the studio's own words.
  // Studios that need one of several inputs (Lipsync: a portrait or a video) name the group.
  const anyOf = preset?.inputs ? undefined : config.anyOf;
  const missing = firstMissingSlot(slots, draft.slots, anyOf);
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
      for (const g of anyOf ?? []) {
        const first = slots.find((s) => s.key === g[0]);
        if (first && !g.some((k) => planSlots[k]?.ref)) planSlots[first.key] = { ref: PLACEHOLDER[first.accept], preview: "", kind: first.accept };
      }
      const { request: planned } = prepare({
        ...draft,
        slots: planSlots,
        refs: draft.refs.map((r) => stand(r, r.kind) as SlotValue),
        frames: draft.frames?.map((f) => ({ ...f, value: stand(f.value, "image") as SlotValue })),
      });
      const plan = planGeneration({ ...planned, prompt: planned.prompt || (config.promptOptional ? " " : "") }, catalog.getModel, catalog.getPreset);
      op = plan.op;
      cost = estimateCost(plan.model, plan.params, plan.jobs);
    } catch (e) {
      planError = (e as Error).message;
    }
  }
  if (signed.blocker) planError = signed.blocker;
  // Models that take no prompt (try-on, 3D, transcription, upscalers), or can run without one, never ask for one.
  const promptMissing =
    !config.promptOptional && !opts.promptless && !opts.promptOptional && preset?.userPrompt !== "none" && preset?.userPrompt !== "optional" && !draft.prompt.trim() && !draft.params.shots?.some((s) => s.prompt.trim());
  const blocker = blockerFor({
    loading: !catalog.ready ? "Loading models…" : presetLoading ? "Loading presets…" : null,
    model: !!model,
    engineError,
    frames: framesOn && model ? framesBlocker(model, draft.frames!.length) : null,
    missing,
    uploading,
    maskMissing: needsMask(model, config.sketch, draft.slots),
    planError,
    promptMissing,
  });

  const submit = () => {
    if (blocker || create.isPending || signature.lock.isPending) {
      if (blocker) {
        // One blocker toast at a time (pressing Generate again replaces it), gone once a run starts.
        // A missing photo or clip: the toast's Upload opens the file picker (a click, so the browser allows it).
        const slot = blocker.slot;
        toast(blocker.message, { id: "composer-blocker", action: slot ? { label: "Upload", onClick: () => slotButton(root.current, slot)?.click() } : undefined });
        // Point at the tile to fill: the missing slot, or the clip list of a tool that only takes clips.
        const target = slot ?? (config.multiRef && config.hidePrompt && draft.refs.length < 2 ? "refs" : undefined);
        if (target) pulseSlot(root.current, target);
      }
      return;
    }
    toast.dismiss("composer-blocker");
    setRecent((r) => pushRecent(r, draft.modelId));
    // The server resolves @mentions and drawings itself; only pin the operation when there are none.
    // No "Queued" toast: the new card (and the "1 generating ↑" pill when it's off-screen) says it.
    const sent = signature.apply(buildRequest(config.feature, draft, resolvesOnServer ? studioOp : op, config.promptSuffix, config.multiRef?.kind, framesCtx));
    // Open palette lock: the images are recoloured to the palette by a chained step (POST /api/palettes/lock).
    if (sent.lock) return signature.lock.mutate({ request: sent.request, colors: sent.lock.colors }, { onError: (e) => toast.error((e as Error).message) });
    create.mutate(sent.request, {
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
  // Studios with the Moodboard chip pick Soul's styles there (its Curated tab), not in a second Style chip.
  const soulStyles = !!config.signature && (opts.presets?.source === "soul-v1" || opts.presets?.source === "soul-v2");
  const opNote = op && model ? routesFor(model, op)[0]?.note : undefined;
  const showPrompt = promptShown(config.hidePrompt, preset?.userPrompt, model?.options.promptless);
  const effectiveOp = studioOp ?? op;
  const baseShape = settingsShape(model, effectiveOp, config.kind, showPrompt, p, config.ops);
  const shape = framesCtx ? framesShape(baseShape, framesCtx.chained) : baseShape;
  const demo = !!(model && status && status.demoMode !== "off" && !model.routes.some((r) => status.providers[r.provider]?.configured));
  const costText = costLabel({ demo, cost }, formatCost);

  // Attachments: only when something is attached, a required slot is still empty, or none of a "one of these" group is filled (U8).
  const kinds = [...attach.kinds];
  const hasAttachment = slots.some((s) => draft.slots[s.key]) || draft.refs.length > 0;
  // Tools whose only input is a list of clips (Join clips) keep their "Add clip" tile in view.
  const showAttachments =
    framesOn ||
    ((slots.length > 0 || !!config.multiRef) && (hasAttachment || !!missing || !!slots.find((s) => s.required && !draft.slots[s.key]) || (!!config.multiRef && !showPrompt)));
  const collapsed = docked && !focused;
  // Docked and not focused, the tiles fold into one chip on the toolbar (the composer stays one line).
  const attached = [...slots.map((s) => draft.slots[s.key]), ...draft.refs, ...(draft.frames ?? []).map((f) => f.value)].filter((v): v is SlotValue => !!v);

  // A blocker toast goes away once it's out of date: the photo attached, the prompt typed (or the next blocker is a different one).
  const blocking = blocker?.message;
  useEffect(() => {
    toast.dismiss("composer-blocker");
  }, [blocking]);

  // Home's Start (go=<token>): run the handed-over prompt once the models and uploads have settled. A
  // blocker (Edit's photo) gets the usual toast, and its slot is pointed at, instead.
  const startRequest = useStartRequest();
  const startedFor = useRef(0);
  const submitRef = useRef(submit);
  useLayoutEffect(() => {
    submitRef.current = submit;
  });
  const settling = !catalog.ready || presetLoading || uploading || (needsFull && !catalog.complete);
  const step = startRequest ? startStep({ settling, blocker }) : "wait";
  const blockedSlot = blocker?.slot;
  useEffect(() => {
    if (step === "wait" || startRequest <= startedFor.current) return;
    startedFor.current = startRequest;
    // After the blocker toast above was cleared for this render.
    submitRef.current();
    // Nothing ran: the missing tile gets the focus, so Enter opens the file picker.
    if (step === "explain" && blockedSlot) requestAnimationFrame(() => slotButton(root.current, blockedSlot)?.focus({ preventScroll: true }));
  }, [step, startRequest, blockedSlot]);

  const pickModel = (m: ModelDef) => {
    setDraft((d) => ({ modelId: m.id, params: { ...m.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt, seed: d.params.seed } }));
    if (m.engine !== engine) setEngine(m.engine);
  };

  // Frames on: the start and end frames already attached become the first frames. Off: the first and last frames
  // go back to start and end (the ones in between can come back with Undo).
  const framesLength = framesCtx?.duration ?? (model ? framesDuration(model, p.duration) : p.duration);
  const toggleFrames = () => {
    if (!draft.frames) {
      setDraft((d) => {
        const entered = enterFrames(d.slots);
        const cleared = onImageChange(d, entered.slots);
        return { frames: entered.frames, slots: cleared.slots, params: { ...(cleared.params ?? d.params), shots: undefined, multiShot: undefined, duration: framesLength } };
      });
      setFocused(true);
      return;
    }
    const before = { frames: draft.frames, slots: draft.slots, params: draft.params };
    const { slots: back, dropped } = leaveFrames(draft.frames, draft.slots);
    // A length only the open chain makes goes back to the nearest one the model makes on its own.
    const lengths = opts.durations;
    const duration = lengths?.length && p.duration !== undefined && !lengths.includes(p.duration) ? lengths.reduce((a, b) => (Math.abs(b - p.duration!) < Math.abs(a - p.duration!) ? b : a)) : p.duration;
    setDraft({ frames: undefined, slots: back, params: { ...p, duration } });
    if (dropped) toast(`Frames off — frames 1 and ${draft.frames.length} are your start and end frames`, { action: { label: "Undo", onClick: () => setDraft(before) } });
  };

  // What the model does with the frames, said under the strip before anything runs (with the model that takes them all).
  let framesNotice: FramesNotice | null = null;
  if (framesCtx && model && draft.frames) {
    const alt = catalog.getModel(FRAMES_MODELS[model.engine].id);
    const action = alt && alt.id !== model.id ? { label: `Use ${alt.name}`, onClick: () => pickModel(alt) } : undefined;
    const count = draft.frames.length;
    const times = frameTimes(draft.frames.map((f) => f.at), framesCtx.duration);
    const gap = framesCtx.chained && count > 1 ? chainGapProblem(times, framesCtx.duration, chainTiming(model)) : null;
    const note = framesNote(model, count, draft.frames.at(-1)?.at);
    if (framesCtx.support === "start" || framesCtx.support === "none") framesNotice = { text: `${framesBlocker(model, count)!.message}.`, tone: "warn", action };
    else if (gap) framesNotice = { text: `${gap}.`, tone: "warn" };
    else if (note) framesNotice = { text: note, tone: "info", action };
  }
  const framesChip = config.frames ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Chip icon={GalleryHorizontalEnd} active={framesOn} aria-pressed={framesOn} onClick={toggleFrames}>
          Frames
        </Chip>
      </TooltipTrigger>
      <TooltipContent>{framesOn ? "Back to a start and an end frame" : "Up to 10 frames, each at its own time"}</TooltipContent>
    </Tooltip>
  ) : null;

  // Voice, language, motion, style and Director chips: inline from sm up; on phones they live in the settings sheet, so the toolbar fits.
  const voiceChips = (
    <>
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
    </>
  );
  const styleChips = (
    <>
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
      {config.signature && (
        <SignatureChips
          value={draft.signature}
          onChange={(update) => setDraft((d) => ({ signature: update(d.signature) }))}
          engine={engine}
          presetSource={opts.presets?.source}
          styleId={soulStyles ? (p.extra?.[opts.presets!.param] as string | undefined) : undefined}
          onStyleIdTaken={() => setExtra(opts.presets!.param, undefined)}
        />
      )}
      {opts.presets && !soulStyles && <ProviderPresetChip spec={opts.presets} value={p.extra?.[opts.presets.param] as string | undefined} onChange={(id) => setExtra(opts.presets!.param, id)} />}
      {opts.controls && <ControlsChip controls={opts.controls} values={p.extra ?? {}} onChange={setExtra} />}
    </>
  );
  const hasSecondary =
    !!config.frames ||
    (!!model && (!!opts.voices?.length || !!opts.voiceClone || !!opts.languages || !!opts.presets || !!opts.controls)) ||
    !!config.presetPicker ||
    !!config.signature ||
    preset?.type === "motion" ||
    preset?.type === "effect";

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
      {framesOn && !collapsed && draft.frames && (
        <FramesStrip
          frames={draft.frames}
          duration={framesCtx?.duration ?? p.duration ?? 5}
          durations={model ? framesDurations(model) : [5]}
          onDuration={(duration) => setP({ duration })}
          onMove={(i, seconds) =>
            setDraft((d) => {
              if (!d.frames || !framesCtx) return {};
              const ats = moveFrameAt(d.frames.map((f) => f.at), i, seconds, framesCtx.duration);
              return { frames: d.frames.map((f, j) => ({ ...f, at: ats[j] })) };
            })
          }
          onFrame={attach.setFrameValue}
          onFrameFile={attach.uploadToFrame}
          onAddFile={(f) => attach.attachFiles([f])}
          onAddPick={attach.attach}
          onClose={toggleFrames}
          notice={framesNotice}
        />
      )}
      {showAttachments && !collapsed && !framesOn && (
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
              label={named.refLabel ?? config.multiRef.label}
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
            <div key={o.key} role="radiogroup" aria-label={o.label} onKeyDown={radioKeys} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[12px] text-muted-foreground">{o.label}</span>
              {o.choices.map((c) => {
                const sel = (draft.presetOptions[o.key] ?? o.default ?? o.choices[0].value) === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    tabIndex={radioTab(sel)}
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
        {/* Phones (below sm): "+", Settings (icon), the model (it shrinks to fit) and @; the other chips are in the settings sheet. */}
        <div ref={chipRow} style={fade} data-composer-toolbar className="scrollbar-none -my-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1">
          {kinds.length > 0 && <AttachMenu kinds={kinds} onFiles={attach.attachFiles} onPick={attach.attach} />}
          {collapsed && showAttachments && attached.length > 0 && (
            <button
              type="button"
              onClick={() => setFocused(true)}
              aria-label={`${attached.length} attached. Show attachments`}
              className={cn(chipBase, chipIdle, "gap-1.5 pl-1 max-sm:order-1")}
            >
              <span className="flex -space-x-2.5">
                {attached.slice(0, 3).map((v, i) => (
                  <span key={v.id ?? `${v.ref}-${i}`} className="size-6 overflow-hidden rounded-full border-2 border-secondary bg-muted">
                    <SlotPreview value={v} />
                  </span>
                ))}
              </span>
              <span className="tabular-nums">
                {attached.length}
                <span className="max-sm:hidden"> attached</span>
              </span>
            </button>
          )}
          {/* The model chip may shrink (its name truncates) on phones, so the row fits without scrolling. */}
          <span className="flex min-w-0 shrink-0 max-sm:order-2 max-sm:min-w-[4.5rem] max-sm:shrink max-sm:[&>button]:min-w-0 max-sm:[&>button]:shrink max-sm:[&>button>svg:first-child]:hidden">
            {!lockedModel ? (
              catalog.ready ? (
                <ModelPicker
                  models={models}
                  value={model}
                  engine={engine}
                  onEngineChange={setEngine}
                  defaultModels={config.defaultModels}
                  onChange={pickModel}
                />
              ) : (
                <Chip icon={Loader2} disabled className="[&>svg]:animate-spin">
                  Loading models…
                </Chip>
              )
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Chip icon={Sparkles}>
                    <span className="min-w-0 truncate">{model?.name ?? "…"}</span>
                  </Chip>
                </TooltipTrigger>
                <TooltipContent>{preset?.name} runs on {model?.name ?? "its own model"}</TooltipContent>
              </Tooltip>
            )}
          </span>
          {showPrompt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => promptRef.current?.startMention()}
                  // Phones: at the end of the row (typing @ does the same); folded away with the docked composer.
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:order-3",
                    collapsed && "max-sm:hidden",
                  )}
                  aria-label="Add an element"
                >
                  <AtSign className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add a character, location or prop · type @</TooltipContent>
            </Tooltip>
          )}
          <span className="contents max-sm:hidden">
            {framesChip}
            {voiceChips}
          </span>
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
            className="max-sm:order-1"
            extras={
              hasSecondary ? (
                <>
                  {framesChip}
                  {voiceChips}
                  {styleChips}
                </>
              ) : undefined
            }
          />
          <span className="contents max-sm:hidden">{styleChips}</span>
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
              disabled={create.isPending || signature.lock.isPending}
              aria-label={blocker ? `Generate — ${blocker.message}` : "Generate"}
              className={cn("size-10 shrink-0 rounded-full", blocker && "bg-muted text-subtle-foreground hover:bg-muted")}
            >
              {create.isPending || signature.lock.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
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
      {signed.notes.length > 0 && <p className="px-2 pt-1 text-[12px] text-muted-foreground">{signed.notes.join(" · ")}</p>}
      {model && op && model.options.endFrame === undefined && draft.slots.endImage?.ref && (
        <p className="px-2 pt-1 text-[12px] text-warning">{model.name} ignores the end frame — pick Kling 2.5, Veo 3.1, Seedance or Wan 2.2 to use it.</p>
      )}
    </div>
  );
}

export { buildRequest };
