import { describe, expect, it } from "vitest";
import { getModel, getPreset, PRESETS } from "@/lib/catalog";
import { composePrompt, estimateCost, inferOperation, missingInputs, planGeneration } from "@/lib/catalog/plan";

describe("inferOperation", () => {
  const veo = getModel("veo-3-1")!;
  it("picks the video operation from attachments", () => {
    expect(inferOperation(veo, {})).toBe("t2v");
    expect(inferOperation(veo, { inputs: { images: ["a"] } })).toBe("i2v");
    expect(inferOperation(veo, { inputs: { images: ["a"], endImage: "b" } })).toBe("flf2v");
  });
  it("switches image models to edit when an image is attached", () => {
    const nb = getModel("nano-banana-pro")!;
    expect(inferOperation(nb, {})).toBe("t2i");
    expect(inferOperation(nb, { inputs: { images: ["a"] } })).toBe("edit");
  });
});

describe("composePrompt", () => {
  it("fills prompt and option placeholders and tidies punctuation", () => {
    const preset = { options: [{ key: "style", label: "Style", choices: [{ value: "anime", label: "Anime", prompt: "an anime frame" }] }] };
    expect(composePrompt("Redraw as {option:style}. {prompt}.", "", preset, {})).toBe("Redraw as an anime frame.");
    expect(composePrompt("{prompt}. Slow dolly in", "  a cat ", null, undefined)).toBe("a cat. Slow dolly in");
  });
});

describe("planGeneration", () => {
  it("splits batches for models that can't batch", () => {
    const plan = planGeneration({ feature: "video", modelId: "kling-2-5-turbo", prompt: "x", params: { numOutputs: 3 } }, getModel, getPreset);
    expect(plan.jobs).toBe(3);
    expect(plan.perJobOutputs).toBe(1);
  });

  it("keeps native batching for image models", () => {
    const plan = planGeneration({ feature: "image", modelId: "nano-banana-pro", prompt: "x", params: { numOutputs: 4 } }, getModel, getPreset);
    expect(plan.jobs).toBe(1);
    expect(plan.params.numOutputs).toBe(4);
  });

  it("applies motion presets to any video model, LoRAs only to the preset's own model", () => {
    const preset = getPreset("motion-crash-zoom-in")!;
    const plan = planGeneration({ feature: "video", presetId: preset.id, modelId: "veo-3-1", prompt: "a man", inputs: { images: ["a"] } }, getModel, getPreset);
    expect(plan.op).toBe("i2v");
    expect(plan.prompt).toMatch(/^a man\. .*crash zoom/i);
    expect(plan.loras).toEqual([]);
  });

  it("explains missing inputs", () => {
    expect(() => planGeneration({ feature: "edit", modelId: "nano-banana-pro", op: "edit", prompt: "x" }, getModel, getPreset)).toThrow(/Add an image/);
    expect(missingInputs("lipsync", { inputs: { video: "v" } })).toMatch(/voice/);
    expect(missingInputs("i2v", { inputs: { images: ["a"] } })).toBeNull();
  });

  it("requires a prompt for text-to-X", () => {
    expect(() => planGeneration({ feature: "image", modelId: "nano-banana-pro" }, getModel, getPreset)).toThrow(/prompt/);
  });
});

describe("estimateCost", () => {
  it("prices per image, per second and free for open models", () => {
    expect(estimateCost(getModel("nano-banana-pro")!, { numOutputs: 2 })).toBeCloseTo(0.3);
    expect(estimateCost(getModel("kling-2-5-turbo")!, { duration: 10 })).toBeCloseTo(0.7);
    expect(estimateCost(getModel("oss-wan22-14b")!, {})).toBe(0);
  });
});

describe("motion mix", () => {
  const base = { feature: "motion", presetId: "motion-crash-zoom-in", prompt: "a boxer in the ring" };
  it("adds the second preset's words, worded by strength", () => {
    const strong = planGeneration({ ...base, modelId: "kling-2-5-turbo", inputs: { images: ["a.png"] }, mix: { presetId: "motion-handheld", strength: 0.9 } }, getModel, getPreset);
    expect(strong.prompt).toMatch(/^a boxer in the ring\. .+ At the same time: /);
    const faint = planGeneration({ ...base, modelId: "kling-2-5-turbo", inputs: { images: ["a.png"] }, mix: { presetId: "motion-handheld", strength: 0.2 } }, getModel, getPreset);
    expect(faint.prompt).toMatch(/With a slight hint of this: /);
    expect(() => planGeneration({ ...base, modelId: "kling-2-5-turbo", inputs: { images: ["a.png"] }, mix: { presetId: "app-relight", strength: 0.5 } }, getModel, getPreset)).toThrow(/camera motion or effect/);
  });

  it("stacks LoRAs on the open model, scaled by each strength", () => {
    const withLora = PRESETS.filter((p) => /motion|effect/.test(p.type) && p.open?.modelId === "oss-wan22-14b" && p.open.loras?.length);
    const [a, b] = withLora;
    const plan = planGeneration(
      { feature: "motion", presetId: a.id, modelId: "oss-wan22-14b", prompt: "x", inputs: { images: ["a.png"] }, presetStrength: 0.5, mix: { presetId: b.id, strength: 0.5 } },
      getModel,
      getPreset,
    );
    expect(plan.loras).toHaveLength(a.open!.loras!.length + b.open!.loras!.length);
    expect(plan.loras[0].strength).toBeCloseTo((a.open!.loras![0].strength ?? 1) * 0.5);
    expect(plan.loras.at(-1)!.strength).toBeCloseTo((b.open!.loras!.at(-1)!.strength ?? 1) * 0.5);
  });
});
