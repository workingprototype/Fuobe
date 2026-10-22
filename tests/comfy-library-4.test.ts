import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ComfyWorkflow, Manifest, ManifestOutput } from "@/lib/comfy";

// The round-4 ComfyUI library (docs/research/comfyui-oss-4.json): the 17 graphs with the bindings and outputs the
// feature packages drive, and the CausVid licence fix of wan21-vace-14b-ref2v.
const dir = path.join(process.cwd(), "workflows/comfyui");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
const byId = new Map(manifest.workflows.map((w) => [w.id, w]));
const graph = (id: string) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as ComfyWorkflow;
const subset = JSON.parse(fs.readFileSync(path.join(dir, "object_info.subset.json"), "utf8")) as Record<string, unknown>;

const VACE = ["startFrame", "frames", "width", "height", "maskGrow", "prompt", "negativePrompt", "checkpoint", "loraStrength", "shift", "seed", "steps", "cfg", "filenamePrefix"];
const ROUND4: Record<string, { capability: string; bindings: string[]; outputs: [string, string?][] }> = {
  "ocr-lines-qwen35": { capability: "ocr", bindings: ["image", "maxSize", "checkpoint", "instruction", "maxTokens", "filenamePrefix"], outputs: [["text", "lines"], ["text", "frame"]] },
  "video-inpaint-wan-vace": { capability: "remove-object", bindings: ["video", "maskPrompt", ...VACE], outputs: [["video"]] },
  "video-inpaint-wan-vace-painted": { capability: "remove-object", bindings: ["video", "mask", ...VACE], outputs: [["video"]] },
  "video-erase-void": {
    capability: "remove-object",
    bindings: ["video", "startFrame", "frames", "width", "height", "maskPrompt", "maskGrow", "prompt", "negativePrompt", "cfg", "steps", "seed", "skipPass2", "filenamePrefix"],
    outputs: [["video"]],
  },
  "video-swap-wan-vace": { capability: "video-swap", bindings: ["video", "image", "maskPrompt", ...VACE], outputs: [["video"]] },
  "video-insert-wan-vace": { capability: "video-insert", bindings: ["video", "image", "mask", ...VACE], outputs: [["video"]] },
  "kenburns-still": {
    capability: "still-motion",
    bindings: ["image", "supersample", "width", "height", "duration", "fps", "zoomStart", "zoomEnd", "panStartX", "panStartY", "panEndX", "panEndY", "easeInOut", "chunkFrames", "filenamePrefix"],
    outputs: [["video"]],
  },
  "audio-loop-crossfade": { capability: "audio-loop", bindings: ["audio", "fadeCurve", "crossfade", "duration", "headroomDb", "filenamePrefix"], outputs: [["audio"]] },
  "audio-join-crossfade": { capability: "audio-join", bindings: ["audio", "audio2", "fadeCurve", "crossfade", "filenamePrefix"], outputs: [["audio"]] },
  "video-export-pro": { capability: "export-video", bindings: ["video", "format", "profile", "filenamePrefix"], outputs: [["video"]] },
  "video-sdr-to-hdr": { capability: "sdr-to-hdr", bindings: ["video", "peakNits", "filenamePrefix"], outputs: [["video"]] },
  "video-export-exr": { capability: "export-video", bindings: ["video", "filenamePrefix"], outputs: [["image", "frames"]] },
  "still-to-clip": { capability: "still-motion", bindings: ["image", "width", "height", "duration", "fps", "filenamePrefix"], outputs: [["video"]] },
  "video-append-endcard": { capability: "concat", bindings: ["video", "image", "width", "height", "fps", "duration", "filenamePrefix"], outputs: [["video"]] },
  "scene-mesh-moge": { capability: "scene-3d", bindings: ["image", "checkpoint", "resolutionLevel", "fovX", "decimation", "filenamePrefix"], outputs: [["model3d", "scene"], ["image", "depth"]] },
  "image-to-splat-triposplat": {
    capability: "splat",
    bindings: ["image", "cutout", "numGaussians", "steps", "cfg", "seed", "splatFormat", "orbitFrames", "filenamePrefix"],
    outputs: [["model3d", "splat"], ["video", "turntable"]],
  },
  "reference-brief-gemma4": {
    capability: "write",
    bindings: ["video", "frames", "startFrame", "frameWidth", "checkpoint", "instruction", "seed", "maxTokens", "filenamePrefix"],
    outputs: [["text", "brief"]],
  },
};
/** Loaders whose input is an upload: every one must be a binding, or the graph points at a researcher's file. */
const MEDIA: Record<string, string> = { LoadImage: "image", LoadImageMask: "image", LoadVideo: "file", VHS_LoadVideo: "video", LoadAudio: "audio", VHS_LoadAudioUpload: "audio" };
const ROLES: NonNullable<ManifestOutput["role"]>[] = [
  "cues", "transcript", "language", "layers", "sheet", "tiles", "first-frame", "turntable", "lines", "frame", "frames", "scene", "depth", "splat", "brief",
];

