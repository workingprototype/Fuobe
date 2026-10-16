import { describe, expect, it } from "vitest";
import { applyBindings, computeDimensions, computeFrames, explainComfyError, injectLoras, referencedModels, type ComfyWorkflow } from "@/lib/comfy";

const wan: ComfyWorkflow = {
  "1": { class_type: "UNETLoader", inputs: { unet_name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", weight_dtype: "default" } },
  "2": { class_type: "UNETLoader", inputs: { unet_name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", weight_dtype: "default" } },
  "3": { class_type: "ModelSamplingSD3", inputs: { model: ["1", 0], shift: 8 } },
  "4": { class_type: "ModelSamplingSD3", inputs: { model: ["2", 0], shift: 8 } },
  "5": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["9", 0] } },
};

describe("applyBindings", () => {
  it("writes values to every bound node and reports missing nodes", () => {
    const { workflow, missing } = applyBindings(wan, { prompt: [{ node: "5", input: "text" }], shift: [{ node: "3", input: "shift" }, { node: "4", input: "shift" }, { node: "99", input: "shift" }] }, { prompt: "hi", shift: 5 });
    expect(workflow["5"].inputs.text).toBe("hi");
    expect(workflow["3"].inputs.shift).toBe(5);
    expect(workflow["4"].inputs.shift).toBe(5);
    expect(missing).toEqual(["shift → node 99"]);
    expect(wan["5"].inputs.text).toBe(""); // input untouched
  });
});

describe("injectLoras", () => {
  it("chains LoRAs after each Wan expert and rewires consumers", () => {
    const out = injectLoras(wan, [
      { file: "orbit_high.safetensors", target: "high", strength: 1 },
      { file: "orbit_low.safetensors", target: "low", strength: 0.8 },
    ]);
    const loras = Object.entries(out).filter(([, n]) => n.class_type === "LoraLoaderModelOnly");
    expect(loras).toHaveLength(2);
    const high = loras.find(([, n]) => n.inputs.lora_name === "orbit_high.safetensors")!;
    expect(high[1].inputs.model).toEqual(["1", 0]);
    expect(out["3"].inputs.model).toEqual([high[0], 0]);
    const low = loras.find(([, n]) => n.inputs.lora_name === "orbit_low.safetensors")!;
    expect(out["4"].inputs.model).toEqual([low[0], 0]);
    expect(low[1].inputs.strength_model).toBe(0.8);
  });

  it("applies untargeted LoRAs to both experts", () => {
    const out = injectLoras(wan, [{ file: "fx.safetensors" }]);
    expect(Object.values(out).filter((n) => n.class_type === "LoraLoaderModelOnly")).toHaveLength(2);
  });
});

describe("sizes", () => {
  it("keeps the pixel budget across aspect ratios", () => {
    expect(computeDimensions("1:1", undefined, { width: 1024, height: 1024 })).toEqual({ width: 1024, height: 1024 });
    const wide = computeDimensions("16:9", undefined, { width: 1024, height: 1024 });
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
    expect(wide.width % 16).toBe(0);
  });
  it("uses short-side tiers for video", () => {
    expect(computeDimensions("16:9", "480p", { width: 1280, height: 720 })).toEqual({ width: 848, height: 480 });
    expect(computeDimensions("9:16", "720p", { width: 1280, height: 720 })).toEqual({ width: 720, height: 1280 });
  });
  it("computes 4n+1 frame counts", () => {
    expect(computeFrames(5, 16)).toBe(81);
    expect(computeFrames(5, 24, 8)).toBe(121);
    expect(computeFrames(10, 16, 4, 81)).toBe(81);
  });
});

describe("helpers", () => {
  it("lists referenced model files", () => {
    expect(referencedModels(wan).sort()).toEqual(["wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"]);
  });
  it("turns missing-model errors into download hints", () => {
    const msg = explainComfyError(
      { "1": { class_type: "UNETLoader", errors: [{ message: "Value not in list", extra_info: { input_name: "unet_name", received_value: "x.safetensors" } }] } },
      { id: "w", title: "", capability: "i2v", file: "", source: "", bindings: {}, outputs: [], defaults: {}, models: [{ file: "x.safetensors", folder: "diffusion_models", url: "https://hf/x" }], customNodes: [], validated: true },
    );
    expect(msg).toContain("models/diffusion_models");
    expect(msg).toContain("https://hf/x");
  });
});
