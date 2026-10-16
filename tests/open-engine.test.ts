import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { planGeneration } from "@/lib/catalog/plan";
import { applySketch, stripMotionPaths } from "@/lib/catalog/sketch";
import { resample, tracksFor } from "@/lib/motion-paths";

describe("motion paths (Wan-Move draw to video)", () => {
  it("resamples a path to evenly spaced points, one per frame", () => {
    const pts = resample([[0, 0], [1, 0], [1, 1]], 5);
    expect(pts.map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))])).toEqual([[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1]]);
  });

  it("scales normalised paths to the workflow's pixel grid", () => {
    const t = tracksFor({ aspect: [16, 9], paths: [[[0, 0], [1, 1]]] }, 833, 481, 3);
    expect(t).toEqual([[{ x: 0, y: 0 }, { x: 416, y: 240 }, { x: 832, y: 480 }]]);
  });

  it("keeps the clean start frame for Wan-Move and drops paths for other models", () => {
    const req = { feature: "video", prompt: "the boat sails off", inputs: { images: ["/a.png"], sketch: "/drawn.png" }, params: { extra: { motionPaths: { aspect: [1, 1], paths: [[[0, 0], [1, 1]]] } } } };
    const wm = getModel("oss-wan-move")!;
    const r = applySketch({ ...req, modelId: wm.id }, wm).request;
    expect(r.inputs?.images).toEqual(["/a.png"]);
    expect(r.prompt).toBe("the boat sails off");
    expect(planGeneration(r, getModel, getPreset).op).toBe("i2v");
    const kling = getModel("kling-2-5-turbo")!;
    expect(stripMotionPaths({ ...req, modelId: kling.id }, kling).params?.extra).toEqual({});
    expect(() => planGeneration({ feature: "video", modelId: wm.id, prompt: "x", inputs: { images: ["/a.png"] } }, getModel, getPreset)).toThrow(/Draw on the start frame/);
  });
});

describe("open-source voice", () => {
  it("needs a sample per speaker for Chatterbox dialogue", () => {
    const req = { feature: "audio", modelId: "oss-chatterbox-dialogue", params: { dialogue: [{ text: "Hi", voice: "A" }] } };
    expect(() => planGeneration(req, getModel, getPreset)).toThrow(/each speaker/);
    expect(planGeneration({ ...req, inputs: { voiceAudio: "/a.wav", voiceAudio2: "/b.wav" } }, getModel, getPreset).op).toBe("dialogue");
  });
  it("routes the relight app to the Relight LoRA workflow on the open engine", () => {
    expect(getPreset("app-relight")?.open?.modelId).toBe("oss-qwen-relight");
  });
});
