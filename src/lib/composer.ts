/**
 * Pure composer logic shared by the studio composer and its tests: the settings summary chip,
 * blocker messages, attachment placement and model-picker grouping. No catalog import here, so
 * nothing in this file pulls the model list into the browser bundle.
 */
import type { Engine, GenParams, InputSlot, MediaKind, ModelDef, Operation, Preset } from "./catalog/types";
import { spokenLanguageName } from "./speech-languages";

// ---------------------------------------------------------------------------
// Settings summary ("16:9 · 720p · 5s · ×1")

/** Operations that transform one input into one result — no batch count. */
export const SINGLE_TAKE = new Set<Operation>([
  "lipsync", "avatar", "upscale-video", "upscale-image", "dub", "extend", "reframe", "finalize", "v2a", "interpolate",
  "bg-remove", "bg-remove-video", "depth-video", "concat", "color-match", "frame",
]);

export const durationLabel = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}s` : `${v}s`);

export interface SettingsShape {
  /** Show the aspect-ratio control (the model offers several and the operation isn't framed by an input). */
  aspect: string[] | null;
  resolution: string[] | null;
  duration: number[] | null;
  /** Batch count (×1–×4). */
  count: boolean;
  draft: boolean;
  audio: boolean;
  multiShot: boolean;
  enhance: boolean;
  sliders: boolean;
  negativePrompt: boolean;
  /** The spoken languages a transcriber can be told (unset = it detects): the "Spoken language" picker. */
  sourceLanguages: string[] | null;
}

/**
 * Which output settings apply to this model, operation and studio. `studioOps` are the studio's
 * operations: when the operation isn't known yet (nothing attached) and they're all one-take
 * transforms (Lipsync), there's still no batch count.
 */
export function settingsShape(
  model: Pick<ModelDef, "options"> | undefined,
  op: Operation | undefined,
  kind: MediaKind,
  showPrompt: boolean,
  params: GenParams = {},
  studioOps: Operation[] = [],
): SettingsShape {
  const o = model?.options ?? {};
  const many = <T,>(xs: T[] | undefined) => (xs && xs.length > 1 ? xs : null);
  const single = op ? SINGLE_TAKE.has(op) : studioOps.length > 0 && studioOps.every((x) => SINGLE_TAKE.has(x));
  return {
    aspect: op === "i2v" || op === "flf2v" ? null : many(o.aspectRatios),
    resolution: many(o.resolutions),
    duration: params.shots ? null : many(o.durations),
    count: (kind === "image" || kind === "video") && !single,
    draft: !!o.draft,
    audio: o.audio === true,
    multiShot: !!o.multiShot,
    enhance: showPrompt,
    sliders: !!o.sliders?.length,
    negativePrompt: !!o.negativePrompt,
    sourceLanguages: o.sourceLanguages?.length ? o.sourceLanguages : null,
  };
}

/** The parts of the summary chip label, in reading order. */
export function settingsSummary(shape: SettingsShape, params: GenParams, model?: Pick<ModelDef, "options" | "defaults">): string[] {
  const parts: string[] = [];
  const d = model?.defaults ?? {};
  if (shape.aspect) {
    const ar = params.aspectRatio ?? d.aspectRatio ?? shape.aspect[0];
    parts.push(ar === "auto" ? "Auto" : ar);
  }
  if (shape.resolution) parts.push(params.resolution ?? d.resolution ?? shape.resolution[0]);
  if (params.shots?.length) parts.push(`${params.shots.length} shots`);
  else if (shape.duration) parts.push(durationLabel(params.duration ?? d.duration ?? shape.duration[0]));
  if (shape.count) parts.push(`×${params.numOutputs ?? 1}`);
  if (shape.multiShot && !params.shots && params.multiShot === "auto") parts.push("Multi-shot");
  if (shape.draft && params.draft) parts.push("Draft");
  if (shape.audio && params.generateAudio === false) parts.push("No audio");
  if (shape.enhance && params.enhancePrompt) parts.push("Enhance");
  // Detecting the language is the default, so only a picked one is worth a word.
  if (shape.sourceLanguages && params.sourceLanguage) parts.push(spokenLanguageName(params.sourceLanguage));
  return parts;
}

/** How many settings differ from their defaults beyond what the summary shows (seed, negative prompt, sliders). */
export function hiddenChanges(params: GenParams, negativePrompt: string, model?: Pick<ModelDef, "options">): number {
  let n = 0;
  if (params.seed !== undefined) n++;
  if (negativePrompt.trim()) n++;
  for (const s of model?.options.sliders ?? []) {
    const v = params.extra?.[s.param];
    if (typeof v === "number" && v !== s.default) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Blockers ("Add a target photo")

const VOWEL = /^[aeiou]/i;
const DETERMINER = /^(your|the|a|an|some|any|my|this|that)\b/i;

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Models that name their images (try-on: "person photo", then "garment") label the studio's image
 * slots in that order, and the next reference tile after the `refs` already added ("Add garment").
 * Same array when nothing changes.
 */
export function namedImageSlots(slots: InputSlot[], names: string[] | undefined, refLabel?: string, refs = 0): { slots: InputSlot[]; refLabel?: string } {
  if (!names?.length) return { slots, refLabel };
  let i = 0;
  const named = slots.map((s) => (s.accept === "image" && s.key !== "mask" && s.key !== "sketch" && names[i] ? { ...s, label: sentence(names[i++]) } : s));
  const next = names[i + refs];
  return { slots: i ? named : slots, refLabel: refLabel && next ? `Add ${next}` : refLabel };
}

/** "Target photo" → "Add a target photo"; "Your clip" → "Add your clip"; "Image" → "Add an image". */
export function slotMessage(label: string): string {
  const l = label.trim();
  // Keep acronyms ("SVG logo") and proper names as they are; lower-case an ordinary first word.
  const word = /^[A-Z][a-z]/.test(l) ? l.charAt(0).toLowerCase() + l.slice(1) : l;
  if (DETERMINER.test(word)) return `Add ${word}`;
  const head = word.split(/\s+/)[0];
  // Plurals ("Photos", "Clips") read better without an article.
  if (/[^s]s$/i.test(head) && !/(us|is|ss)$/i.test(head) && head.length > 3 && !word.includes(" ")) return `Add ${word}`;
  return `Add ${VOWEL.test(word) ? "an" : "a"} ${word}`;
}

type SlotValues = Partial<Record<InputSlot["key"], { ref: string; uploading?: boolean } | null>>;

/** A missing input: one required slot, or (`group`) a set of optional slots of which one is needed ("a portrait or a video"). */
export type MissingSlot = InputSlot & { group?: InputSlot[] };

/**
 * The first input Generate is waiting for, in the order the tiles are shown: an empty required
 * slot, or a group from `anyOf` (studio config: "one of these") with none of its slots filled.
 * A group comes back as its first slot plus `group`, so Generate pulses that tile.
 */
export function firstMissingSlot(slots: InputSlot[], values: SlotValues, anyOf: InputSlot["key"][][] = []): MissingSlot | undefined {
  const filled = (k: InputSlot["key"]) => !!values[k]?.ref || !!values[k]?.uploading;
  const groups = anyOf.map((g) => slots.filter((s) => g.includes(s.key))).filter((g) => g.length > 0);
  for (const s of slots) {
    if (s.required && !filled(s.key)) return s;
    const group = groups.find((g) => g[0].key === s.key);
    if (group && !group.some((x) => filled(x.key))) return group.length > 1 ? { ...s, group } : s;
  }
  return undefined;
}

/** ["a portrait", "a video"] → "a portrait or a video"; three → "a, b or c". */
const orList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** "Add a portrait or a video" for a group, else the slot's own message. */
export function missingMessage(m: MissingSlot): string {
  if (!m.group || m.group.length < 2) return slotMessage(m.label);
  return `Add ${orList(m.group.map((s) => slotMessage(s.label).replace(/^Add /, "")))}`;
}

export interface Blocker {
  message: string;
  /** The attachment to point at (pulse) when Generate is pressed ("mask": the Paint area tile). */
  slot?: InputSlot["key"];
}

/**
 * Whether Generate is waiting for a painted area: the studio offers the mask brush, its image is
 * in (or uploading), nothing is painted yet, and the model only changes a picture through a mask
 * (FLUX Fill: an inpaint route and no instruction edit to fall back on). The planner's own message
 * names both inputs ("Add an image and paint the area to change"), which reads wrong with the image
 * right there, and comes after its prompt check, though Inpaint asks for the painting first.
 */
export function needsMask(model: Pick<ModelDef, "routes"> | undefined, sketch: ("mask" | "draw")[] | undefined, slots: SlotValues): boolean {
  if (!model || !sketch?.includes("mask")) return false;
  const image = slots.image;
  if (!image?.ref && !image?.uploading) return false;
  if (slots.mask?.ref) return false;
  const ops = new Set(model.routes.map((r) => r.op));
  return ops.has("inpaint") && !ops.has("edit");
}

/**
 * What stops Generate, most actionable first: missing model, missing attachment (named with the
 * studio's own slot label, not the planner's generic message), uploads in flight, the area to
 * paint (needsMask), then whatever the planner says (prompt, voice, language…).
 */
export function blockerFor(s: {
  loading?: string | null;
  model: boolean;
  engineError?: string | null;
  missing?: MissingSlot;
  uploading: boolean;
  maskMissing?: boolean;
  planError?: string | null;
  promptMissing: boolean;
}): Blocker | null {
  if (s.loading) return { message: s.loading };
  if (!s.model) return { message: "Pick a model" };
  if (s.engineError) return { message: s.engineError };
  if (s.missing) return { message: missingMessage(s.missing), slot: s.missing.key };
  if (s.uploading) return { message: "Uploading…" };
  if (s.maskMissing) return { message: "Paint the area to change", slot: "mask" };
  if (s.planError) return { message: s.planError };
  if (s.promptMissing) return { message: "Write a prompt first" };
  return null;
}

/**
 * Whether the composer shows a prompt box (and the studio its prompt suggestions): not when the
 * studio or app has none, nor for a model that takes no prompt (try-on, upscalers, 3D, transcription).
 */
export function promptShown(hidePrompt: boolean | undefined, userPrompt: Preset["userPrompt"] | undefined, promptless: boolean | undefined): boolean {
  return !hidePrompt && userPrompt !== "none" && !promptless;
}

/** Placeholder refs for empty required slots, so cost and plan can be computed before anything is attached. */
export const PLACEHOLDER: Record<MediaKind, string> = {
  image: "/api/files/placeholder.png",
  video: "/api/files/placeholder.mp4",
  audio: "/api/files/placeholder.wav",
  text: "/api/files/placeholder.txt",
  model3d: "/api/files/placeholder.glb",
};

// ---------------------------------------------------------------------------
// Attachments: where a pasted / dropped / uploaded file goes

export interface Attachment {
  id?: string;
  ref: string;
  preview: string;
  kind: MediaKind;
  name?: string;
  uploading?: boolean;
}

export interface AttachState {
  slots: Partial<Record<InputSlot["key"], Attachment | null>>;
  refs: Attachment[];
}

/**
 * Put a new attachment somewhere sensible: the first empty slot of its kind, else the reference
 * list (when the studio takes references of that kind and has room), else replace the first slot
 * of its kind. Returns null when the studio can't take it.
 */
export function placeAttachment<T extends Attachment>(
  state: { slots: Partial<Record<InputSlot["key"], T | null>>; refs: T[] },
  slots: InputSlot[],
  multiRef: { kind?: MediaKind } | undefined,
  refMax: number,
  v: T,
): { slots?: Partial<Record<InputSlot["key"], T | null>>; refs?: T[] } | null {
  const fits = slots.filter((s) => s.accept === v.kind && s.key !== "mask" && s.key !== "sketch");
  const empty = fits.find((s) => !state.slots[s.key]);
  if (empty) return { slots: { ...state.slots, [empty.key]: v } };
  if (multiRef && (multiRef.kind ?? "image") === v.kind && state.refs.length < refMax) return { refs: [...state.refs, v] };
  if (fits[0]) return { slots: { ...state.slots, [fits[0].key]: v } };
  return null;
}

/**
 * Swap an in-flight upload for its result (or drop it on failure), by id. If the user removed or
 * replaced it meanwhile, nothing changes: a finished upload never brings a removed item back.
 */
export function replaceAttachment<T extends Attachment>(
  state: { slots: Partial<Record<InputSlot["key"], T | null>>; refs: T[] },
  id: string,
  v: T | null,
): { slots?: Partial<Record<InputSlot["key"], T | null>>; refs?: T[] } | null {
  for (const [k, s] of Object.entries(state.slots) as [InputSlot["key"], T | null][]) {
    if (s?.id === id) return { slots: { ...state.slots, [k]: v ? { ...v, id } : null } };
  }
  if (state.refs.some((r) => r.id === id)) {
    return { refs: v ? state.refs.map((r) => (r.id === id ? { ...v, id } : r)) : state.refs.filter((r) => r.id !== id) };
  }
  return null;
}

/**
 * Where a batch of files would land, before any of them uploads: each file's index goes to
 * `placed` (it gets a slot or a reference tile) or `rejected` (no room: the references are full or
 * the model takes none). Placement is simulated in order, as `placeAttachment` does it for real.
 */
export function fitAttachments(
  state: AttachState,
  slots: InputSlot[],
  multiRef: { kind?: MediaKind } | undefined,
  refMax: number,
  kinds: MediaKind[],
): { placed: number[]; rejected: number[] } {
  let s = state;
  const placed: number[] = [];
  const rejected: number[] = [];
  kinds.forEach((kind, i) => {
    const next = placeAttachment(s, slots, multiRef, refMax, { id: `fit-${i}`, ref: "", preview: "", kind });
    if (!next) return void rejected.push(i);
    placed.push(i);
    s = { slots: next.slots ?? s.slots, refs: next.refs ?? s.refs };
  });
  return { placed, rejected };
}

/** What to tell someone whose attachment found no room ("This model takes up to 3 reference images"). */
export function noRoomMessage(refMax: number, kind: MediaKind = "image"): string {
  const noun = kind === "video" ? "clip" : kind === "audio" ? "audio file" : "reference image";
  if (refMax <= 0) return `This model doesn't take ${noun}s — pick another model to add one`;
  return `This model takes up to ${refMax} ${noun}${refMax === 1 ? "" : "s"}`;
}