describe("round-4 ComfyUI workflows", () => {
  it.each(Object.entries(ROUND4))("%s: validated, licensed, with the contract's bindings and outputs", (id, want) => {
    const w = byId.get(id);
    expect(w, id).toBeDefined();
    expect(w!.validated).toBe(true);
    expect(w!.license).toBeTruthy();
    expect(w!.notes?.length).toBeGreaterThan(100);
    expect(w!.capability).toBe(want.capability);
    expect(Object.keys(w!.bindings).sort()).toEqual([...want.bindings].sort());
    expect(w!.outputs.map((o) => (o.role ? [o.kind, o.role] : [o.kind]))).toEqual(want.outputs);
    for (const m of w!.models) expect(m.url && m.sizeGb, `${id} ${m.file}`).toBeTruthy();
    const g = graph(id);
    const bound = new Set(Object.values(w!.bindings).flatMap((ts) => ts!.map((t) => `${t.node}.${t.input}`)));
    for (const [nid, n] of Object.entries(g)) {
      expect(subset[n.class_type], `${id}: ${n.class_type} in object_info.subset.json`).toBeTruthy();
      if (MEDIA[n.class_type]) expect(bound.has(`${nid}.${MEDIA[n.class_type]}`), `${id} node ${nid} ${n.class_type}`).toBe(true);
    }
  });

  it("keeps the whole library validated, and every output role is a typed role", () => {
    expect(manifest.workflows.length).toBeGreaterThanOrEqual(132);
    expect(new Set(manifest.workflows.map((w) => w.id)).size).toBe(manifest.workflows.length);
    expect(manifest.workflows.filter((w) => !w.validated).map((w) => w.id)).toEqual([]);
    for (const w of manifest.workflows) for (const o of w.outputs) if (o.role) expect(ROLES, `${w.id} ${o.role}`).toContain(o.role);
  });

  it("states the limits the app plans windows and jobs with", () => {
    for (const id of ["video-inpaint-wan-vace", "video-inpaint-wan-vace-painted", "video-swap-wan-vace", "video-insert-wan-vace"]) {
      expect(byId.get(id)!.limits).toMatchObject({ maxFrames: 81, dimensionMultiple: 16 });
      expect(byId.get(id)!.defaults).toMatchObject({ frameStep: 4, checkpoint: "wan2.1_vace_14B_fp16.safetensors", steps: 4, cfg: 1, loraStrength: 1 });
    }
    expect(byId.get("video-erase-void")!.limits).toMatchObject({ maxFrames: 197 });
    expect(byId.get("kenburns-still")!.limits).toMatchObject({ maxDurationSec: 10 });
    expect(byId.get("audio-loop-crossfade")!.limits).toMatchObject({ maxDurationSec: 600 });
    expect(byId.get("reference-brief-gemma4")!.defaults).toMatchObject({ fps: 24, frameStep: 1, frames: 720 });
  });

  it("writes the TextGenerate instructions back from defaults, word for word", () => {
    expect(byId.get("ocr-lines-qwen35")!.defaults.instruction).toBe(graph("ocr-lines-qwen35")["4"].inputs.prompt);
    expect(String(byId.get("ocr-lines-qwen35")!.defaults.instruction)).toMatch(/\[0, 1000\)/);
    expect(byId.get("reference-brief-gemma4")!.defaults.instruction).toBe(graph("reference-brief-gemma4")["3"].inputs.prompt);
  });

  it("reads painted masks from the red channel (white = erase / the region), like flux1-fill-inpaint", () => {
    for (const id of ["video-inpaint-wan-vace-painted", "video-insert-wan-vace"]) {
      const g = graph(id);
      const [t] = byId.get(id)!.bindings.mask!;
      expect(g[t.node].class_type).toBe("LoadImageMask");
      expect(g[t.node].inputs.channel).toBe("red");
    }
  });

  it("Ken Burns blends linear and eased progress through easeInOut", () => {
    const g = graph("kenburns-still");
    const [ease] = byId.get("kenburns-still")!.bindings.easeInOut!;
    const progress = Object.values(g).find((n) => n.class_type === "ComfyMathExpression" && String(n.inputs.expression).includes("cos("))!;
    expect(progress.inputs["values.c"]).toEqual([ease.node, 0]);
    expect(progress.inputs.expression).toMatch(/^\(1 - c\) \* a \/ max\(b - 1, 1\) \+ c \* \(1 - cos/);
  });

  it("the audio graphs load the crossfade curve the provider writes", () => {
    for (const id of ["audio-loop-crossfade", "audio-join-crossfade"]) {
      const g = graph(id);
      const [curve] = byId.get(id)!.bindings.fadeCurve!;
      expect(g[curve.node].class_type).toBe("LoadAudio");
      expect(Object.values(g).some((n) => n.class_type === "SplitAudioChannels" && JSON.stringify(n.inputs.audio) === JSON.stringify([curve.node, 0]))).toBe(true);
    }
  });

  it("wan21-vace-14b-ref2v runs on the Apache-2.0 lightx2v LoRA, not CausVid (CC-BY-NC-4.0)", () => {
    const w = byId.get("wan21-vace-14b-ref2v")!;
    const g = graph("wan21-vace-14b-ref2v");
    expect(JSON.stringify(g)).not.toMatch(/CausVid/i);
    expect(w.models.map((m) => m.file)).toContain("lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors");
    expect(w.models.some((m) => /CausVid/i.test(m.file))).toBe(false);
    expect(w.license).toMatch(/^Apache-2.0/);
    expect(w.validated).toBe(true);
    const [lora] = w.bindings.loraStrength!;
    expect(g[lora.node].inputs).toMatchObject({ lora_name: "lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors", strength_model: 1 });
    const sampler = Object.values(g).find((n) => n.class_type === "KSampler")!;
    expect(sampler.inputs).toMatchObject({ sampler_name: "euler", steps: 4, cfg: 1 });
    expect(w.defaults).toMatchObject({ shift: 5, steps: 4, cfg: 1, loraStrength: 1 });
  });

  it("flags the licence terms people have to know about", () => {
    expect(byId.get("video-erase-void")!.license).toMatch(/CogVideoX License.*commercial use only after registering.*1 million/);
    expect(byId.get("image-to-splat-triposplat")!.license).toMatch(/Built with DINOv3/);
    for (const id of ["video-inpaint-wan-vace", "video-inpaint-wan-vace-painted", "video-swap-wan-vace", "video-insert-wan-vace"]) {
      expect(byId.get(id)!.license, id).toMatch(/KJNodes \(GPL-3.0 code\)/);
      expect(byId.get(id)!.customNodes.map((c) => c.name)).toEqual(["ComfyUI-KJNodes"]);
    }
  });
});
