import { getModel } from "@/lib/catalog";
import type { Preset } from "@/lib/catalog/types";
import type { StudioConfig } from "@/components/studio/studio-context";

export const IMAGE_STUDIO: StudioConfig = {
  feature: "image",
  title: "Image",
  hero: "What should we make today?",
  placeholder: "Describe an image… try “a koi pond at night, neon rain”",
  kind: "image",
  ops: ["t2i", "edit"],
  feed: { kind: "image", features: ["image", "edit", "app:*", "character:*"] },
  slots: [],
  multiRef: { label: "Add ref", max: 8 },
  defaultModels: { cloud: "nano-banana-pro", open: "oss-z-image-turbo" },
  suggestions: [
    "Editorial portrait of a woman in a yellow raincoat, Tokyo crosswalk at dusk, 35mm film",
    "Isometric cozy reading nook with plants and warm lamp light, 3D render",
    "Product shot of a matte black perfume bottle on wet volcanic rock",
    "A koi pond at night, neon rain, cinematic",
  ],
};

export const EDIT_STUDIO: StudioConfig = {
  feature: "edit",
  title: "Edit",
  hero: "What should change?",
  placeholder: "Describe the change… e.g. “replace the sky with a sunset”",
  kind: "image",
  ops: ["edit"],
  feed: { kind: "image", features: ["edit"] },
  slots: [{ key: "image", label: "Image", accept: "image", required: true }],
  multiRef: { label: "Add ref", max: 6 },
  defaultModels: { cloud: "nano-banana-pro", open: "oss-qwen-edit" },
  suggestions: [
    "Make it golden hour",
    "Remove the people in the background",
    "Turn this into a watercolor painting",
    "Put the person from image 2 next to them, same lighting",
  ],
};

export const VIDEO_STUDIO: StudioConfig = {
  feature: "video",
  title: "Video",
  hero: "What’s the shot?",
  placeholder: "Describe a shot… e.g. “slow dolly-in on a rainy street, neon reflections”",
  kind: "video",
  ops: ["t2v", "i2v", "flf2v", "ref2v"],
  feed: { kind: "video", features: ["video", "motion:*", "effect:*"] },
  slots: [
    { key: "image", label: "Start frame", accept: "image" },
    { key: "endImage", label: "End frame", accept: "image" },
  ],
  multiRef: { label: "Add ref", max: 3 },
  presetPicker: "motion",
  defaultModels: { cloud: "seedance-2-5", open: "oss-wan22-14b-fast" },
  suggestions: [
    "A paper boat drifts down a rain-soaked street gutter, macro, slow motion",
    "FPV drone dives off a sea cliff at sunrise and skims the waves",
    "A chef flambés a pan in a dark kitchen, sparks fly, handheld",
    "Astronaut walks through a field of glowing flowers on an alien planet",
  ],
};

export const LIPSYNC_STUDIO: StudioConfig = {
  feature: "lipsync",
  title: "Lipsync & avatars",
  hero: "Make anyone talk",
  placeholder: "Optional: how should they act? e.g. “friendly, nodding, hand gestures”",
  kind: "video",
  ops: ["avatar", "lipsync"],
  feed: { kind: "video", features: ["lipsync"] },
  slots: [
    { key: "image", label: "Portrait", accept: "image", hint: "For a talking avatar" },
    { key: "video", label: "Video", accept: "video", hint: "To re-sync an existing clip" },
    { key: "audio", label: "Voice", accept: "audio", required: true },
  ],
  defaultModels: { cloud: "kling-avatar-2", open: "oss-infinitetalk" },
  promptOptional: true,
};

export const UPSCALE_STUDIO: StudioConfig = {
  feature: "upscale",
  title: "Upscale",
  hero: "Sharper, bigger, cleaner",
  placeholder: "",
  kind: "image",
  ops: ["upscale-image", "upscale-video"],
  feed: { features: ["upscale"] },
  slots: [{ key: "image", label: "Image", accept: "image", required: true }],
  defaultModels: { cloud: "topaz-image", open: "oss-upscale-image" },
  promptOptional: true,
  hidePrompt: true,
};