/**
 * A drawing (inpaint mask, sketch, Wan-Move motion paths) belongs to the image it was drawn on:
 * when the image slot gets another image, or none, the drawing goes with it. Returns the patch
 * to apply with the new slots (the same slots when the image didn't change, e.g. its upload finished).
 */
export function onImageChange<T extends Attachment>(
  prev: { slots: Partial<Record<InputSlot["key"], T | null>>; params: GenParams },
  nextSlots: Partial<Record<InputSlot["key"], T | null>>,
): { slots: Partial<Record<InputSlot["key"], T | null>>; params?: GenParams } {
  const before = prev.slots.image ?? null;
  const after = nextSlots.image ?? null;
  const same = before === after || (!!before && !!after && ((!!before.id && before.id === after.id) || (!!before.ref && before.ref === after.ref)));
  if (same) return { slots: nextSlots };
  const slots = { ...nextSlots, mask: null, sketch: null };
  if (prev.params.extra?.motionPaths === undefined) return { slots };
  const extra = { ...prev.params.extra };
  delete extra.motionPaths;
  return { slots, params: { ...prev.params, extra: Object.keys(extra).length ? extra : undefined } };
}

/** Which kinds the "+" menu (and paste / drop) can take for this studio. Voice samples have their own picker. */
export function acceptedKinds(slots: InputSlot[], multiRef?: { kind?: MediaKind }): MediaKind[] {
  const kinds = new Set<MediaKind>(slots.filter((s) => s.key !== "mask" && s.key !== "sketch" && s.key !== "voiceAudio" && s.key !== "voiceAudio2").map((s) => s.accept));
  if (multiRef) kinds.add(multiRef.kind ?? "image");
  return [...kinds];
}

