/**
 * Fuobe DoP (build plan O4): Higgsfield's DoP camera motions, its Mix and its effects as one Original on both
 * engines, rebuilt from open weights and LoRAs. Pure logic, no I/O: from the preset → LoRA map v2
 * (oss-loras.generated.ts, research §7) to each preset's open and cloud routes.
 *
 * - Wan 2.2 / 2.1 LoRAs → Fuobe DoP: Wan 2.2 14B on the user's GPU (LoRAs injected on their expert), fal's Wan 2.2
 *   A14B LoRA endpoint in the cloud (49 or 81 frames at 16 fps), Replicate's fast Wan as the second provider.
 * - LTX-2.3 LoRAs (FPV Drone, Wind to Face, the transitions) and LTX-2.3's built-in camera LoRA (dolly, jib, static)
 *   → Fuobe DoP · LTX. A camera move Wan 2.2 Fun Camera makes natively takes its pose on the user's GPU.
 * - LTX-2.5 LoRAs (Slow Motion, Car Jump) run on the user's GPU only: fal has no LTX-2.5 LoRA endpoint, so the
 *   cloud runs the preset's words. Focus Change is LTX-2.5's own focus_shift move, hosted (LTX-2.5 Fast).
 * - Effects that are a grade (15) animate without a LoRA, then the grade is applied in the browser; the relight
 *   effects (6) relight the start frame first (Qwen-Image-Edit 2509 + its Relight LoRA), then animate it.
 * - A LoRA whose licence doesn't allow hosting (civitai "RentCivit") stays on the user's GPU: the cloud route leaves
 *   it out (and fitLoras would too, saying so).
 * - A preset with nothing of the Original's own in the cloud (no hostable LoRA, camera LoRA, hosted move, grade or
 *   relight) keeps its partner route there, Kling 2.5 Turbo on the preset's words: Fuobe DoP on the words alone
 *   becomes its cloud default only when the evaluation harness (scripts/eval, O8) promotes it. On the user's GPU it
 *   is Fuobe DoP (Wan 2.2 on the words, as before).
 */
import { libraryEntry, localOnly, loraName, loraRef, triggerOf } from "./loras";
import { DOP_RECIPES, OSS_LORAS, type DopRecipe, type OssLora } from "./oss-loras.generated";
import type { LoraRef, Operation, Preset, PresetRoute } from "./types";

export const DOP_MODEL = "fuobe-dop";
export const DOP_LTX_MODEL = "fuobe-dop-ltx";
/** LTX-2.5 LoRAs: the open LTX-2.5 graph (fal has no LTX-2.5 LoRA endpoint). */
const LTX25_OPEN = "oss-ltx25";
/** LTX-2.5's camera_motion on fal's fast endpoint (Focus Change's focus_shift): open weights, hosted, no LoRAs. */
export const LTX25_HOSTED = "ltx-2-5-fast";
/** The relight step before the clip: Qwen-Image-Edit 2509 + the Relight LoRA (the open graph has it built in). */
export const RELIGHT_OPEN = "oss-qwen-relight";
export const RELIGHT_CLOUD = "qwen-image-edit-2509-cloud";
/** The Relight LoRA's trigger ("relight"): the open graph prefixes it itself. */
const RELIGHT_TRIGGER = "重新照明";

/** The Original's models (both engines). */
export const DOP_MODELS = new Set([DOP_MODEL, DOP_LTX_MODEL]);
export const isDop = (modelId: string | undefined): boolean => !!modelId && DOP_MODELS.has(modelId);

/** Which model family a LoRA loads on. */
export type LoraFamily = "wan" | "ltx" | "ltx-2.5" | "edit";

export function loraFamily(base: string): LoraFamily | undefined {
  if (/^wan2\.[12]/.test(base)) return "wan";
  if (/^ltx-2(\.3-|-19b)/.test(base)) return "ltx";
  if (/^ltx-2\.5/.test(base)) return "ltx-2.5";
  if (/^qwen-image-edit/.test(base)) return "edit";
  return undefined;
}

/** Statuses whose preset runs on its words alone (no cleared LoRA, a licence on hold, or a better route elsewhere). */
const WORDS_ONLY = new Set(["post-grade", "mixed-media-route", "licence-hold", "prompt-only", "train-own", "motion-library"]);

/**
 * Camera moves Wan 2.2 Fun Camera makes natively (round 1): a motion without a dedicated LoRA runs on that graph
 * with an explicit pose instead of camera words alone. The research's map v2 adds more (DOP_RECIPES.funCamera).
 */
const FUN_CAMERA_POSE: Record<string, string> = {
  "motion-pan-left": "Pan Left",
  "motion-pan-right": "Pan Right",
  "motion-tilt-up": "Pan Up",
  "motion-tilt-down": "Pan Down",
  "motion-zoom-in": "Zoom In",
  "motion-zoom-out": "Zoom Out",
  "motion-rapid-zoom-in": "Zoom In",
  "motion-rapid-zoom-out": "Zoom Out",
  "motion-dolly-out": "Zoom Out",
  "motion-static": "Static",
  "motion-dutch-angle": "ClockWise (CW)",
  "motion-roll-left": "Anti Clockwise (ACW)",
  "motion-roll-right": "ClockWise (CW)",
};

