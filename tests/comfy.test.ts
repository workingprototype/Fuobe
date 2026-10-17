import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  alphaBBox,
  applyBindings,
  asrLanguage,
  computeDimensions,
  computeFrames,
  expandCaptionWorkflow,
  explainComfyError,
  injectLoras,
  languageName,
  paletteSentence,
  parseCueLines,
  parseHex,
  referencedModels,
  splitCueWords,
  swatchPixels,
  type ComfyWorkflow,
} from "@/lib/comfy";

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

describe("caption cues", () => {
  it("parses Qwen3-ASR cue lines, SRT and WebVTT, sorted, skipping noise", () => {
    expect(parseCueLines("1.30-2.80: Second.\n0.00-1.20: First.\nnot a cue\n2.0-1.0: backwards")).toEqual([
      { start: 0, end: 1.2, text: "First." },
      { start: 1.3, end: 2.8, text: "Second." },
    ]);
    const srt = "1\n00:00:01,500 --> 00:00:03,000\nHello\nthere\n\n2\n00:01:02,000 --> 00:01:04,250\nAgain\n";
    expect(parseCueLines(srt)).toEqual([
      { start: 1.5, end: 3, text: "Hello there" },
      { start: 62, end: 64.25, text: "Again" },
    ]);
    expect(parseCueLines("WEBVTT\n\n00:00.500 --> 00:02.000\nVTT line")).toEqual([{ start: 0.5, end: 2, text: "VTT line" }]);
    expect(parseCueLines(undefined)).toEqual([]);
  });

  it("splits long cues into a few words at a time, timed by length", () => {
    const out = splitCueWords([{ start: 0, end: 4, text: "one two three four five" }], 2);
    expect(out.map((c) => c.text)).toEqual(["one two", "three four", "five"]);
    expect(out[0].start).toBe(0);
    expect(out.at(-1)!.end).toBe(4);
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBe(out[i - 1].end);
    expect(splitCueWords([{ start: 0, end: 1, text: "short" }], 0)).toEqual([{ start: 0, end: 1, text: "short" }]);
  });
});

describe("caption burn-in graph", () => {
  const template = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/captions-burnin.json"), "utf8")) as ComfyWorkflow;
  const kinds = (wf: ComfyWorkflow, t: string) => Object.entries(wf).filter(([, n]) => n.class_type === t);

  it("cuts the clip into gap and cue segments that tile the timeline; the last cue runs to the end", () => {
    const wf = expandCaptionWorkflow(template, [
      { start: 0.5, end: 1.5, text: "Hello" },
      { start: 1.5, end: 2.0, text: "world" },
      { start: 3.0, end: 4.0, text: "again" },
    ]);
    const slices = kinds(wf, "Video Slice").map(([, n]) => [n.inputs.start_time, n.inputs.duration]);
    expect(slices).toEqual([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 1], [3, 0]]);
    expect(kinds(wf, "TextOverlay").map(([, n]) => n.inputs.text)).toEqual(["Hello", "world", "again"]);
    // style copied from the template's overlay; frames come from each segment
    for (const [, n] of kinds(wf, "TextOverlay")) expect(n.inputs).toMatchObject({ font_size: 6, position: "bottom", align: "center", outline: true });
    // the batch keeps segment order, CreateVideo / SaveVideo are untouched
    const batch = wf["90"];
    expect(Object.keys(batch.inputs)).toEqual(["images.image0", "images.image1", "images.image2", "images.image3", "images.image4"]);
    expect(wf["91"].inputs).toMatchObject({ images: ["90", 0], fps: ["2", 2], audio: ["2", 1] });
    expect(Object.values(wf).every((n) => Object.values(n.inputs).every((v) => !Array.isArray(v) || !!wf[v[0] as string]))).toBe(true);
  });

  it("nests batches past 50 segments and refuses an empty cue list", () => {
    const cues = Array.from({ length: 60 }, (_, i) => ({ start: i, end: i + 1, text: `cue ${i}` }));
    const wf = expandCaptionWorkflow(template, cues);
    const batches = kinds(wf, "BatchImagesNode");
    expect(batches.length).toBe(3); // 60 segments: 50 + 10, then the top level
    expect(Object.keys(wf["90"].inputs)).toEqual(["images.image0", "images.image1"]);
    expect(() => expandCaptionWorkflow(template, [])).toThrow(/No captions/);
  });
});

describe("languages, palettes, layers", () => {
  it("maps languages to the ASR list and to instruction words", () => {
    expect(asrLanguage("de")).toBe("German");
    expect(asrLanguage("German (de)")).toBe("German");
    expect(asrLanguage("pt-BR")).toBe("Portuguese");
    expect(asrLanguage("english")).toBe("English");
    expect(asrLanguage("Klingon")).toBe("auto");
    expect(asrLanguage(undefined)).toBe("auto");
    expect(languageName("Japanese (ja)")).toBe("Japanese");
    expect(languageName("he")).toBe("Hebrew");
    expect(languageName("Klingon")).toBe("Klingon");
  });

  it("writes the palette sentence and a banded swatch", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("nope")).toBeNull();
    expect(paletteSentence(["#e4572e", "29335c", "teal"])).toBe("Color palette: #E4572E, #29335C.");
    const px = swatchPixels(["#ff0000", "#0000ff"], 4, 2);
    const at = (x: number, y: number) => Array.from(px.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect([at(0, 0), at(1, 1), at(2, 0), at(3, 1)]).toEqual([[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]]);
    const weighted = swatchPixels(["#ff0000", "#0000ff"], 4, 1, [3, 1]);
    expect(Array.from(weighted.slice(8, 12))).toEqual([255, 0, 0, 255]);
    expect(() => swatchPixels(["x"])).toThrow(/No valid hex/);
  });

  it("finds a layer's bounding box from alpha", () => {
    const w = 5;
    const h = 4;
    const rgba = new Uint8Array(w * h * 4);
    for (const [x, y] of [[1, 1], [3, 2]]) rgba[(y * w + x) * 4 + 3] = 255;
    expect(alphaBBox(rgba, w, h)).toEqual([1, 1, 3, 2]);
    expect(alphaBBox(new Uint8Array(w * h * 4), w, h)).toBeNull();
  });
});
