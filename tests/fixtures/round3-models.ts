import type { ModelDef, Operation } from "@/lib/catalog/types";

/**
 * Stand-in cloud models for the round-3 operations (the real ones come from the catalog
 * packages). They route to fal, which tests never configure, so they run on the demo provider.
 */
const fixture = (id: string, op: Operation, kind: ModelDef["kind"]): ModelDef => ({
  id,
  name: `Test ${op}`,
  vendor: "Test",
  family: "test",
  engine: "cloud",
  kind,
  tagline: `Fixture for ${op}`,
  routes: [{ op, provider: "fal", endpoint: `test/${op}` }],
  options: { aspectRatios: ["1:1", "16:9", "9:16"] },
  pricing: { unit: "request", usd: 0.01 },
});

export const ROUND3_FIXTURES: ModelDef[] = [
  fixture("test-layers", "layers", "image"),
  fixture("test-text-layers", "text-layers", "image"),
  fixture("test-trim", "trim", "video"),
  fixture("test-captions", "captions", "video"),
  fixture("test-mux", "mux", "video"),
  fixture("test-transcribe", "transcribe", "text"),
  fixture("test-separate", "separate-audio", "audio"),
  fixture("test-3d", "image-to-3d", "model3d"),
];