export const VIDEO_UPSCALE_STUDIO: StudioConfig = {
  ...UPSCALE_STUDIO,
  kind: "video",
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "topaz-video", open: "oss-seedvr2" },
};

export const AUDIO_STUDIO: StudioConfig = {
  feature: "audio",
  title: "Audio",
  hero: "Give it a voice",
  placeholder: "What should it say, or what should it sound like?",
  kind: "audio",
  ops: ["tts", "sfx", "music"],
  feed: { kind: "audio", features: ["audio"] },
  slots: [],
  defaultModels: { cloud: "elevenlabs-tts", open: "oss-ace-step" },
  suggestions: ["Welcome to Fuobe — make anything, with any model.", "Thunder rolling over a quiet forest", "Lo-fi hip hop beat with soft piano, 80 bpm"],
};

export const FOLEY_STUDIO: StudioConfig = {
  feature: "audio",
  title: "Audio",
  hero: "Add sound to a video",
  placeholder: "Optional: describe the sound, e.g. “footsteps on gravel, distant birds”",
  kind: "video",
  ops: ["v2a"],
  feed: { features: ["audio"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  defaultModels: { cloud: "mmaudio-cloud", open: "oss-mmaudio" },
  promptOptional: true,
};


/** Studio config for a one-click app. */
export function appStudio(preset: Preset): StudioConfig {
  const base = preset.cloud ?? preset.open!;
  const kind = getModel(base.modelId)?.kind ?? "image";
  const ops = [...new Set([preset.cloud?.op, preset.open?.op].filter(Boolean))] as StudioConfig["ops"];
  return {
    feature: `app:${preset.id}`,
    title: preset.name,
    hero: preset.description,
    subtitle: [
      preset.cloud ? `Cloud: ${getModel(preset.cloud.modelId)?.name}` : "No cloud version yet",
      preset.open ? `Open source: ${getModel(preset.open.modelId)?.name}` : "No open-source version yet",
      preset.parity,
    ]
      .filter(Boolean)
      .join(" · "),
    placeholder: preset.promptPlaceholder ?? "Add details (optional)",
    kind,
    ops,
    feed: { features: [`app:${preset.id}`] },
    slots: preset.inputs,
    preset,
    defaultModels: { cloud: preset.cloud?.modelId ?? preset.open!.modelId, open: preset.open?.modelId ?? preset.cloud!.modelId },
    promptOptional: preset.userPrompt !== "required",
    hidePrompt: preset.userPrompt === "none",
  };
}

export const MOTION_CONTROL_STUDIO: StudioConfig = {
  feature: "motion-control",
  title: "Motion control",
  hero: "Make your character copy any move",
  placeholder: "Optional: describe the character or scene",
  kind: "video",
  ops: ["motion-transfer"],
  feed: { features: ["motion-control"] },
  slots: [
    { key: "image", label: "Character", accept: "image", required: true },
    { key: "video", label: "Driving video", accept: "video", required: true },
  ],
  defaultModels: { cloud: "kling-motion-control", open: "oss-wan22-animate" },
  promptOptional: true,
};

export const VIDEO_EDIT_STUDIO: StudioConfig = {
  feature: "video-edit",
  title: "Edit video",
  hero: "Change anything in a clip",
  placeholder: "Describe the edit… e.g. “make it snow”, “replace the car with a horse”",
  kind: "video",
  ops: ["v2v"],
  feed: { features: ["video-edit"] },
  slots: [{ key: "video", label: "Video", accept: "video", required: true }],
  multiRef: { label: "Add ref", max: 4 },
  defaultModels: { cloud: "kling-o3", open: "oss-wan22-fun-control" },
};
