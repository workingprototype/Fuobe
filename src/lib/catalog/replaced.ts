/**
 * What replaced each retired model, look and training target when Fuobe stopped calling Higgsfield's API (build plan O7,
 * docs/research/fuobe-originals-recipes-5.md, "What replaces each Higgsfield model when the provider is removed").
 *
 * One way only: an id stored before the switch — a past generation's Reuse, a saved Cinema or Canvas project, an Assist
 * plan, a Genjutsu setup code, a Katana job, a moodboard pick, a training — resolves here to the model that does the job
 * now, a Fuobe Original where there is one, else a partner model on fal or Replicate. Nothing here is ever sent to a
 * provider. Past generations stay viewable as they are: the Library reads their saved outputs, not a provider.
 *
 * Soul's old style ids resolve to Fuobe looks through lookCard() (each look keeps the id it replaces, never sent);
 * Genjutsu's old looks are dropped (a Soul look or your own images replace them).
 *
 * Pure and browser-safe (cards only, no recipes); shared by the browser and the server. tests/no-higgsfield.test.ts checks every target exists.
 */
import { lookCard } from "./soul-cards";

export interface Replacement {
  /** The model (or training target) that does the job now. */
  id: string;
  /** What the retired item was called, for history (the Library, Assist, an old setup). */
  was: string;
  /** One line on what changed, shown where an old setup or run is opened again. */
  note: string;
  /** A Fuobe Original (both engines): a stored cloud run stays in the cloud unless it says otherwise. */
  original?: true;
}

/** Retired model id → the model that replaced it. */
export const REPLACED_BY: Readonly<Record<string, Replacement>> = {
  "soul-1": { id: "fuobe-soul", was: "Soul (Higgsfield)", note: "Soul now runs as Fuobe Soul, with Soul's 106 looks on open weights", original: true },
  "soul-2": { id: "fuobe-soul", was: "Soul 2.0 (Higgsfield)", note: "Soul 2.0 now runs as Fuobe Soul, with Soul 2.0's 33 looks on open weights", original: true },
  "soul-cinema": { id: "fuobe-soul-cinema", was: "Soul Cinema (Higgsfield)", note: "Soul Cinema now runs as Fuobe Soul Cinema on open weights", original: true },
  "cinema-studio-4": { id: "fuobe-cinema", was: "Cinema Studio 4.0 (Higgsfield)", note: "Cinema Studio's clips now run on Fuobe Cinema, with the Director panel compiled into the run", original: true },
  "genjutsu-motion-transfer": { id: "fuobe-genjutsu-motion", was: "Genjutsu Motion Transfer (Higgsfield)", note: "Motion transfer now runs on Fuobe Genjutsu (Wan Animate)", original: true },
  "genjutsu-lite-motion-transfer": { id: "fuobe-genjutsu-motion-lite", was: "Genjutsu Lite Motion Transfer (Higgsfield)", note: "Motion transfer Lite now runs on Fuobe Genjutsu Lite", original: true },
  "genjutsu-object-swap": { id: "fuobe-genjutsu-swap", was: "Genjutsu Object Swap (Higgsfield)", note: "Object swap now runs on Fuobe Genjutsu (SAM 3.1 + Wan VACE)", original: true },
  "genjutsu-lite-object-swap": { id: "fuobe-genjutsu-swap-lite", was: "Genjutsu Lite Object Swap (Higgsfield)", note: "Object swap Lite now runs on Fuobe Genjutsu Lite", original: true },
  "genjutsu-restyle": { id: "fuobe-genjutsu-restyle", was: "Genjutsu Restyle (Higgsfield)", note: "Restyle now runs on Fuobe Genjutsu with a Fuobe look", original: true },
  // O10 builds Fuobe's own Marketing image on Qwen-Image-Edit; until then the partner model Higgsfield ran underneath.
  "marketing-studio-image": { id: "gpt-image-2-5", was: "Marketing Studio Image (Higgsfield)", note: "Marketing images now run on GPT Image 2.5 with Fuobe's format prompts" },
  // Ads Studio's one-shot ad became Fuobe's Ads pipeline (copy, then a visual, composited in the browser); a single run reuses its visual model.
  "ads-studio": { id: "nano-banana-pro", was: "Ads Studio (Higgsfield)", note: "Ads now come from Fuobe's Ads pipeline: written copy, a Nano Banana Pro visual and your fonts" },
  // The AI Influencer app draws its sheet on Nano Banana Pro, as the builder does, until O10 moves it to Fuobe Soul.
  "ai-influencer": { id: "nano-banana-pro", was: "AI Influencer (Higgsfield)", note: "The AI Influencer sheet now runs on Nano Banana Pro (the Soul Cast sheet on your GPU)" },
};

/** Retired training targets (Higgsfield Soul ID) → the trainer that makes a Fuobe Soul ID from the same photos. */
export const TRAINING_REPLACED_BY: Readonly<Record<string, Replacement>> = {
  "soul-id-v2": { id: "fal-z-image", was: "Soul ID for Soul 2.0 (Higgsfield)", note: "Train the character again for Fuobe Soul on the same photos" },
  "soul-id-cinema": { id: "fal-z-image", was: "Soul ID for Soul Cinema (Higgsfield)", note: "Train the character again for Fuobe Soul on the same photos" },
};

/** The replacement of a retired model id, or undefined for a current one. */
export const replacedBy = (id: string | undefined | null): Replacement | undefined => (id && Object.hasOwn(REPLACED_BY, id) ? REPLACED_BY[id] : undefined);

/** The id to use for a stored model id: its replacement when it was retired, else itself. */
export const currentModelId = (id: string): string => replacedBy(id)?.id ?? id;

/** The settings keys a retired model's request carried that mean nothing to its replacement (style ids, Soul ID refs, looks). */
const RETIRED_EXTRA = ["style_id", "custom_reference_id", "custom_reference_strength", "preset_id", "color_palette", "template_id"] as const;

interface StoredRequest {
  modelId: string;
  engine?: "cloud" | "open";
  presetId?: string;
  params?: { extra?: Record<string, unknown> };
}

/**
 * A stored request (Reuse, a saved project's step, an Assist plan) moved to the model that replaced its own, with what
 * still means something kept: a Soul style id becomes the Fuobe look that replaced it (`presetId`), the retired API's
 * own settings (style, Soul ID reference, palette slug, Genjutsu look) are dropped. A current model's request is
 * returned as it is. `note` says what changed, for a toast.
 */
export function migrateRequest<T extends StoredRequest>(req: T): { request: T; note?: string } {
  const r = replacedBy(req.modelId);
  if (!r) return { request: req };
  const extra = { ...(req.params?.extra ?? {}) };
  const look = typeof extra.style_id === "string" ? lookCard(extra.style_id) : undefined;
  for (const k of RETIRED_EXTRA) delete extra[k];
  const params = req.params ? { ...req.params, ...(req.params.extra && { extra }) } : undefined;
  if (params?.extra && !Object.keys(params.extra).length) delete params.extra;
  const request = { ...req, modelId: r.id, ...(params && { params }), ...(look && { presetId: look.id }), ...(r.original && { engine: req.engine ?? "cloud" }) };
  return { request, note: r.note };
}
