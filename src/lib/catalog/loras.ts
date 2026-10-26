/**
 * LoRAs as part of a recipe, on both engines. Pure logic, no I/O:
 * - the researched library (lora-library.generated.ts) and how to turn an entry into a LoraRef;
 * - what a cloud run may carry (the licence rules of the build plan: a LoRA whose licence doesn't allow
 *   hosting runs only on the user's GPU) and how many the route's API takes (fitLoras);
 * - the payload fields each API shape wants (loraFields) and when a route switches to its LoRA endpoint.
 * Downloads, mirrors and the civitai key live in src/server/loras.ts.
 */
import { LORA_LIBRARY } from "./lora-library.generated";
import type { LoraField, LoraLicence, LoraRef, ModelRoute } from "./types";

export type LoraDownload = "direct" | "civitai-token" | "hf-gated";

/** A researched LoRA: a LoraRef with where it comes from and what its licence allows. */
export interface LoraEntry extends LoraRef {
  key: string;
  name: string;
  url: string;
  /** Its model card (Hugging Face or civitai). */
  page: string;
  strength: number;
  /** The base it was trained for: z-image-turbo, wan2.2-i2v-a14b, wan2.1-i2v-14b-480p, ltx-2.3-22b… */
  base: string;
  /** direct = a public URL; civitai-token = civitai answers 401 without the user's key; hf-gated = accept the licence on Hugging Face first. */
  download: LoraDownload;
  /** "look" (Soul looks) or the preset family it moves. */
  group: "look" | "motion" | "effect";
  licence: LoraLicence;
  /** civitai model id (permissions are per model; the file is pinned by `version`). */
  civitaiModel?: string;
  /** The file's SHA256 and size, read once when it was pinned (scripts/fetch-lora-pins.py): a download must match. */
  sha256?: string;
  sizeBytes?: number;
  released?: string;
  /** The hosted route the research checked it on. */
  hostedEndpoint?: string;
  /** No default preset uses it. */
  spare?: boolean;
  notes?: string;
}

export interface MotionEffectLoras {
  kind: "motion" | "effect";
  /** Preset names (generic words) this row covers. */
  presets: string[];
  /** add-lora, local-only, prompt-only, alias, fun-camera, train-own… (research §7). */
  status: string;
  /** LORA_LIBRARY keys, high-noise file before low-noise when they come as a pair. */
  loras: string[];
  hostedEndpoint?: string;
  bothEnginesToday: boolean;
  newSinceMid2026: boolean;
  notes?: string;
}

