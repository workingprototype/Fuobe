/**
 * Elements: reusable characters, locations, props and styles that can be dropped into
 * any prompt with `@handle` (Higgsfield's "Elements" / Soul ID). Resolution is pure so the
 * server (authoritative), the composer (live preview + cost) and the agent share it.
 */
import { identityFor, type TrainingFamily } from "./training";
import type { Engine, GenerationRequest, LoraRef, ModelDef, Operation } from "./types";

export type ElementKind = "character" | "location" | "prop" | "style" | "voice";

export const ELEMENT_KINDS: { kind: ElementKind; label: string; plural: string; noun: string; refs: number }[] = [
  { kind: "character", label: "Character", plural: "Characters", noun: "the person", refs: 3 },
  { kind: "location", label: "Location", plural: "Locations", noun: "the location", refs: 2 },
  { kind: "prop", label: "Prop", plural: "Props", noun: "the object", refs: 1 },
  { kind: "style", label: "Style", plural: "Styles", noun: "the visual style", refs: 2 },
  { kind: "voice", label: "Voice", plural: "Voices", noun: "the voice", refs: 0 },
];

export const elementKindInfo = (k: ElementKind) => ELEMENT_KINDS.find((x) => x.kind === k) ?? ELEMENT_KINDS[0];

/** Photos an element keeps: a Soul ID trains on up to 80 (Higgsfield's web limit). */
export const MAX_ELEMENT_PHOTOS = 80;

/**
 * A trained LoRA for an element (Fuobe Soul ID, src/lib/catalog/training.ts). Since O3 it belongs to a family (its
 * base) and runs on every model of it, on both engines; before, to one model (`modelId`).
 */
export interface ElementLora {
  /** The engine it was trained on (it runs on both when usableOn says so). */
  engine: Engine;
  /** The model it was trained for: the family's lead model since O3 (fuobe-soul, fuobe-soul-hd). */
  modelId: string;
  /** Its base: the LoRA runs on every model of this family. Unset on LoRAs from before O3 (read from modelId). */
  family?: TrainingFamily;
  /** The training target that made it. */
  target?: string;
  /** ComfyUI models/loras file name (unique per training: fuobe/<handle>-<id>.safetensors). */
  file: string;
  /** A URL the cloud LoRA endpoints fetch (fal's copy of a cloud training). */
  url?: string;
  /** Fuobe keeps its own copy of the file (src/server/loras.ts TRAINED_DIR): it can go to ComfyUI or the cloud. */
  own?: true;
  trigger: string;
  strength?: number;
  trainedAt?: number;
  /** A demo training's stand-in (no key, no GPU): nothing was trained, so no run uses it. */
  demo?: true;
  /** A Higgsfield Soul ID (before O3): a `custom_reference_id` only Higgsfield's Soul models take. Retrain for Fuobe Soul. */
  referenceId?: string;
}

export interface StudioElement {
  id: string;
  name: string;
  handle: string;
  kind: ElementKind;
  description: string | null;
  references: string[];
  loras: ElementLora[];
  status: "ready" | "training" | "failed";
  createdAt: number;
}

/** `Maya Lopez` → `Maya_Lopez`. Letters, digits, `_` and `-` only. */
export function handleFor(name: string): string {
  return (
    name
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^\p{L}\p{N}_-]/gu, "")
      .slice(0, 40) || "element"
  );
}

const MENTION = /@([\p{L}\p{N}_-]+)/gu;

/** Elements mentioned in a prompt, in order of first mention, without duplicates. */
export function findMentions(prompt: string | undefined, elements: StudioElement[]): StudioElement[] {
  if (!prompt || !elements.length) return [];
  const byHandle = new Map(elements.map((e) => [e.handle.toLowerCase(), e]));
  const out: StudioElement[] = [];
  for (const m of prompt.matchAll(MENTION)) {
    const el = byHandle.get(m[1].toLowerCase());
    if (el && !out.includes(el)) out.push(el);
  }
  return out;
}

