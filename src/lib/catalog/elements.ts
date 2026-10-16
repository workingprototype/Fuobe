/**
 * Elements: reusable characters, locations, props and styles that can be dropped into
 * any prompt with `@handle` (Higgsfield's "Elements" / Soul ID). Resolution is pure so the
 * server (authoritative), the composer (live preview + cost) and the agent share it.
 */
import type { Engine, GenerationRequest, LoraRef, ModelDef, Operation } from "./types";

export type ElementKind = "character" | "location" | "prop" | "style";

export const ELEMENT_KINDS: { kind: ElementKind; label: string; plural: string; noun: string; refs: number }[] = [
  { kind: "character", label: "Character", plural: "Characters", noun: "the person", refs: 3 },
  { kind: "location", label: "Location", plural: "Locations", noun: "the location", refs: 2 },
  { kind: "prop", label: "Prop", plural: "Props", noun: "the object", refs: 1 },
  { kind: "style", label: "Style", plural: "Styles", noun: "the visual style", refs: 2 },
];

export const elementKindInfo = (k: ElementKind) => ELEMENT_KINDS.find((x) => x.kind === k) ?? ELEMENT_KINDS[0];

/** A trained identity LoRA for an element (Soul ID parity). */
export interface ElementLora {
  engine: Engine;
  /** Model the LoRA was trained for; it's only applied when that model runs. */
  modelId: string;
  /** ComfyUI models/loras file name (open) or a URL the cloud LoRA endpoint accepts. */
  file: string;
  url?: string;
  trigger: string;
  strength?: number;
  /** Higgsfield Soul ID: a trained character reference passed as `custom_reference_id` instead of a LoRA. */
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
  const mentioned = findMentions(req.prompt, elements);
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
    const l = el.loras.find((x) => x.modelId === model.id && x.engine === model.engine);
    if (!l) continue;
    if (l.referenceId) {
      // Soul ID takes one character per generation.
      if (extra?.custom_reference_id) continue;
      extra = { ...extra, custom_reference_id: l.referenceId, custom_reference_strength: l.strength ?? 1 };
    } else {
      loras.push({ file: l.file, url: l.url, strength: l.strength ?? 1, trigger: l.trigger });
    }
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
  let prompt = req.prompt ?? "";
  const seen = new Set<string>();
  prompt = prompt.replace(MENTION, (whole, h: string) => {
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
  if (legend.length) prompt = `${prompt.trim().replace(/[.\s]+$/, "")}. ${legend.join(". ")}.`;

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
      params: extra !== req.params?.extra ? { ...req.params, extra } : req.params,
    },
    mentioned,
    notes,
  };
}
