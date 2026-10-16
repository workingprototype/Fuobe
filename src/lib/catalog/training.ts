/**
 * Identity training targets (Higgsfield's Soul ID). A trained element is used automatically
 * whenever it's @mentioned on one of the target's models — as a Soul ID reference or a LoRA
 * plus trigger word — instead of reference photos.
 */
import type { Engine } from "./types";

export type TrainingProvider = "higgsfield" | "fal" | "ai-toolkit";

export interface TrainingTarget {
  id: string;
  name: string;
  engine: Engine;
  provider: TrainingProvider;
  /** Models the trained identity applies to. */
  modelIds: string[];
  minImages: number;
  description: string;
  price: string;
  /** Rough wall-clock time. */
  eta: string;
}

export const TRAINING_TARGETS: TrainingTarget[] = [
  {
    id: "soul-id-v2",
    name: "Soul ID · Soul 2.0",
    engine: "cloud",
    provider: "higgsfield",
    modelIds: ["soul-2"],
    minImages: 5,
    description: "Higgsfield's own character training for Soul 2.0 — the most faithful faces, used across Soul styles.",
    price: "Higgsfield balance",
    eta: "~5–10 min",
  },
  {
    id: "soul-id-cinema",
    name: "Soul ID · Soul Cinema",
    engine: "cloud",
    provider: "higgsfield",
    modelIds: ["soul-cinema"],
    minImages: 5,
    description: "The same character trained for Soul Cinema's film stills.",
    price: "Higgsfield balance",
    eta: "~5–10 min",
  },
  {
    id: "fal-z-image",
    name: "Z-Image Turbo LoRA (fal)",
    engine: "cloud",
    provider: "fal",
    modelIds: ["z-image-turbo-cloud"],
    minImages: 5,
    description: "A character LoRA for hosted Z-Image Turbo: photoreal, sub-second images of your character.",
    price: "≈ $0.85 (1,000 steps)",
    eta: "~5 min",
  },
  {
    id: "aitk-z-image",
    name: "Z-Image Turbo LoRA (your GPU)",
    engine: "open",
    provider: "ai-toolkit",
    modelIds: ["oss-z-image-turbo"],
    minImages: 5,
    description: "Train on your own GPU with AI-Toolkit (24 GB). The LoRA is used by the open-source Z-Image Turbo workflow.",
    price: "Free",
    eta: "~30–60 min on a 4090",
  },
];

export const getTrainingTarget = (id: string) => TRAINING_TARGETS.find((t) => t.id === id);

/** A short, rare trigger token for an element, e.g. "mayalpz". */
export function triggerFor(handle: string): string {
  const base = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
  const consonants = base.replace(/[aeiou]/g, "");
  return `${(consonants.length >= 3 ? consonants : base).slice(0, 6) || "elem"}fz`;
}

/** AI-Toolkit job config for a Z-Image Turbo character LoRA (docs/research/comfyui-oss-2.json → character-lora). */
export function aiToolkitJob(opts: { name: string; trigger: string; datasetFolder: string; outputFolder: string; steps?: number }) {
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
          network: { type: "lora", linear: 16, linear_alpha: 16 },
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
            steps: opts.steps ?? 2500,
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
            prompts: [`photo of ${opts.trigger}, close-up portrait, natural window light`, `${opts.trigger} walking in a neon-lit street at night, full body`],
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