const BY_KEY = new Map(LORA_LIBRARY.map((e) => [e.key, e]));
const BY_FILE = new Map(LORA_LIBRARY.map((e) => [e.file, e]));
/** By download, without the pin: a ref built from the research's resolve/main URL or a civitai version is still the library file. */
const unpinned = (url: string) => url.replace(/^(https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/)[0-9a-f]{40}\//, "$1main/").split("?")[0];
const BY_URL = new Map(LORA_LIBRARY.map((e) => [unpinned(e.url), e]));

export const loraEntry = (key: string): LoraEntry | undefined => BY_KEY.get(key);
export const loraByFile = (file: string): LoraEntry | undefined => BY_FILE.get(file);

/**
 * The library entry a recipe's LoRA is, by its file name or its download (a ref built by hand, without
 * loraRef(), still gets the library's licence and pins). Undefined for the user's own LoRAs.
 */
export function libraryEntry(l: Pick<LoraRef, "file" | "url">): LoraEntry | undefined {
  return (l.file ? BY_FILE.get(l.file) : undefined) ?? (l.url ? BY_URL.get(unpinned(l.url)) : undefined);
}

/** A library entry as a recipe's LoRA, at the entry's strength unless the recipe sets one. */
export function loraRef(entry: LoraEntry, strength = entry.strength): LoraRef {
  const { file, url, trigger, target, weightName, version, licence } = entry;
  return { file, url, strength, ...(trigger && { trigger }), ...(target && { target }), ...(weightName && { weightName }), ...(version && { version }), licence };
}

/** The pinned civitai model version in a download URL (https://civitai.com/api/download/models/<id>). */
export function civitaiVersion(url: string | undefined): string | undefined {
  return url ? /^https:\/\/civitai\.com\/api\/download\/models\/(\d+)/.exec(url)?.[1] : undefined;
}

/** civitai answers 401 without the user's key, so its URLs never go to a cloud API as they are. */
export const needsToken = (url: string | undefined): boolean => !!url && /^https:\/\/(www\.)?civitai\.com\//.test(url);

/** How a person reads a LoRA: its library name, else its file without the extension. */
export function loraName(l: Pick<LoraRef, "file" | "url">): string {
  const e = libraryEntry(l);
  if (e) return e.name;
  const base = (l.file || l.url?.split("?")[0].split("/").pop() || "").replace(/\.safetensors$/i, "");
  return base ? `the ${base} LoRA` : "a trained LoRA";
}

/**
 * The URL a cloud API fetches the LoRA from: a mirror when there is one, else a public download.
 * None for a civitai file that isn't mirrored yet (the user's key never goes to fal or Replicate), a
 * gated Hugging Face file, or a LoRA that exists only as a file on the user's ComfyUI.
 */
export function cloudPath(l: LoraRef): string | undefined {
  if (l.hostedUrl) return l.hostedUrl;
  if (!l.url || needsToken(l.url) || gated(l)) return undefined;
  return l.url;
}

/** In a gated Hugging Face repo: it downloads only after its licence is accepted with an HF account. */
export const gated = (l: Pick<LoraRef, "file" | "url">): boolean => libraryEntry(l)?.download === "hf-gated";

/**
 * Runs only on the user's GPU: its licence doesn't allow running it on fal or Replicate (civitai without
 * "Rent"). The library's licence counts even when the ref carries none (or another): either one saying
 * no keeps it off the cloud.
 */
export const localOnly = (l: LoraRef): boolean => l.licence?.hostedOk === false || libraryEntry(l)?.licence.hostedOk === false;

/** How many LoRAs one call of this API takes (Infinity when the schema states no limit). */
export function loraCapacity(field: LoraField): number {
  if (field.shape === "single") return 1;
  if (field.shape === "experts") return 2;
  return field.max ?? Infinity;
}

/** Each LoRA's expert on a two-expert model: Wan 2.1 LoRAs and single-file LoRAs go on both. */
const expertOf = (l: LoraRef): "high" | "low" | "both" => l.target ?? "both";

/**
 * Split the LoRAs between the slots an API has, in order: the first ones win. Replicate's Wan 2.2 takes
 * one LoRA per expert, so a motion and an effect can't be stacked there (a "both" LoRA takes both slots).
 */
function fitSlots(field: LoraField, loras: LoraRef[]): { kept: LoraRef[]; over: LoraRef[] } {
  if (field.shape !== "experts") {
    const cap = loraCapacity(field);
    return { kept: loras.slice(0, cap), over: loras.slice(cap) };
  }
  const used = { high: false, low: false };
  const kept: LoraRef[] = [];
  const over: LoraRef[] = [];
  for (const l of loras) {
    const e = expertOf(l);
    const free = e === "both" ? !used.high && !used.low : !used[e];
    if (!free) {
      over.push(l);
      continue;
    }
    if (e !== "low") used.high = true;
    if (e !== "high") used.low = true;
    kept.push(l);
  }
  return { kept, over };
}

/**
 * A cloud API can be sent this LoRA: not local-only, and with a URL it can fetch (a mirror or a public file)
 * or a civitai file Fuobe mirrors before the run. Not a gated Hugging Face file (no HF token here) nor a file
 * that exists only on the user's ComfyUI.
 */
const sendable = (l: LoraRef) => !localOnly(l) && (!!cloudPath(l) || (!!l.url && needsToken(l.url)));
const sendableToCloud = (loras: LoraRef[]) => loras.filter(sendable);

/** fal's `/lora` endpoints before FieldMap.loras was generated: loras [{path, scale}]. */
const FAL_ITEMS: LoraField = { shape: "items", key: "loras" };

/** How a cloud route takes LoRAs: its FieldMap.loras, or fal's plain list on a LoRA endpoint. */
export function routeLoraField(route: Pick<ModelRoute, "map" | "loraEndpoint">): LoraField | undefined {
  return route.map?.loras ?? (route.loraEndpoint ? FAL_ITEMS : undefined);
}

/**
 * Whether every LoRA a cloud run could send fits one call of this route (route choice prefers one that
 * takes them all: a Mix of two Wan 2.2 motions runs on fal, not on Replicate's one-per-expert model).
 */
export function lorasFit(route: Pick<ModelRoute, "provider" | "map" | "loraEndpoint">, loras: LoraRef[]): boolean {
  if (route.provider === "comfyui" || route.provider === "mock") return true;
  const cloud = sendableToCloud(loras);
  if (!cloud.length) return true;
  const field = routeLoraField(route);
  return !!field && fitSlots(field, cloud).over.length === 0;
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * The LoRAs a cloud run carries, and what it says about the ones it leaves out:
 * - a LoRA whose licence doesn't allow hosting (civitai "RentCivit" only) runs only on the user's GPU;
 * - a gated Hugging Face LoRA (accept its licence first) runs only on the user's GPU;
 * - a LoRA that exists only as a file on the user's ComfyUI (an open-engine training) can't be sent;
 * - beyond the API's maximum (3 on Z-Image, Qwen, FLUX.2 [klein] and LTX-2.3 quality; one per expert on
 *   Replicate's Wan 2.2), the first ones win. planGeneration puts the user's own LoRAs (an @character's
 *   trained identity) first, so a look's LoRAs give way to them, never the other way round.
 * Open-engine runs carry every LoRA (ComfyUI stacks as many as the graph takes).
 */
export function fitLoras(loras: LoraRef[], route: Pick<ModelRoute, "provider" | "map" | "loraEndpoint">): { loras: LoraRef[]; notes: string[] } {
  if (!loras.length || route.provider === "comfyui" || route.provider === "mock") return { loras, notes: [] };
  const notes: string[] = [];
  const local = loras.filter(localOnly);
  if (local.length) notes.push(`${list(local.map(loraName))} ${local.length > 1 ? "run" : "runs"} only on your GPU (the licence doesn't allow hosting it), so this cloud run leaves ${local.length > 1 ? "them" : "it"} out`);
  const locked = loras.filter((l) => !localOnly(l) && !l.hostedUrl && gated(l));
  if (locked.length) notes.push(`${list(locked.map(loraName))} ${locked.length > 1 ? "are" : "is"} in a gated Hugging Face repo, so this cloud run leaves ${locked.length > 1 ? "them" : "it"} out (on your GPU ${locked.length > 1 ? "they run" : "it runs"} once you've accepted the licence)`);
  const unsent = loras.filter((l) => !localOnly(l) && !gated(l) && !sendable(l));
  if (unsent.length) notes.push(`${list(unsent.map(loraName))} ${unsent.length > 1 ? "exist" : "exists"} only on your ComfyUI, so this cloud run leaves ${unsent.length > 1 ? "them" : "it"} out`);
  const cloud = sendableToCloud(loras);
  const field = routeLoraField(route);
  if (!field) {
    if (cloud.length) notes.push(`This model takes no LoRAs in the cloud, so ${list(cloud.map(loraName))} ${cloud.length > 1 ? "are" : "is"} left out`);
    return { loras: [], notes };
  }
  const { kept, over } = fitSlots(field, cloud);
  if (over.length) {
    const why = field.shape === "experts" ? "one LoRA per expert" : `up to ${loraCapacity(field)} LoRA${loraCapacity(field) > 1 ? "s" : ""}`;
    notes.push(`This API takes ${why}, so ${list(over.map(loraName))} ${over.length > 1 ? "are" : "is"} left out`);
  }
  return { loras: kept, notes };
}

const clampScale = (v: number | undefined, range: { min: number; max: number } | undefined) => {
  const s = v ?? 1;
  return range ? Math.min(range.max, Math.max(range.min, s)) : s;
};

/**
 * The payload fields that carry these LoRAs (empty when none can be sent). Only LoRAs with a cloud path
 * (cloudPath) are sent; the rest were mirrored or left out (with a note) before this runs.
 */
export function loraFields(field: LoraField, loras: LoraRef[] | undefined): Record<string, unknown> {
  const sendable = (loras ?? []).filter((l) => !localOnly(l) && cloudPath(l));
  if (!sendable.length) return {};
  const { kept } = fitSlots(field, sendable);
  const range = field.range;
  switch (field.shape) {
    case "items":
      return {
        [field.key]: kept.map((l) => ({
          path: cloudPath(l),
          scale: clampScale(l.strength, range),
          // Wan 2.2's experts (high noise, low noise); a LoRA with no target goes on both.
          ...(field.transformer && { transformer: expertOf(l) }),
          ...(field.weightName && l.weightName && { weight_name: l.weightName }),
        })),
      };
    case "arrays":
      return { [field.weights]: kept.map(cloudPath), [field.scales]: kept.map((l) => clampScale(l.strength, range)) };
    case "single":
      return { [field.weights]: cloudPath(kept[0]), [field.scale]: clampScale(kept[0].strength, range) };
    case "experts": {
      const out: Record<string, unknown> = {};
      for (const l of kept) {
        const e = expertOf(l);
        for (const x of e === "both" ? (["high", "low"] as const) : [e]) {
          out[field[x].weights] = cloudPath(l);
          out[field[x].scale] = clampScale(l.strength, range);
        }
      }
      return out;
    }
  }
}

/**
 * The endpoint a cloud run calls: the route's LoRA endpoint when it carries LoRAs, else its own.
 * An endpoint that needs at least one LoRA (fal's LTX-2.3 22B `/lora`) and gets none is refused here,
 * so it never answers with a validation error.
 */
export function loraEndpointFor(route: Pick<ModelRoute, "endpoint" | "map" | "loraEndpoint">, loras: LoraRef[] | undefined): string {
  const field = routeLoraField(route);
  const carries = !!field && Object.keys(loraFields(field, loras)).length > 0;
  if (carries) return route.loraEndpoint ?? route.endpoint;
  if (!route.loraEndpoint && field?.shape === "items" && field.required) throw new Error("This model needs at least one LoRA — pick a look or motion that adds one");
  return route.endpoint;
}

/** What a LoRA's licence says, in a few words, for lists (Settings → LoRAs, About & licences). */
export function licenceLine(l: LoraLicence | undefined): string {
  if (!l) return "Your own";
  if (!l.commercial) return "Non-commercial";
  return l.hostedOk ? "Commercial · GPU and cloud" : "Commercial · your GPU only";
}