/** The colour-grade effects: animated without a LoRA, then graded in the browser (src/lib/grade.ts presets). */
export const DOP_GRADES: Record<string, string> = {
  "effect-film-colors": "film-colors",
  "effect-black-gloss": "black-gloss",
  "effect-candy-pink": "candy-pink",
  "effect-lime-jam": "lime-jam",
  "effect-nostalgic-blue": "nostalgic-blue",
  "effect-soft-palette": "soft-palette",
  "effect-overtime": "overtime",
  "effect-crimson-vigil": "crimson-vigil",
  "effect-bleach-bypass": "bleach-bypass",
  "effect-bleached-warm": "bleached-warm",
  "effect-classic-bw": "classic-bw",
  "effect-cold-steel": "cold-steel",
  "effect-hyper-neon": "hyper-neon",
  "effect-naturalistic-clean": "naturalistic-clean",
  "effect-sodium-decay": "sodium-decay",
};

/** What the relight effects ask of the Relight LoRA (Fuobe's words for each light). */
const RELIGHT_LIGHT: Record<string, string> = {
  "effect-silhouette": "strong backlight behind the subject, the subject nearly a dark silhouette with a glowing rim",
  "effect-practicals": "lit only by warm practical lamps in the scene, warm pools of light and moody falloff",
  "effect-window": "soft natural window light from the side, gentle shadows of the window frame",
  "effect-overhead-fall": "a single hard light from directly above, deep shadows under the eyes",
  "effect-contre-jour": "the sun directly behind the subject, flaring into the lens, glowing hair light",
  "effect-soft-cross": "two soft cross lights from opposite sides, even and flattering on the face",
};

const bare = (id: string) => id.replace(/^(motion|effect|app)-/, "");

/** A map LoRA as a recipe's LoRA: the library's pinned download and licence when it is a library file. */
function asRef(l: OssLora): LoraRef {
  const e = libraryEntry(l);
  if (e) return { ...loraRef(e, l.strength), target: l.target };
  const { file, url, strength, trigger, target, version, licence } = l;
  return { file, url, strength, ...(trigger && { trigger }), target, ...(version && { version }), licence };
}

/** The map's LoRAs for a preset (map v2 by preset id, else a round-1 match), with their family. */
export function presetLoras(presetId: string): { ref: LoraRef; base: string; family?: LoraFamily }[] {
  const raw = OSS_LORAS[presetId] ?? OSS_LORAS[bare(presetId)] ?? [];
  return raw.map((l) => ({ ref: asRef(l), base: l.base, family: loraFamily(l.base) }));
}

export const dopRecipe = (presetId: string): DopRecipe | undefined => DOP_RECIPES[presetId];

const withTrigger = (template: string, loras: LoraRef[]) => {
  const trigger = triggerOf(loras);
  return trigger ? `${trigger}. ${template}` : undefined;
};

const names = (loras: LoraRef[]) => {
  const seen = [...new Set(loras.map(loraName))];
  return seen.length < 2 ? seen.join("") : `${seen.slice(0, -1).join(", ")} and ${seen.at(-1)}`;
};

/**
 * A motion or effect preset as Fuobe DoP runs it: its open and cloud routes (model, operation, LoRAs, camera pose
 * or camera LoRA, prompt with the LoRA's trigger), what it adds (a grade, a relight step) and a line on how it runs.
 */
