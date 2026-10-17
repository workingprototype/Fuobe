import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { OPERATION_OUTPUT, type MediaKind, type Operation } from "@/lib/catalog/types";
import type { Manifest } from "@/lib/comfy";
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

/** The round-3 open models (docs/research/comfyui-oss-3.md), one or more per capability. */
const ROUND3_MODELS: Record<string, { op: Operation; kind: MediaKind; workflow: string }> = {
  "oss-qwen-layered": { op: "layers", kind: "image", workflow: "layers-qwen-image-layered" },
  "oss-qwen-layered-control": { op: "layers", kind: "image", workflow: "layers-qwen-image-layered-control" },
  "oss-style-qwen-edit": { op: "t2i", kind: "image", workflow: "style-ref-qwen-edit-2511" },
  "oss-style-flux2-klein": { op: "t2i", kind: "image", workflow: "style-ref-flux2-klein-4b" },
  "oss-style-krea2": { op: "t2i", kind: "image", workflow: "style-ref-krea2" },
  "oss-style-uso": { op: "t2i", kind: "image", workflow: "style-ref-uso-flux1" },
  "oss-zimage-palette": { op: "t2i", kind: "image", workflow: "palette-zimage-hex" },
  "oss-trim": { op: "trim", kind: "video", workflow: "video-trim" },
  "oss-segment": { op: "trim", kind: "video", workflow: "video-segment-resample" },
  "oss-wan22-vace-restyle": { op: "v2v", kind: "video", workflow: "video-restyle-wan22-fun-vace" },
  "oss-mixed-media": { op: "v2v", kind: "video", workflow: "mixed-media-zimage-frames" },
  "oss-stable-audio-3": { op: "sfx", kind: "audio", workflow: "sfx-stable-audio-3-small" },
  "oss-stable-audio-open": { op: "sfx", kind: "audio", workflow: "sfx-stable-audio-open" },
  "oss-hunyuan-foley": { op: "sfx", kind: "audio", workflow: "sfx-hunyuan-foley" },
  "oss-mmaudio-sfx": { op: "sfx", kind: "audio", workflow: "sfx-mmaudio-t2a" },
  "oss-thinksound": { op: "sfx", kind: "audio", workflow: "sfx-thinksound" },
  "oss-voice-separate": { op: "separate-audio", kind: "audio", workflow: "dub-prepare-separate-transcribe" },
  "oss-qwen3-asr": { op: "transcribe", kind: "text", workflow: "captions-qwen3-asr" },
  "oss-captions-burnin": { op: "captions", kind: "video", workflow: "captions-burnin" },
  "oss-captions-whisper": { op: "captions", kind: "video", workflow: "captions-whisper-burnin" },
  "oss-qwen35-translate": { op: "translate", kind: "text", workflow: "translate-qwen35-textgen" },
  "oss-gemma4-speech-translate": { op: "translate", kind: "text", workflow: "speech-translate-gemma4" },
  "oss-infinitetalk-v2v": { op: "lipsync", kind: "video", workflow: "lipsync-v2v-infinitetalk" },
  "oss-latentsync": { op: "lipsync", kind: "video", workflow: "lipsync-latentsync16" },
  "oss-mux": { op: "mux", kind: "video", workflow: "video-mux-audio" },
  "oss-trellis2": { op: "image-to-3d", kind: "model3d", workflow: "image-to-3d-trellis2" },
  "oss-hunyuan3d-21": { op: "image-to-3d", kind: "model3d", workflow: "image-to-3d-hunyuan3d-21" },
  "oss-tryon-klein": { op: "edit", kind: "image", workflow: "tryon-flux2-klein-4b" },
  "oss-zimage-grid": { op: "t2i", kind: "image", workflow: "grid-zimage-contact-sheet" },
  "oss-zimage-soul-cast": { op: "t2i", kind: "image", workflow: "soul-cast-sheet-zimage" },
};
const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/manifest.json"), "utf8")) as Manifest;
const workflowById = new Map(manifest.workflows.map((w) => [w.id, w]));
/** Settings the ComfyUI provider consumes itself instead of writing them into a binding. */
const PROVIDER_PARAMS = new Set(["wordsPerCaption", "paletteWeights", "cues"]);

