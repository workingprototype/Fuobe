/**
 * Fuobe Soul ID (build plan O3): a character or a style trained as a LoRA on open weights, on either engine
 * (AI-Toolkit on the user's GPU, or fal's hosted trainers), then used whenever the element is @mentioned on a
 * model of the family it was trained for: Fuobe Soul and Soul Cinema (Z-Image Turbo), Fuobe Soul HD
 * (Qwen-Image 2512), and the plain open-weight models of the same base. Pure logic, no I/O.
 *
 * - A LoRA belongs to a family (its base), not to one model, and works on both engines: a LoRA trained on fal is
 *   downloaded into ComfyUI for open runs, one trained on the user's GPU is copied to the cloud provider for cloud
 *   runs (src/server/loras.ts). Another family means training again on the same photos ("Upgrade character"), as
 *   Higgsfield retrains a Soul ID per model family.
 * - The hosted trainers' fields and prices are generated from the research (trainers.generated.ts by
 *   scripts/gen-trainers.py); every one a target uses trains on commercial weights (Apache-2.0).
 * - Photo rules and the consent line follow Higgsfield's character flow (docs/research/higgsfield-originals-5.md
 *   §3.4, higgsfield-delta-4.md G18): 20+ photos recommended, 80 at most, one person, a full-body shot, consent
 *   before a person's photos are trained.
 */
import type { ElementKind, ElementLora } from "./elements";
import { HOSTED_TRAINERS } from "./trainers.generated";
import type { Engine, ModelDef } from "./types";

export type TrainingProvider = "fal" | "ai-toolkit";

/** The base a LoRA is trained on. A trained LoRA works on every model of its family. */
export type TrainingFamily = "z-image-turbo" | "qwen-image-2512";

/** What a training learns: a subject (a person, a place, an object) or a style (a moodboard). */
export type TrainingKind = "subject" | "style";

/** A field of a hosted trainer's request (from its OpenAPI schema). */
export interface TrainerField {
  type: string;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  enum?: string[];
}

/** A hosted LoRA trainer (generated from the research by scripts/gen-trainers.py). */
export interface HostedTrainer {
  /** The fal endpoint, e.g. "fal-ai/z-image-turbo-trainer-v2". */
  id: string;
  provider: "fal";
  /** The base model as the research names it ("Z-Image Turbo"). */
  family: string;
  /** The base as a slug ("z-image-turbo", "z-image", "qwen-image-2512"). */
  base: string;
  role: string;
  /** Where the zip of 001.jpg + 001.txt pairs goes. */
  dataField: string;
  fields: Record<string, TrainerField>;
  licence: string;
  /** The weights it trains on allow selling outputs. */
  commercial: boolean;
  status: string;
  checked: string;
  schemaUrl: string;
  priceText: string;
  usdPerStep?: number;
  /** fal bills at least this many steps. */
  minBilledSteps?: number;
}

export interface TrainingTarget {
  id: string;
  /** Short: where it trains ("Your GPU", "Cloud"). The family says what for. */
  name: string;
  /** The engine the training runs on (the LoRA then works on both). */
  engine: Engine;
  provider: TrainingProvider;
  family: TrainingFamily;
  kinds: TrainingKind[];
  /** fal: the hosted trainer's endpoint (HOSTED_TRAINERS). */
  trainer?: string;
  steps: number;
  learningRate?: number;
  /** Other fields sent to the trainer (fal's training_type). */
  extra?: Record<string, string>;
  /** Models the trained LoRA applies to (the family's, on both engines). */
  modelIds: string[];
  minImages: number;
  description: string;
  /** "Free" on the user's GPU, else the price fal charges for this many steps. */
  price: string;
  /** The same price as a number (0 when free). */
  costUsd: number;
  /** Rough wall-clock time. */
  eta: string;
}

/** The families, in the order the Train dialog shows them; `lead` is the model a trained element is shown for. */
export const TRAINING_FAMILIES: Record<TrainingFamily, { name: string; base: string; lead: string; models: string[] }> = {
  "z-image-turbo": {
    name: "Fuobe Soul and Soul Cinema",
    base: "Z-Image Turbo",
    lead: "fuobe-soul",
    models: ["fuobe-soul", "fuobe-soul-cinema", "oss-z-image-turbo", "z-image-turbo-cloud"],
  },
  "qwen-image-2512": {
    name: "Fuobe Soul HD",
    base: "Qwen-Image 2512",
    lead: "fuobe-soul-hd",
    models: ["fuobe-soul-hd", "oss-qwen-image", "oss-qwen-image-lightning", "qwen-image-2512-cloud"],
  },
};

/** Higgsfield's character flow, as limits (research §3.4): 20+ photos recommended, 80 at most on the web. */
export const SOUL_ID_PHOTOS = { min: 5, recommended: 20, max: 80, minSide: 512 } as const;