export function dopPreset(p: Preset): Preset {
  if (p.type !== "motion" && p.type !== "effect") return p;
  const recipe = DOP_RECIPES[p.id];
  const status = recipe?.status;
  const op: Operation = p.inputs.some((i) => i.key === "endImage") ? "flf2v" : "i2v";
  const all = status && WORDS_ONLY.has(status) ? [] : presetLoras(p.id);
  const of = (f: LoraFamily) => all.filter((l) => l.family === f).map((l) => l.ref);
  // The relight effects' LoRAs relight the still (Qwen 2509) or an existing clip (an LTX IC-LoRA): neither animates it.
  const relight = status === "relight-route";
  const wan = relight ? [] : of("wan");
  const ltx = relight ? [] : of("ltx");
  const ltx25 = relight ? [] : of("ltx-2.5");
  const pose = op === "i2v" ? (recipe?.funCamera ?? FUN_CAMERA_POSE[p.id]) : undefined;
  const base = { duration: 5 };
  const route = (modelId: string, loras: LoraRef[], params: PresetRoute["params"] = {}): PresetRoute => {
    const promptTemplate = loras.length ? withTrigger(p.promptTemplate, loras) : undefined;
    return { modelId, op, params: { ...base, ...params }, ...(loras.length && { loras }), ...(promptTemplate && { promptTemplate }) };
  };

  // On the user's GPU: Wan first (most LoRAs, Mix stacks there), then LTX-2.3, then LTX-2.5; else a pose; else words.
  let open: PresetRoute;
  let openSays: string;
  if (wan.length) {
    open = route(DOP_MODEL, wan);
    const wan21 = all.some((l) => l.family === "wan" && l.base.startsWith("wan2.1"));
    openSays = `Wan 2.2 with ${names(wan)}${wan21 ? " (a Wan 2.1 LoRA on Wan 2.2: its strength is checked on a GPU run)" : ""}`;
  } else if (ltx.length) {
    open = route(DOP_LTX_MODEL, ltx);
    openSays = `LTX-2.3 with ${names(ltx)}${all.some((l) => l.base.startsWith("ltx-2-19b")) ? " (an LTX-2 LoRA on LTX-2.3: unverified)" : ""}`;
  } else if (ltx25.length && op === "i2v") {
    open = { ...route(LTX25_OPEN, ltx25), params: { duration: 5, resolution: "720p" } };
    openSays = `LTX-2.5 with ${names(ltx25)}`;
  } else if (pose) {
    open = route(DOP_MODEL, [], { extra: { cameraMotion: pose } });
    openSays = `Wan 2.2 Fun Camera's "${pose}" move`;
  } else {
    open = route(DOP_MODEL, []);
    openSays = "Wan 2.2 on the preset's words";
  }

  // What the effect adds around the clip: a grade the browser applies after it, or a relight of the start frame first.
  const extras: Pick<Preset, "grade" | "prestep"> = {};
  const grade = DOP_GRADES[p.id];
  if (grade) extras.grade = grade;
  const light = RELIGHT_LIGHT[p.id];
  const relightLora = relight ? all.find((l) => l.family === "edit")?.ref : undefined;
  if (light && relightLora) {
    extras.prestep = {
      open: { modelId: RELIGHT_OPEN, op: "edit", prompt: light },
      cloud: { modelId: RELIGHT_CLOUD, op: "edit", prompt: `${RELIGHT_TRIGGER}, ${light}`, loras: [relightLora] },
    };
  }

  // In the cloud: LTX-2.5's own move, LTX-2.3's camera LoRA, the Wan or LTX LoRAs a host may run, a grade or a relight
  // on Wan. A LoRA whose licence keeps it on the GPU never reaches the cloud route (its trigger stays out too).
  // Anything else keeps its partner route on the preset's words until the evaluation harness promotes Fuobe DoP's.
  const wanHosted = wan.filter((l) => !localOnly(l));
  const ltxHosted = ltx.filter((l) => !localOnly(l));
  let cloud: PresetRoute;
  let cloudSays: string;
  if (recipe?.cameraMotion) {
    // The fast endpoint at 720p in the start frame's shape, silent like every DoP clip (its defaults say so too).
    cloud = { modelId: LTX25_HOSTED, op: "i2v", params: { duration: 6, resolution: "720p", aspectRatio: "auto", generateAudio: false, extra: { camera_motion: recipe.cameraMotion } } };
    cloudSays = `LTX-2.5's ${recipe.cameraMotion.replace(/_/g, " ")} camera move`;
  } else if (recipe?.cameraLora) {
    cloud = route(DOP_LTX_MODEL, ltxHosted, { extra: { camera_lora: recipe.cameraLora } });
    cloudSays = `LTX-2.3's ${recipe.cameraLora.replace(/_/g, " ")} camera LoRA${ltxHosted.length ? ` with ${names(ltxHosted)}` : ""}`;
  } else if (wanHosted.length) {
    cloud = route(DOP_MODEL, wanHosted);
    cloudSays = `Wan 2.2 with ${names(wanHosted)}`;
  } else if (ltxHosted.length) {
    cloud = route(DOP_LTX_MODEL, ltxHosted);
    cloudSays = `LTX-2.3 with ${names(ltxHosted)}`;
  } else if (extras.grade || extras.prestep || !p.cloud) {
    cloud = route(DOP_MODEL, []);
    cloudSays = "Wan 2.2 on the preset's words";
  } else {
    cloud = { ...p.cloud, partner: true };
    cloudSays = `the preset's words on a partner model until the evaluation harness measures Fuobe DoP on them${ltx25.length ? " (fal has no LTX-2.5 LoRA endpoint)" : ""}`;
  }

  const local = [...wan, ...ltx].filter(localOnly);
  let parity: string;
  if (grade) parity = "Fuobe DoP animates your still without a LoRA, then your browser grades the clip";
  else if (extras.prestep) parity = "Fuobe DoP relights your still first (Qwen-Image-Edit 2509 + its Relight LoRA), then animates it";
  else if (status === "mixed-media-route") parity = `${p.parity ?? ""}${p.parity ? ". " : ""}For a whole clip restyled frame by frame, use Mixed Media`;
  else if (openSays === cloudSays) parity = `Fuobe DoP: ${openSays}, on your GPU and in the cloud`;
  else parity = `Fuobe DoP on your GPU: ${openSays}. In the cloud: ${cloudSays}`;
  if (local.length) parity += `. ${names(local)} runs on your GPU only (its licence doesn't allow hosting), so the cloud runs the words`;
  return { ...p, open, cloud, parity, ...extras };
}