/** The `@partial` being typed at the caret, if any. */
export function mentionAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(“"'])@([\p{L}\p{N}_-]*)$/u.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

export interface MentionResolution {
  request: GenerationRequest;
  mentioned: StudioElement[];
  /** Human notes, e.g. "Maya is described in words — Kling 2.5 can't take reference images". */
  notes: string[];
}

const ops = (m: ModelDef) => new Set(m.routes.map((r) => r.op));

/**
 * Turn `@handle` mentions into reference images (or a trained LoRA + trigger word) and a
 * prompt that tells the model which image is which. Leaves the request alone when nothing
 * is mentioned.
 */
export function applyMentions(req: GenerationRequest, model: ModelDef, elements: StudioElement[]): MentionResolution {
  // Shots (multi-shot) can mention elements too.
  const shots = req.params?.shots;
  // Voices are picked in the voice menu, not mentioned in visual prompts.
  const visual = elements.filter((e) => e.kind !== "voice");
  const mentioned = findMentions([req.prompt ?? "", ...(shots ?? []).map((s) => s.prompt)].join("\n"), visual);
  if (!mentioned.length) return { request: req, mentioned, notes: [] };

  const notes: string[] = [];
  const has = ops(model);
  const existing = [...(req.inputs?.images ?? [])];
  let op: Operation | undefined = req.op;

  // Where can references go?
  let budget = 0;
  if (model.kind === "image" && has.has("edit")) {
    budget = Math.max(0, (model.options.maxImages ?? 1) - existing.length);
    if (!op || op === "t2i") op = undefined; // edit is inferred once images are attached
  } else if (model.kind === "video" && has.has("ref2v") && !req.inputs?.endImage && (existing.length === 0 || op === "ref2v")) {
    budget = Math.max(0, (model.options.maxImages ?? 4) - existing.length);
  }

  // LoRAs win over references for the model they were trained on.
  const loras: LoraRef[] = [...(req.loras ?? [])];
  const viaLora = new Set<string>();
  let extra = req.params?.extra;
  for (const el of mentioned) {
    // A Higgsfield Soul ID on Higgsfield's own Soul models (until build plan O7 removes them): one character per run.
    const legacy = el.loras.find((x) => x.referenceId && x.modelId === model.id && x.engine === model.engine);
    if (legacy?.referenceId && !extra?.custom_reference_id) {
      extra = { ...extra, custom_reference_id: legacy.referenceId, custom_reference_strength: legacy.strength ?? 1 };
      viaLora.add(el.id);
      continue;
    }
    // A trained LoRA of this model's family, on the engine it runs on (Fuobe Soul ID).
    const l = identityFor(el.loras, model);
    if (!l) continue;
    loras.push({ file: l.file, ...(l.url && { url: l.url }), strength: l.strength ?? 1, trigger: l.trigger, ...(l.own && { own: true as const }) });
    viaLora.add(el.id);
  }

  // Share the reference budget: one image each first, then fill up to each kind's ideal count.
  const wanted = mentioned.filter((e) => !viaLora.has(e.id) && e.references.length);
  const take = new Map<string, number>(wanted.map((e) => [e.id, 0]));
  let left = budget;
  for (let round = 0; left > 0; round++) {
    let gave = false;
    for (const e of wanted) {
      const want = Math.min(e.references.length, elementKindInfo(e.kind).refs);
      if (left > 0 && take.get(e.id)! < want && take.get(e.id)! === round) {
        take.set(e.id, round + 1);
        left--;
        gave = true;
      }
    }
    if (!gave) break;
  }

  const images = [...existing];
  const positions = new Map<string, number[]>();
  for (const e of wanted) {
    const n = take.get(e.id) ?? 0;
    const pos: number[] = [];
    for (const ref of e.references.slice(0, n)) {
      images.push(ref);
      pos.push(images.length);
    }
    positions.set(e.id, pos);
  }
  if (model.kind === "video" && images.length > existing.length) op = "ref2v";

  // Rewrite the prompt: "@Maya" → "Maya", plus who/what each image is.
  const seen = new Set<string>();
  const rewrite = (text: string) => text.replace(MENTION, (whole, h: string) => {
    const el = mentioned.find((e) => e.handle.toLowerCase() === h.toLowerCase());
    if (!el) return whole;
    const first = !seen.has(el.id);
    seen.add(el.id);
    const lora = loras.find((l) => viaLora.has(el.id) && el.loras.some((x) => x.file === l.file));
    if (lora?.trigger && first) return `${lora.trigger} ${el.name}`;
    if (viaLora.has(el.id)) return el.name;
    if (first && !positions.get(el.id)?.length && !viaLora.has(el.id) && el.description) return `${el.name} (${el.description.replace(/[.\s]+$/, "")})`;
    return el.name;
  });
  let prompt = rewrite(req.prompt ?? "");
  const newShots = shots?.map((s) => ({ ...s, prompt: rewrite(s.prompt) }));
  const legend = mentioned
    .map((e) => {
      const pos = positions.get(e.id) ?? [];
      if (!pos.length) return null;
      const which = pos.length === 1 ? `image ${pos[0]}` : `images ${pos.slice(0, -1).join(", ")} and ${pos[pos.length - 1]}`;
      const noun = elementKindInfo(e.kind).noun;
      return e.kind === "character"
        ? `${e.name} is ${noun} in ${which} — keep their exact face, identity, skin tone and hair`
        : e.kind === "style"
          ? `Use ${noun} of ${which} for ${e.name}`
          : `${e.name} is ${noun} in ${which}`;
    })
    .filter(Boolean);
  if (legend.length) prompt = `${prompt.trim().replace(/[.\s]+$/, "")}${prompt.trim() ? ". " : ""}${legend.join(". ")}.`;

  for (const e of mentioned) {
    if (viaLora.has(e.id)) continue;
    if (!positions.get(e.id)?.length) {
      notes.push(
        budget === 0
          ? `${e.name} is described in words — ${model.name} can't take reference images here`
          : `${e.name} is described in words — no room for more reference images`,
      );
    }
  }

  return {
    request: {
      ...req,
      op,
      prompt,
      inputs: { ...req.inputs, images: images.length ? images : undefined },
      loras: loras.length ? loras : undefined,
      params: extra !== req.params?.extra || newShots ? { ...req.params, extra, ...(newShots ? { shots: newShots } : {}) } : req.params,
    },
    mentioned,
    notes,
  };
}