/**
 * The photo rules and the consent line (Higgsfield's character-creation copy, docs/research/higgsfield-image-studios.md
 * §2 and higgsfield-delta-4.md G18), shared by every place that makes or trains a character.
 */
export const SOUL_ID_COPY = {
  moreTitle: "More Photos, Better Results",
  more: "Upload 20+ photos for best results",
  avoidTitle: "Avoid These Types of Photos",
  avoid: "No duplicates, group shots, pets, nudes, filters, face-covering accessories, or masks",
  rules: [
    "One person in every photo, the face fully in frame",
    "Different angles, expressions and light, and at least one full-body shot",
    "Recent photos: no sunglasses, heavy shadows, filters or group shots",
  ],
  consent:
    "I consent to this biometric data processing and confirm these photos are of me or of a person at least 18 years old who gave written permission.",
  needsConsent: "Confirm the consent line first: a character is only trained with the person's permission",
} as const;

const trainers = new Map(HOSTED_TRAINERS.map((t) => [t.id, t]));
export const getTrainer = (id: string | undefined): HostedTrainer | undefined => (id ? trainers.get(id) : undefined);

/** What fal bills for this many steps on this trainer (its per-step price above its minimum), in US dollars. */
export function trainerCost(trainer: Pick<HostedTrainer, "usdPerStep" | "minBilledSteps"> | undefined, steps: number): number | null {
  if (!trainer?.usdPerStep) return null;
  return Math.round(Math.max(steps, trainer.minBilledSteps ?? 1) * trainer.usdPerStep * 100) / 100;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const thousands = (n: number) => n.toLocaleString("en-US");

function target(t: Omit<TrainingTarget, "modelIds" | "price" | "costUsd" | "minImages">): TrainingTarget {
  const cost = t.provider === "fal" ? trainerCost(getTrainer(t.trainer), t.steps) : 0;
  if (cost === null) throw new Error(`${t.id}: its trainer ${t.trainer} has no price (run pnpm gen:catalog)`);
  return {
    ...t,
    modelIds: TRAINING_FAMILIES[t.family].models,
    minImages: SOUL_ID_PHOTOS.min,
    costUsd: cost,
    price: cost === 0 ? "Free" : `≈ ${usd(cost)} (${thousands(t.steps)} steps)`,
  };
}

/**
 * Where a Soul ID trains (research §3.3, §4.5, plan O3). Z-Image Turbo: AI-Toolkit with ostris's training adapter v2 on
 * the user's GPU, or fal's Z-Image Turbo trainer v2 (2,000 steps at 5e-4). A style (a moodboard) on the cloud trains on
 * fal's Z-Image trainer with training_type style. Fuobe Soul HD: fal's Qwen-Image 2512 trainer.
 */
export const TRAINING_TARGETS: TrainingTarget[] = [
  target({
    id: "aitk-z-image",
    name: "Your GPU",
    engine: "open",
    provider: "ai-toolkit",
    family: "z-image-turbo",
    kinds: ["subject", "style"],
    steps: 2000,
    description: "AI-Toolkit on your own GPU (24 GB), with ostris's Z-Image Turbo training adapter. Nothing leaves your machine.",
    eta: "~30–60 min on a 24 GB GPU",
  }),
  target({
    id: "fal-z-image",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "z-image-turbo",
    kinds: ["subject"],
    trainer: "fal-ai/z-image-turbo-trainer-v2",
    steps: 2000,
    learningRate: 0.0005,
    description: "fal's Z-Image Turbo trainer. Your photos go to fal for the training.",
    eta: "~10 min",
  }),
  target({
    id: "fal-z-image-style",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "z-image-turbo",
    kinds: ["style"],
    trainer: "fal-ai/z-image-trainer",
    steps: 1500,
    extra: { training_type: "style" },
    description: "fal's Z-Image trainer in style mode: the look, not the subjects. Your images go to fal for the training.",
    eta: "~15–30 min",
  }),
  target({
    id: "fal-qwen-2512",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "qwen-image-2512",
    kinds: ["subject"],
    trainer: "fal-ai/qwen-image-2512-trainer",
    steps: 1000,
    learningRate: 0.0005,
    description: "fal's Qwen-Image 2512 trainer, for Fuobe Soul HD (clean lettering). Your photos go to fal for the training.",
    eta: "~10–20 min",
  }),
];

export const getTrainingTarget = (id: string) => TRAINING_TARGETS.find((t) => t.id === id);

/** A style element trains as a style; characters, places and objects as subjects. */
export const trainingKind = (kind: ElementKind): TrainingKind => (kind === "style" ? "style" : "subject");

/** The targets an element of this kind can train on, in the dialog's order. */
export const targetsFor = (kind: ElementKind): TrainingTarget[] => (kind === "voice" ? [] : TRAINING_TARGETS.filter((t) => t.kinds.includes(trainingKind(kind))));

/** Only a person needs the consent line (biometric data). */
export const needsConsent = (kind: ElementKind): boolean => kind === "character";

/** What stops a training from starting with this many photos (null when it can start). */
export function photosBlocker(count: number, name = "them"): string | null {
  if (count < SOUL_ID_PHOTOS.min) return `Add at least ${SOUL_ID_PHOTOS.min} photos of ${name} first (you have ${count})`;
  if (count > SOUL_ID_PHOTOS.max) return `A training takes up to ${SOUL_ID_PHOTOS.max} photos (you have ${count})`;
  return null;
}

/**
 * Tips on a set of photos before training (shown, never blocking): fewer than 20, photos smaller than 512 px on a
 * side (the trainers learn at 512–1024), and duplicates. `photos` carry their size when the browser knows it.
 */
export function photoTips(photos: { key: string; width?: number; height?: number }[]): string[] {
  const tips: string[] = [];
  if (photos.length >= SOUL_ID_PHOTOS.min && photos.length < SOUL_ID_PHOTOS.recommended) tips.push(`${SOUL_ID_COPY.more}: you have ${photos.length}`);
  const small = photos.filter((p) => p.width && p.height && Math.min(p.width, p.height) < SOUL_ID_PHOTOS.minSide).length;
  if (small) tips.push(`${small} photo${small > 1 ? "s are" : " is"} smaller than ${SOUL_ID_PHOTOS.minSide} px on a side: larger ones train better`);
  const dupes = photos.length - new Set(photos.map((p) => p.key)).size;
  if (dupes) tips.push(`${dupes} duplicate photo${dupes > 1 ? "s" : ""}: each adds nothing`);
  return tips;
}

// ---------------------------------------------------------------------------
// Which trained LoRA a run uses

/** The family a model's LoRAs belong to (undefined for a model no Soul ID applies to). */
export function familyOfModel(modelId: string): TrainingFamily | undefined {
  return (Object.keys(TRAINING_FAMILIES) as TrainingFamily[]).find((f) => TRAINING_FAMILIES[f].models.includes(modelId));
}

/** A trained LoRA's family: recorded since O3; read from the model it was trained for before that. */
export function loraFamily(l: Pick<ElementLora, "family" | "modelId" | "referenceId">): TrainingFamily | undefined {
  if (l.referenceId) return undefined;
  return l.family ?? familyOfModel(l.modelId);
}

/**
 * A trained LoRA can run on this engine: the open engine needs a file name for ComfyUI's loras folder (downloaded
 * from its URL or copied from Fuobe's own copy when ComfyUI lacks it); the cloud needs a URL the provider can fetch,
 * or Fuobe's own copy of the file to send it.
 */
export function usableOn(l: Pick<ElementLora, "file" | "url" | "own" | "referenceId" | "demo">, engine: Engine): boolean {
  if (l.referenceId || l.demo) return false;
  return engine === "open" ? !!l.file : !!l.url || (!!l.own && !!l.file);
}

/** A Higgsfield Soul ID (from before O3): it can't be exported, so the element is retrained on its photos. */
export const isLegacySoulId = (l: Pick<ElementLora, "referenceId">): boolean => !!l.referenceId;

/**
 * The trained LoRA an @mention uses on this model: one attached for this exact model (a LoRA trained elsewhere),
 * else the newest one of the model's family that runs on its engine (the one trained on that engine first).
 */
export function identityFor(loras: ElementLora[], model: Pick<ModelDef, "id" | "engine">): ElementLora | undefined {
  const exact = loras.find((l) => !l.referenceId && l.modelId === model.id && l.engine === model.engine && usableOn(l, model.engine));
  if (exact) return exact;
  const fam = familyOfModel(model.id);
  if (!fam) return undefined;
  const fits = loras.filter((l) => loraFamily(l) === fam && usableOn(l, model.engine));
  return fits.sort((a, b) => Number(b.engine === model.engine) - Number(a.engine === model.engine) || (b.trainedAt ?? 0) - (a.trainedAt ?? 0))[0];
}

/** How the Train dialog names one of an element's LoRAs to remove it: its file, its Soul ID, or its model. */
export const identityKey = (l: Pick<ElementLora, "file" | "referenceId" | "modelId">): string => l.file || l.referenceId || l.modelId;

/** The families an element has a trained LoRA for. */
export const trainedFamilies = (loras: ElementLora[]): TrainingFamily[] => [...new Set(loras.map(loraFamily).filter((f): f is TrainingFamily => !!f))];

// ---------------------------------------------------------------------------
// The dataset and the requests

/** A short, rare trigger token for an element, e.g. "mayalpz". */
export function triggerFor(handle: string): string {
  const base = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
  const consonants = base.replace(/[aeiou]/g, "");
  return `${(consonants.length >= 3 ? consonants : base).slice(0, 6) || "elem"}fz`;
}

/** What a dataset's captions say: a person ("photo of <trigger>") or a look ("<trigger> style"). */
export function trainingCaption(kind: "character" | "style", trigger: string, description?: string | null): string {
  const extra = description?.trim().replace(/[.\s]+$/, "");
  return `${kind === "style" ? `${trigger} style` : `photo of ${trigger}`}${extra ? `, ${extra}` : ""}`;
}

/** The dataset's file names: 001.jpg with its caption 001.txt (what fal's image trainers read). */
export const datasetName = (index: number, ext: string): string => `${String(index + 1).padStart(3, "0")}.${ext}`;

const clampField = (f: TrainerField | undefined, v: number) => (f ? Math.min(f.max ?? v, Math.max(f.min ?? v, v)) : v);

/**
 * The request a hosted trainer gets: the dataset zip in its data field, then only the fields its schema has (steps
 * within its limits, the caption every photo shares, the learning rate, training_type for a style).
 */
export function falTrainingInput(t: TrainingTarget, zipUrl: string, caption: string): Record<string, unknown> {
  const tr = getTrainer(t.trainer);
  if (!tr) throw new Error(`${t.id} has no hosted trainer`);
  const f = tr.fields;
  const body: Record<string, unknown> = { [tr.dataField]: zipUrl };
  if (f.steps) body.steps = clampField(f.steps, t.steps);
  if (f.default_caption) body.default_caption = caption;
  if (f.learning_rate && t.learningRate !== undefined) body.learning_rate = t.learningRate;
  for (const [k, v] of Object.entries(t.extra ?? {})) if (f[k] && (!f[k].enum || f[k].enum.includes(v))) body[k] = v;
  return body;
}

/**
 * AI-Toolkit job config for a Z-Image Turbo LoRA (research §4.5: ostris's training adapter v2, rank 16–32,
 * 1,500–2,500 steps). A larger photo set gets rank 32 (more to learn); a style (a moodboard) gets fewer steps and
 * samples of new scenes in the look, instead of portraits of the person.
 */
export function aiToolkitJob(opts: { name: string; trigger: string; datasetFolder: string; outputFolder: string; steps?: number; kind?: "character" | "style"; photos?: number }) {
  const style = opts.kind === "style";
  const rank = !style && (opts.photos ?? 0) >= SOUL_ID_PHOTOS.recommended ? 32 : 16;
  return {
    job: "extension",
    config: {
      name: opts.name,
      process: [
        {
          type: "diffusion_trainer",
          training_folder: opts.outputFolder,
          device: "cuda",
          trigger_word: opts.trigger,
          network: { type: "lora", linear: rank, linear_alpha: rank },
          save: { dtype: "bf16", save_every: 500, max_step_saves_to_keep: 3, save_format: "safetensors" },
          datasets: [
            { folder_path: opts.datasetFolder, caption_ext: "txt", caption_dropout_rate: 0.05, cache_latents_to_disk: true, resolution: [512, 768, 1024], num_repeats: 1 },
          ],
          train: {
            batch_size: 1,
            gradient_accumulation: 1,
            train_unet: true,
            train_text_encoder: false,
            gradient_checkpointing: true,
            noise_scheduler: "flowmatch",
            optimizer: "adamw8bit",
            lr: 0.0001,
            optimizer_params: { weight_decay: 0.0001 },
            dtype: "bf16",
            cache_text_embeddings: true,
            ema_config: { use_ema: false },
            steps: opts.steps ?? (style ? 1500 : 2000),
            timestep_type: "weighted",
          },
          model: {
            name_or_path: "Tongyi-MAI/Z-Image-Turbo",
            arch: "zimage:turbo",
            assistant_lora_path: "ostris/zimage_turbo_training_adapter/zimage_turbo_training_adapter_v2.safetensors",
            quantize: true,
            qtype: "qfloat8",
            quantize_te: true,
            qtype_te: "qfloat8",
            low_vram: true,
          },
          sample: {
            sampler: "flowmatch",
            sample_every: 500,
            width: 1024,
            height: 1024,
            seed: 42,
            walk_seed: true,
            prompts: style
              ? [`a city street at night, ${opts.trigger} style`, `a bowl of fruit on a wooden table, ${opts.trigger} style`, `a portrait of a woman in a garden, ${opts.trigger} style`]
              : [`photo of ${opts.trigger}, close-up portrait, natural window light`, `${opts.trigger} walking in a neon-lit street at night, full body`],
            neg: "",
            guidance_scale: 1,
            sample_steps: 9,
          },
        },
      ],
    },
    meta: { name: opts.name, version: "1.0" },
  };
}
