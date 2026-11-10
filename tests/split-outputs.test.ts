import { describe, expect, it } from "vitest";
import type { GenerationRequest } from "@/lib/catalog/types";
import { reuseOutputs, splitRunRequest } from "@/lib/split-outputs";
import { draftFromRequest } from "@/components/studio/draft";
import { IMAGE_STUDIO } from "@/lib/studios";
import { getModel, getPreset } from "@/lib/catalog";

// A request for more pictures than one run of its graph makes is split one run per picture. Each run's stored request says
// what that run makes (its tile's placeholders, Retry and the Library read it), and keeps the number asked for (Reuse).
const ask: GenerationRequest = { feature: "image", modelId: "oss-minimax-h3-image", prompt: "a red fox in deep snow", engine: "open", params: { numOutputs: 3, seed: 7 } };

describe("splitRunRequest", () => {
  it("gives each of 3 runs one picture and keeps the 3 asked for", () => {
    const r = splitRunRequest(ask, 3, 1);
    expect(r.params?.numOutputs).toBe(1);
    expect(r.askedOutputs).toBe(3);
    expect(r.params?.seed).toBe(7);
    expect(ask.params?.numOutputs).toBe(3);
  });

  it("splits into groups when a run makes several (8 asked, 4 per run)", () => {
    const r = splitRunRequest({ ...ask, params: { numOutputs: 8 } }, 2, 4);
    expect(r.params?.numOutputs).toBe(4);
    expect(r.askedOutputs).toBe(8);
  });

  it("leaves a run that isn't split as it was", () => {
    expect(splitRunRequest(ask, 1, 3)).toBe(ask);
    const one = { ...ask, params: { numOutputs: 1 } };
    expect(splitRunRequest(one, 1, 1)).toBe(one);
  });
});

describe("Reuse of one run of a split", () => {
  it("brings back the number asked for", () => {
    const run = splitRunRequest(ask, 3, 1);
    expect(reuseOutputs(run)).toBe(3);
    expect(draftFromRequest(run, IMAGE_STUDIO, getModel, getPreset).params?.numOutputs).toBe(3);
  });

  it("keeps a run's own number when it wasn't split", () => {
    expect(reuseOutputs({ params: { numOutputs: 2 } })).toBe(2);
    expect(draftFromRequest({ ...ask, params: { numOutputs: 2 } }, IMAGE_STUDIO, getModel, getPreset).params?.numOutputs).toBe(2);
  });
});
