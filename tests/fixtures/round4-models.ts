import type { ModelDef, Operation } from "@/lib/catalog/types";

/**
 * Stand-in cloud models for the round-4 operations (some have no cloud model at all: scene-3d and
 * export-video run on the open engine). They route to fal, which tests never configure, so they run
 * on the demo provider.
 */
const fixture = (op: Operation, kind: ModelDef["kind"]): ModelDef => ({
  id: `test4-${op}`,
  name: `Test ${op}`,
  vendor: "Test",
  family: "test",
  engine: "cloud",
  kind,
  tagline: `Fixture for ${op}`,
  routes: [{ op, provider: "fal", endpoint: `test/${op}` }],
  options: { aspectRatios: ["1:1", "16:9", "9:16"], maxImages: 10 },
  pricing: { unit: "request", usd: 0.01 },
});

export const ROUND4_FIXTURES: ModelDef[] = [
  fixture("remove-object", "video"),
  fixture("video-swap", "video"),
  fixture("video-insert", "video"),
  fixture("keyframes", "video"),
  fixture("sdr-to-hdr", "video"),
  fixture("export-video", "video"),
  fixture("ocr", "text"),
  fixture("still-motion", "video"),
  fixture("audio-loop", "audio"),
  fixture("audio-join", "audio"),
  fixture("scene-3d", "model3d"),
  fixture("splat", "model3d"),
  fixture("text-to-3d", "model3d"),
  fixture("rig-3d", "model3d"),
  fixture("extract-frames", "image"),
  fixture("images-to-video", "video"),
  fixture("overlay", "image"),
];