describe("round-3 open models", () => {
  it.each(Object.entries(ROUND3_MODELS))("%s routes to its validated workflow", (id, want) => {
    const m = getModel(id);
    expect(m, id).toBeDefined();
    expect(m!.engine).toBe("open");
    expect(m!.badges).toContain("open");
    expect(m!.kind).toBe(want.kind);
    const route = m!.routes.find((r) => r.provider === "comfyui" && r.endpoint === want.workflow);
    expect(route?.op, `${id} route`).toBe(want.op);
    const wf = workflowById.get(want.workflow);
    expect(wf?.validated, want.workflow).toBe(true);
    // What the model makes is what the operation's rows say they hold (the feed and the mock provider use it).
    expect(OPERATION_OUTPUT[want.op] === m!.kind || (want.op === "t2i" && m!.kind === "image") || (want.op === "translate" && m!.kind === "text")).toBe(true);
    // Every slider or control reaches the workflow (pitfall: unknown extra keys are dropped silently).
    for (const p of [...(m!.options.sliders ?? []), ...(m!.options.controls ?? [])].map((s) => s.param)) {
      if (!PROVIDER_PARAMS.has(p)) expect(Object.keys(wf!.bindings), `${id}: ${p} is not a binding of ${want.workflow}`).toContain(p);
    }
    // Taglines tell people what the GPU and the licence ask of them.
    expect(m!.tagline, id).toMatch(/GB|CPU/);
  });

  it("flags the licences people have to know about", () => {
    expect(getModel("oss-style-uso")!.tagline).toMatch(/non-commercial/);
    expect(getModel("oss-mmaudio-sfx")!.tagline).toMatch(/non-commercial/);
    expect(getModel("oss-captions-whisper")!.tagline).toMatch(/non-commercial/);
    expect(getModel("oss-hunyuan-foley")!.tagline).toMatch(/EU, UK and South Korea/);
    expect(getModel("oss-stable-audio-3")!.tagline).toMatch(/US\$1M/);
    expect(getModel("oss-thinksound")!.hidden).toBe(true); // isolated worker only
    expect(getModel("oss-latentsync")!.hidden).toBe(true);
  });

  it("every open model's sliders and controls are bindings of its workflows", () => {
    for (const m of MODELS.filter((x) => x.engine === "open")) {
      for (const r of m.routes.filter((x) => x.provider === "comfyui")) {
        const ids = r.endpoint.includes("{n}") ? ["2", "3", "4"].map((n) => r.endpoint.replace("{n}", n)) : [r.endpoint];
        for (const wid of ids) {
          const keys = Object.keys(workflowById.get(wid)?.bindings ?? {});
          for (const p of [...(m.options.sliders ?? []), ...(m.options.controls ?? [])].map((s) => s.param)) {
            if (!PROVIDER_PARAMS.has(p) && p !== "cameraMotion") expect(keys, `${m.id} → ${wid}: ${p}`).toContain(p);
          }
        }
      }
    }
  });

  it("plans the new tools without a prompt, and asks for what's missing", () => {
    expect(planGeneration({ feature: "video", modelId: "oss-trim", inputs: { video: "/v.mp4" }, params: { startTime: 1, endTime: 3 } }, getModel, getPreset).op).toBe("trim");
    expect(() => planGeneration({ feature: "video", modelId: "oss-trim" }, getModel, getPreset)).toThrow(/video to trim/);
    expect(() => planGeneration({ feature: "video", modelId: "oss-mux", inputs: { video: "/v.mp4" } }, getModel, getPreset)).toThrow(/soundtrack/);
    expect(planGeneration({ feature: "image", modelId: "oss-qwen-layered", inputs: { images: ["/a.png"] }, params: { numLayers: 4 } }, getModel, getPreset).op).toBe("layers");
    expect(planGeneration({ feature: "captions", modelId: "oss-qwen3-asr", inputs: { video: "/v.mp4" } }, getModel, getPreset).op).toBe("transcribe");
    expect(() => planGeneration({ feature: "3d", modelId: "oss-trellis2" }, getModel, getPreset)).toThrow(/photo/);
  });

  it("runs Virtual Try-On on the try-on LoRA on the open engine", () => {
    const p = getPreset("app-virtual-try-on")!;
    expect(p.open).toMatchObject({ modelId: "oss-tryon-klein", op: "edit" });
    expect(p.parity).toMatch(/try-on LoRA/);
    const plan = planGeneration({ feature: "app", presetId: p.id, modelId: "oss-tryon-klein", inputs: { images: ["/me.png", "/dress.png"] } }, getModel, getPreset);
    expect(plan.prompt).toMatch(/^A full-body photo of a person/);
  });
});
