import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  alphaBBox,
  applyBindings,
  asrLanguage,
  bypassReference,
  captionChunkSeconds,
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
  whisperLanguage,
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
  const windows = (wf: ComfyWorkflow) => kinds(wf, "Video Slice").map(([, n]) => [n.inputs.start_time, n.inputs.duration]);
  const linksResolve = (wf: ComfyWorkflow) => Object.values(wf).every((n) => Object.values(n.inputs).every((v) => !Array.isArray(v) || typeof v[0] !== "string" || !!wf[v[0]]));

  it("cuts the clip into gap and cue windows that tile the timeline; without a known length the last cue runs to the end", () => {
    const wf = expandCaptionWorkflow(template, [
      { start: 0.5, end: 1.5, text: "Hello" },
      { start: 1.5, end: 2.0, text: "world" },
      { start: 3.0, end: 4.0, text: "again" },
    ]);
    expect(windows(wf)).toEqual([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 1], [3, 0]]);
    expect(kinds(wf, "TextOverlay").map(([, n]) => n.inputs.text)).toEqual(["Hello", "world", "again"]);
    // style copied from the template's overlay; each captioned chunk is decoded, overlaid and encoded on its own
    for (const [, n] of kinds(wf, "TextOverlay")) expect(n.inputs).toMatchObject({ font_size: 6, position: "bottom", align: "center", outline: true });
    for (const [, n] of kinds(wf, "CreateVideo")) expect(n.inputs.codec).toBe("h264");
    expect(kinds(wf, "GetVideoComponents")).toHaveLength(3); // gaps are never decoded
    // the join keeps window order (encoded chunks and raw gaps); the soundtrack node is dropped when we don't know the clip has sound
    const join = wf["90"].inputs;
    expect(Object.keys(join).filter((k) => k.startsWith("videos."))).toEqual(["videos.video0", "videos.video1", "videos.video2", "videos.video3", "videos.video4"]);
    expect(wf[(join["videos.video0"] as [string, number])[0]].class_type).toBe("Video Slice");
    expect(wf[(join["videos.video1"] as [string, number])[0]].class_type).toBe("CreateVideo");
    expect(join.complete_audio).toBeUndefined();
    expect(kinds(wf, "LoadAudio")).toHaveLength(0);
    expect(wf["92"].inputs.video).toEqual(["90", 0]);
    expect(linksResolve(wf)).toBe(true);
  });

  it("uses what the MP4 header says: edges between frames, a gap after the last cue, cues past the end dropped, the clip's own soundtrack", () => {
    const clip = { duration: 6, fps: 30, width: 640, height: 360, hasAudio: true };
    const wf = expandCaptionWorkflow(template, [
      { start: 0, end: 1, text: "First" },
      { start: 1.2, end: 2, text: "Second" },
      { start: 7, end: 8, text: "after the end" },
    ], clip);
    const half = 0.5 / 30;
    const w = windows(wf).map(([s, d]) => [Number(s).toFixed(4), Number(d).toFixed(4)]);
    expect(w).toEqual([
      ["0.0000", (1 - half).toFixed(4)], // frames 0-29
      [(1 - half).toFixed(4), "0.2000"], // gap, frames 30-35
      [(1.2 - half).toFixed(4), "0.8000"], // frames 36-59
      [(2 - half).toFixed(4), "0.0000"], // the rest of the clip, uncaptioned
    ]);
    expect(kinds(wf, "TextOverlay").map(([, n]) => n.inputs.text)).toEqual(["First", "Second"]);
    expect(wf["90"].inputs.complete_audio).toEqual(["3", 0]);
    expect(wf["3"]).toMatchObject({ class_type: "LoadAudio" });
    expect(linksResolve(wf)).toBe(true);
    expect(() => expandCaptionWorkflow(template, [{ start: 7, end: 8, text: "late" }], clip)).toThrow(/after the end of the clip/);
  });

  it("cuts long captioned stretches into chunks sized to the frame (one chunk of raw frames in memory at a time)", () => {
    expect(captionChunkSeconds({})).toBe(1);
    expect(captionChunkSeconds({ width: 1080, height: 1920, fps: 30 })).toBeCloseTo(0.54, 2);
    expect(captionChunkSeconds({ width: 320, height: 240, fps: 8 })).toBe(5);
    const clip = { duration: 10, fps: 30, width: 1080, height: 1920, hasAudio: false };
    const wf = expandCaptionWorkflow(template, [{ start: 0, end: 4, text: "A long line" }], clip);
    const overlays = kinds(wf, "TextOverlay");
    expect(overlays.length).toBe(8); // 4 s in ~0.5 s chunks
    expect(overlays.every(([, n]) => n.inputs.text === "A long line")).toBe(true);
    // chunks tile the cue exactly, each starting half a frame before its first frame
    const w = windows(wf);
    const cue = w.slice(0, 8);
    expect(cue[0][0]).toBe(0);
    for (let i = 1; i < cue.length; i++) expect(Number(cue[i][0])).toBeCloseTo(Number(cue[i - 1][0]) + Number(cue[i - 1][1]), 6);
    for (const [s] of cue.slice(1)) {
      const frame = Number(s) * 30 + 0.5;
      expect(Math.abs(frame - Math.round(frame))).toBeLessThan(1e-4); // windows are written to the microsecond
    }
    expect(Number(cue[7][0]) + Number(cue[7][1])).toBeCloseTo(4 - 0.5 / 30, 6);
    expect(w[8]).toEqual([Number(cue[7][0]) + Number(cue[7][1]), 0]);
  });

  it("never writes a window shorter than three frames (Concatenate Video rejects a 2-frame clip followed by another)", () => {
    const clip = { duration: 3, fps: 8, width: 320, height: 240, hasAudio: true };
    const wf = expandCaptionWorkflow(template, [
      { start: 0, end: 1, text: "Hello" },
      { start: 1.2, end: 2.5, text: "Open captions" }, // 0.2 s pause = 2 frames at 8 fps: no gap window
      { start: 2.6, end: 2.65, text: "blip" }, // shorter than a frame, near the end: runs to the end
    ], clip);
    const w = windows(wf).map(([s, d]) => [Number(s), Number(d)]);
    expect(w).toEqual([[0, 0.9375], [0.9375, 1.5], [2.4375, 0]]);
    expect(kinds(wf, "TextOverlay").map(([, n]) => n.inputs.text)).toEqual(["Hello", "Open captions", "blip"]);
    // a lone very short caption in the middle is held for three frames
    const held = windows(expandCaptionWorkflow(template, [{ start: 1, end: 1.05, text: "Hi" }], { ...clip, duration: 10 })).map(([s, d]) => [Number(s), Number(d)]);
    expect(held).toEqual([[0, 0.9375], [0.9375, 0.375], [1.3125, 0]]);
  });

  it("nests joins past 100 clips and refuses an empty cue list", () => {
    const cues = Array.from({ length: 120 }, (_, i) => ({ start: i, end: i + 1, text: `cue ${i}` }));
    const wf = expandCaptionWorkflow(template, cues);
    const joins = kinds(wf, "ConcatenateVideo");
    expect(joins.length).toBe(3); // 120 clips: 100 + 20, then the top level
    expect(Object.keys(wf["90"].inputs).filter((k) => k.startsWith("videos."))).toEqual(["videos.video0", "videos.video1"]);
    expect(linksResolve(wf)).toBe(true);
    expect(() => expandCaptionWorkflow(template, [])).toThrow(/No captions/);
  });
});

