import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";
import { composeShots, planGeneration } from "@/lib/catalog/plan";

const shots = [
  { prompt: "wide: she steps out of the taxi", duration: 3 },
  { prompt: "close-up: she looks up at the sign", duration: 4 },
];

describe("multi-shot", () => {
  it("sends Kling 3.0 native per-shot prompts with string durations, carrying the overall prompt", () => {
    const plan = planGeneration({ feature: "video", modelId: "kling-3", prompt: "Rainy Tokyo night", params: { shots } }, getModel, getPreset);
    expect(plan.params.duration).toBe(7);
    const route = getModel("kling-3")!.routes.find((r) => r.op === "t2v" && r.provider === "fal")!;
    const payload = buildPayload(route.map!, { ...plan.params, prompt: plan.prompt });
    expect(payload.multi_prompt).toEqual([
      { prompt: "Rainy Tokyo night. wide: she steps out of the taxi", duration: "3" },
      { prompt: "Rainy Tokyo night. close-up: she looks up at the sign", duration: "4" },
    ]);
    expect(payload.prompt).toBeUndefined();
    expect(payload.shot_type).toBe("customize");
    expect(payload.duration).toBe("7");
  });

  it("writes shots into the prompt for prompt-driven models (Seedance)", () => {
    const plan = planGeneration({ feature: "video", modelId: "seedance-2-5", prompt: "", params: { shots } }, getModel, getPreset);
    expect(plan.prompt).toBe("Shot 1 [0-3s]: wide: she steps out of the taxi. Shot 2 [3-7s]: close-up: she looks up at the sign.");
    expect(composeShots("Noir.", shots.slice(0, 1))).toBe("Noir. Shot 1 [0-3s]: wide: she steps out of the taxi.");
  });

  it("lets Kling cut by itself in Auto mode, and rejects models without multi-shot", () => {
    const route = getModel("kling-3")!.routes.find((r) => r.op === "t2v" && r.provider === "fal")!;
    expect(buildPayload(route.map!, { prompt: "x", multiShot: "auto" }).shot_type).toBe("intelligent");
    expect(() => planGeneration({ feature: "v", modelId: "kling-2-5-turbo", prompt: "x", params: { shots } }, getModel, getPreset)).toThrow(/multi-shot/);
    expect(() =>
      planGeneration({ feature: "v", modelId: "kling-3", prompt: "x", params: { shots: [...shots, { prompt: "y", duration: 15 }] } }, getModel, getPreset),
    ).toThrow(/add up to 22s/);
  });
});

describe("draft mode, extend and reframe", () => {
  it("drafts on Seedance 2.5 and finishes the draft by id", () => {
    const m = getModel("seedance-2-5")!;
    expect(m.options.draft).toBe(true);
    const t2v = m.routes.find((r) => r.op === "t2v" && r.provider === "fal")!;
    expect(buildPayload(t2v.map!, { prompt: "x", draft: true }).draft).toBe(true);
    const plan = planGeneration({ feature: "video", modelId: m.id, op: "finalize", params: { draftId: "d1" } }, getModel, getPreset);
    const fin = m.routes.find((r) => r.op === "finalize")!;
    expect(buildPayload(fin.map!, { ...plan.params })).toMatchObject({ draft_id: "d1" });
    expect(() => planGeneration({ feature: "video", modelId: m.id, op: "finalize" }, getModel, getPreset)).toThrow(/draft/);
  });

  it("extends Seedance through reference-to-video in extension mode", () => {
    const r = getModel("seedance-2-5")!.routes.find((x) => x.op === "extend" && x.provider === "fal")!;
    expect(buildPayload(r.map!, { prompt: "next", video: "https://v.mp4" })).toMatchObject({ task: "extension", video_urls: ["https://v.mp4"], prompt: "next" });
    expect(planGeneration({ feature: "extend", modelId: "minimax-h3-max", prompt: "next", inputs: { video: "/v.mp4" } }, getModel, getPreset).op).toBe("extend");
  });

  it("reframes with a target aspect ratio and no prompt", () => {
    const plan = planGeneration({ feature: "reframe", modelId: "ltx-reframe", inputs: { video: "/v.mp4" }, params: { aspectRatio: "9:16" } }, getModel, getPreset);
    expect(plan.op).toBe("reframe");
    const r = getModel("ltx-reframe")!.routes[0];
    expect(buildPayload(r.map!, { video: "https://v.mp4", aspectRatio: "9:16" })).toMatchObject({ video_url: "https://v.mp4", aspect_ratio: "9:16" });
  });
});