// ---------------------------------------------------------------------------
// Hand-off params ("/video?image=…") arriving after the first paint

/** The URL params a studio prefills its draft from; anything else in the query is ignored. */
export const HANDOFF_PARAMS = ["image", "ref", "video", "audio", "prompt", "preset", "model"] as const;

/** A stable key for the hand-off part of a query string ("" when there's none). */
export function handoffKey(search: string | URLSearchParams | null | undefined): string {
  const sp = typeof search === "string" || !search ? new URLSearchParams(search ?? "") : search;
  const out = new URLSearchParams();
  for (const k of HANDOFF_PARAMS) {
    const v = sp.get(k);
    if (v) out.set(k, v);
  }
  return out.toString();
}

export interface DraftShape {
  prompt: string;
  negativePrompt: string;
  modelId: string;
  params: GenParams;
  slots: Partial<Record<InputSlot["key"], Attachment | null>>;
  refs: Attachment[];
  presetId?: string;
  presetOptions: Record<string, string>;
  presetStrength?: number;
  mix?: { presetId: string; strength: number };
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameAttachment = (a: Attachment | null | undefined, b: Attachment | null | undefined) => (a ?? null) === (b ?? null) || (!!a && !!b && a.id === b.id && a.ref === b.ref);

/**
 * Apply a draft computed from hand-off params (`next`) to the live draft (`current`) without
 * undoing what the person already did: a field still equal to the draft the composer started
 * with (`base`) takes the hand-off value; a field they changed (typed a prompt before the page
 * hydrated, attached a photo) keeps theirs. Returns the patch.
 */
export function mergeHandoff<D extends DraftShape>(base: D, current: D, next: D): Partial<D> {
  const patch: Partial<D> = {};
  if (current.prompt === base.prompt && current.prompt !== next.prompt) patch.prompt = next.prompt;
  if (current.negativePrompt === base.negativePrompt && current.negativePrompt !== next.negativePrompt) patch.negativePrompt = next.negativePrompt;
  if (current.modelId === base.modelId && same(current.params, base.params) && (current.modelId !== next.modelId || !same(current.params, next.params))) {
    patch.modelId = next.modelId;
    patch.params = next.params;
  }
  const keys = new Set([...Object.keys(base.slots), ...Object.keys(current.slots), ...Object.keys(next.slots)] as InputSlot["key"][]);
  let slotsChanged = false;
  const slots = { ...current.slots };
  for (const k of keys) {
    if (sameAttachment(current.slots[k], base.slots[k]) && !sameAttachment(current.slots[k], next.slots[k])) {
      slots[k] = next.slots[k] ?? null;
      slotsChanged = true;
    }
  }
  if (slotsChanged) patch.slots = slots as D["slots"];
  const refsUntouched = current.refs === base.refs || (current.refs.length === base.refs.length && current.refs.every((r, i) => sameAttachment(r, base.refs[i])));
  if (refsUntouched && (next.refs.length || current.refs.length)) patch.refs = next.refs as D["refs"];
  const preset = (d: D) => [d.presetId, d.presetOptions, d.presetStrength, d.mix];
  if (same(preset(current), preset(base)) && !same(preset(current), preset(next))) {
    patch.presetId = next.presetId;
    patch.presetOptions = next.presetOptions;
    patch.presetStrength = next.presetStrength;
    patch.mix = next.mix;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Models for a studio and the picker's groups

export function filterModels(models: ModelDef[], opts: { kind?: MediaKind; ops?: Operation[] }): ModelDef[] {
  return models.filter((m) => !m.hidden && (!opts.kind || m.kind === opts.kind) && (!opts.ops || m.routes.some((r) => opts.ops!.includes(r.op))));
}

/**
 * "Best for this studio": the studio's default first, then top picks, then what's new — among
 * the models that do the studio's main operation (`op`, e.g. text-to-image in the Image studio),
 * so a single-purpose tool (garment try-on) never ranks above a general model.
 */
export function bestForStudio(models: ModelDef[], engine: Engine, defaultId: string | undefined, max = 4, op?: Operation): ModelDef[] {
  const pool = models.filter((m) => m.engine === engine && (!op || m.id === defaultId || m.routes.some((r) => r.op === op)));
  const score = (m: ModelDef) => (m.id === defaultId ? 0 : m.badges?.includes("top") ? 1 : m.badges?.includes("new") ? 2 : 9);
  return pool
    .map((m, i) => [m, score(m), i] as const)
    .filter(([, s]) => s < 9)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .slice(0, max)
    .map(([m]) => m);
}

export interface ModelGroup {
  id: "recent" | "starred" | "best" | "all" | "results";
  label: string;
  models: ModelDef[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Search score: 0 = name starts with the query, 1 = a word starts with it, 2 = anywhere; -1 = no match. */
export function matchScore(m: Pick<ModelDef, "name" | "vendor" | "tagline" | "family">, query: string): number {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const name = norm(m.name);
  const hay = norm(`${m.name} ${m.vendor} ${m.family} ${m.tagline}`);
  if (!terms.every((t) => hay.includes(t))) return -1;
  if (name.startsWith(terms[0])) return 0;
  if (new RegExp(`\\b${terms[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(hay)) return 1;
  return 2;
}

/**
 * The picker's sections. Without a query: Recent (last 3 used), Starred, Best for this studio
 * and All, for the selected engine; a model sits in the first section it belongs to (All lists
 * everything). With a query: one list across every allowed engine, best matches first.
 */
export function groupModels(input: {
  models: ModelDef[];
  engine: Engine;
  /** Engines the install allows (Settings → Engine mode). */
  engines: Engine[];
  query: string;
  recent: string[];
  starred: string[];
  best: string[];
}): { groups: ModelGroup[]; count: number } {
  const { models, engine, engines, query, recent, starred, best } = input;
  const q = query.trim();
  if (q) {
    const hits = models
      .filter((m) => engines.includes(m.engine))
      .map((m, i) => ({ m, s: matchScore(m, q), i }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || Number(a.m.engine !== engine) - Number(b.m.engine !== engine) || a.i - b.i)
      .map((x) => x.m);
    return { groups: hits.length ? [{ id: "results", label: "Results", models: hits }] : [], count: hits.length };
  }
  const pool = models.filter((m) => m.engine === engine);
  const byId = new Map(pool.map((m) => [m.id, m]));
  const used = new Set<string>();
  const take = (ids: string[], max: number) => {
    const out: ModelDef[] = [];
    for (const id of ids) {
      const m = byId.get(id);
      if (!m || used.has(id) || out.length >= max) continue;
      used.add(id);
      out.push(m);
    }
    return out;
  };
  const groups: ModelGroup[] = [
    { id: "recent", label: "Recent", models: take(recent, 3) },
    { id: "starred", label: "Starred", models: take(starred, 50) },
    { id: "best", label: "Best for this studio", models: take(best, 4) },
    { id: "all", label: "All models", models: pool },
  ];
  return { groups: groups.filter((g) => g.models.length), count: pool.length };
}

/** Keep a most-recent-first id list without duplicates. */
export function pushRecent(list: string[], id: string, max = 12): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

export function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

// ---------------------------------------------------------------------------
// Cost hint

export function costLabel(s: { demo: boolean; cost: number | null; compact?: boolean }, format: (usd: number) => string): string {
  if (s.demo) return s.compact ? "Demo" : "Demo · free";
  if (s.cost === 0) return "Free";
  if (s.cost != null) return `≈ ${format(s.cost)}`;
  return "";
}

/** Prompts with an @mention: spellcheck would underline every handle. */
export const hasMention = (text: string) => /(^|\s)@[\p{L}\p{N}_-]+/u.test(text);