describe("reference slots", () => {
  const load = (id: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), `workflows/comfyui/${id}.json`), "utf8")) as ComfyWorkflow;

  it("leaves an image out of a FLUX.2 reference chain by bypassing its ReferenceLatent pair", () => {
    const tryon = load("tryon-flux2-klein-4b");
    const wf = bypassReference(tryon, "77")!; // the bottom garment
    expect(wf).not.toBeNull();
    for (const gone of ["77", "75:181", "75:191", "75:201", "75:211"]) expect(wf[gone]).toBeUndefined();
    expect(wf["75:63"].inputs).toMatchObject({ positive: ["75:200", 0], negative: ["75:210", 0] });
    expect(wf["81"]).toBeDefined(); // the top stays
    // two left out in a row (style board with one image): the chain falls back to the first reference
    const klein = load("style-ref-flux2-klein-4b");
    const one = bypassReference(bypassReference(bypassReference(klein, "81")!, "77")!, "78")!;
    expect(one["75:63"].inputs).toMatchObject({ positive: ["75:123", 0], negative: ["75:121", 0] });
  });

  it("refuses when the image is used another way", () => {
    expect(bypassReference(load("palette-transfer-image"), "2")).toBeNull();
    expect(bypassReference(load("relight-qwen-edit-2509-reference"), "1003")).toBeNull();
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

  it("maps languages to Whisper's own names, every one of them in ComfyUI-Whisper's combo", () => {
    expect(whisperLanguage("tl")).toBe("Tagalog");
    expect(whisperLanguage("fil")).toBe("Tagalog");
    expect(whisperLanguage("Filipino")).toBe("Tagalog");
    expect(whisperLanguage("he")).toBe("Hebrew");
    expect(whisperLanguage("uk-UA")).toBe("Ukrainian");
    expect(whisperLanguage("Swahili (sw)")).toBe("Swahili");
    expect(whisperLanguage("ht")).toBe("Haitian creole");
    expect(whisperLanguage("Klingon")).toBe("auto");
    const subset = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/object_info.subset.json"), "utf8"));
    const combo = new Set<string>(subset["Apply Whisper"].input.optional.language[0]);
    for (const code of ["en", "tl", "he", "uk", "sw", "yue", "haw", "jw", "my", "ht", "nn", "zh", "pt"]) expect(combo.has(whisperLanguage(code)), code).toBe(true);
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
