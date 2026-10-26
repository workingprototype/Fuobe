import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ComfyWorkflow } from "@/lib/comfy";
import type { GenerationRequest, GenInput, ModelDef, ModelRoute } from "@/lib/catalog/types";

// Fuobe DoP as a run (build plan O4): one model on both engines for the camera motions and effects, the cloud payload
// from the research's FieldMaps (49 or 81 frames at 16 fps, interpolation off), Mix on both engines, the LTX-2.3 graphs
// with LoRAs, the Fun Camera pose, the relight step and the grade the browser applies.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-dop-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { createGenerations, previewGeneration } = await import("@/server/generations");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { falProvider } = await import("@/server/providers/fal");
const { getModel, getPreset, modelsFor } = await import("@/lib/catalog");
const { onEngine } = await import("@/lib/catalog/engines");
const { estimateCost, planGeneration, routesFor } = await import("@/lib/catalog/plan");
const { presetModel, prestepCost } = await import("@/lib/composer");
const { gradeOf, nextSteps } = await import("@/lib/output-actions");
const { lorasFit } = await import("@/lib/catalog/loras");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const view = (id: string, engine: "open" | "cloud") => onEngine(getModel(id)!, engine);
const plan = (engine: "open" | "cloud", req: Partial<GenerationRequest> & { presetId?: string }, modelId = presetModel(getPreset(req.presetId ?? "")!, engine) ?? "fuobe-dop") => {
  const m = view(modelId, engine);
  return planGeneration({ feature: "motion", modelId: m.id, prompt: "a woman in a red coat on a bridge", inputs: { images: ["/a.png"] }, ...req }, (id) => (id === m.id ? m : getModel(id)), getPreset);
};
const falRoute = (m: ModelDef, op = "i2v") => m.routes.find((r) => r.provider === "fal" && r.op === op)!;

/** Submit through the fal adapter and return the URL and JSON body it posted. */
async function submit(model: ModelDef, route: ModelRoute, input: GenInput): Promise<{ url: string; body: Record<string, unknown> }> {
  const real = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
    return new Response(JSON.stringify({ request_id: "r1", status_url: "s", response_url: "r", cancel_url: "c" }), { status: 200 });
  }) as typeof fetch;
  try {
    await falProvider.submit({ generationId: "g", model, route, input });
  } finally {
    globalThis.fetch = real;
  }
  return seen!;
}

const ctx = (media: (n: unknown) => unknown = () => undefined) => ({
  generationId: "g",
  op: "i2v" as const,
  upload: async (_d: Buffer, _t: string, name: string) => `up_${name}`,
  media: media as never,
  serverRam: async () => undefined,
});

describe("Fuobe DoP on both engines", () => {
  it("is one model with ComfyUI routes and hosted open-weight routes, 480p on the GPU and 720p in the cloud", () => {
    const m = getModel("fuobe-dop")!;
    expect(m.engines).toEqual(["open", "cloud"]);
    expect(view("fuobe-dop", "open").routes.map((r) => [r.op, r.endpoint])).toEqual([["i2v", "wan22-i2v-14b"], ["flf2v", "wan22-flf2v-14b"], ["keyframes", "wan22-flf2v-14b"]]);
    expect(new Set(view("fuobe-dop", "cloud").routes.map((r) => r.provider))).toEqual(new Set(["fal", "replicate"]));
    expect(view("fuobe-dop", "open").defaults).toMatchObject({ resolution: "480p", duration: 5, aspectRatio: "auto" });
    expect(view("fuobe-dop", "cloud").defaults).toMatchObject({ resolution: "720p", duration: 5 });
    expect(view("fuobe-dop-ltx", "open").routes.map((r) => [r.op, r.endpoint])).toEqual([["i2v", "ltx23-i2v-lora"], ["flf2v", "ltx23-flf2v-lora"]]);
    for (const engine of ["open", "cloud"] as const) expect(modelsFor({ kind: "video", engine }).some((x) => x.id === "fuobe-dop")).toBe(true);
  });

  it("asks for a start frame", () => {
    expect(() => plan("open", { inputs: undefined, prompt: "a slow push in" })).toThrow(/start frame/);
  });

  it("sends 49 or 81 frames at 16 fps with interpolation off and 20 steps, each LoRA on its expert", async () => {
    const m = view("fuobe-dop", "cloud");
    const p = plan("cloud", { presetId: "motion-overhead" });
    expect(p.loras.map((l) => l.target)).toEqual(["high", "low"]);
    const loras = p.loras.map((l) => ({ ...l, hostedUrl: `https://v3.fal.media/files/${l.version}.safetensors` }));
    for (const [duration, frames] of [[5, 81], [3, 49]] as const) {
      const { url, body } = await submit(m, falRoute(m), { ...p.params, duration, prompt: p.prompt, images: ["https://fal.media/a.png"], loras });
      expect(url).toContain("fal-ai/wan/v2.2-a14b/image-to-video/lora");
      expect(body).toMatchObject({ num_frames: frames, frames_per_second: 16, interpolator_model: "none", num_inference_steps: 20, resolution: "720p" });
      expect((body.loras as { transformer: string }[]).map((l) => l.transformer)).toEqual(["high", "low"]);
    }
    // Without a LoRA (a move on its words) the plain endpoint, at the same frame rate.
    const words = plan("cloud", { presetId: "motion-whip-pan" });
    const plain = await submit(m, falRoute(m), { ...words.params, prompt: words.prompt, images: ["https://fal.media/a.png"] });
    expect(plain.url).toMatch(/fal-ai\/wan\/v2\.2-a14b\/image-to-video$/);
    expect(plain.body).toMatchObject({ num_frames: 81, frames_per_second: 16, interpolator_model: "none" });
  });

  it("prices the clip: free on the GPU, the LoRA endpoint's $0.10/s in the cloud", () => {
    const p = plan("cloud", { presetId: "motion-overhead" });
    expect(estimateCost(view("fuobe-dop", "cloud"), p.params, 1, "i2v", true)).toBeCloseTo(0.5);
    expect(estimateCost(view("fuobe-dop", "cloud"), { ...p.params, duration: 3 }, 1, "i2v", true)).toBeCloseTo(0.3);
    expect(estimateCost(view("fuobe-dop", "open"), p.params, 1, "i2v")).toBe(0);
  });
});

describe("Mix on both engines", () => {
  it("sends both presets' LoRAs, each scaled by its strength, with the second one's trigger", () => {
    for (const engine of ["open", "cloud"] as const) {
      const p = plan(engine, { presetId: "motion-overhead", presetStrength: 0.8, mix: { presetId: "effect-building-explosion", strength: 0.5 } });
      expect(p.loras.map((l) => l.strength)).toEqual([0.8, 0.8, 0.5, 0.5]);
      expect(p.loras.slice(2).every((l) => /explosion-redmond/.test(l.file))).toBe(true);
      expect(p.prompt).toMatch(/Also, more subtly: explosion, /);
    }
    // Two Wan 2.2 pairs fit fal's list, not Replicate's one LoRA per expert: the run goes to fal.
    const both = plan("cloud", { presetId: "motion-overhead", mix: { presetId: "effect-building-explosion", strength: 0.5 } });
    const m = view("fuobe-dop", "cloud");
    expect(lorasFit(falRoute(m), both.loras)).toBe(true);
    expect(lorasFit(m.routes.find((r) => r.provider === "replicate")!, both.loras)).toBe(false);
  });

  it("joins a preset whose LoRA is for another base as words, and says so", () => {
    const p = plan("open", { presetId: "motion-overhead", mix: { presetId: "motion-fpv-drone", strength: 0.9 } });
    expect(p.loras).toHaveLength(2);
    expect(p.notes?.join(" ")).toMatch(/FPV Drone's LoRA runs on LTX-2\.3, so it joins this mix as words only/);
    expect(p.prompt).toMatch(/At the same time: /);
  });

  it("gives a partner model the words without the LoRA's trigger", () => {
    const kling = planGeneration({ feature: "motion", modelId: "kling-2-5-turbo", presetId: "effect-thunder-god", prompt: "a knight", inputs: { images: ["/a.png"] } }, getModel, getPreset);
    expect(kling.loras).toEqual([]);
    expect(kling.prompt.startsWith("a knight. ")).toBe(true);
    expect(plan("open", { presetId: "effect-thunder-god", prompt: "a knight" }).prompt.startsWith("Thunder Hero. a knight. ")).toBe(true);
  });
});

describe("Fuobe DoP · LTX", () => {
  it("runs a camera LoRA alone on the plain LTX-2.3 endpoint, its strength on camera_lora_scale, silent and unexpanded", async () => {
    const m = view("fuobe-dop-ltx", "cloud");
    const p = plan("cloud", { presetId: "motion-jib-up", presetStrength: 0.6 });
    expect(p.model.id).toBe("fuobe-dop-ltx");
    expect(p.loras).toEqual([]);
    const { url, body } = await submit(m, falRoute(m), { ...p.params, ...p.params.extra, prompt: p.prompt, images: ["https://fal.media/a.png"] } as GenInput);
    expect(url).toMatch(/fal-ai\/ltx-2\.3-22b\/image-to-video$/);
    expect(body).toMatchObject({ camera_lora: "jib_up", camera_lora_scale: 0.6, enable_prompt_expansion: false, generate_audio: false, num_frames: 121 });
  });

  it("sends a transition's LoRA with both frames to the LTX-2.3 LoRA endpoint", async () => {
    const m = view("fuobe-dop-ltx", "cloud");
    const p = plan("cloud", { presetId: "effect-melt-transition", inputs: { images: ["/a.png"], endImage: "/b.png" } });
    expect(p.op).toBe("flf2v");
    const { url, body } = await submit(m, falRoute(m, "flf2v"), { ...p.params, prompt: p.prompt, images: ["https://fal.media/a.png"], endImage: "https://fal.media/b.png", loras: p.loras });
    expect(url).toContain("fal-ai/ltx-2.3-22b/image-to-video/lora");
    expect(body).toMatchObject({ image_url: "https://fal.media/a.png", end_image_url: "https://fal.media/b.png" });
    expect((body.loras as { path: string }[])[0].path).toMatch(/ltx2\.3-transition\.safetensors$/);
    expect(p.prompt.startsWith("zhuanchang. ")).toBe(true);
  });

  it("injects the LoRAs after the LTX-2.3 checkpoint and sizes the clip from the start frame on the GPU", async () => {
    const p = plan("open", { presetId: "motion-fpv-drone", params: { aspectRatio: "auto", duration: 5 } });
    const { workflow } = await prepareWorkflow(
      "ltx23-i2v-lora",
      { ...p.params, prompt: p.prompt, images: ["up_a.png"], loras: p.loras, seed: 3 },
      ctx((n) => (n === "up_a.png" ? { container: "image", width: 1080, height: 1920, hasVideo: false, hasAudio: false } : undefined)),
    );
    const wf = workflow as ComfyWorkflow;
    const lora = Object.entries(wf).find(([, n]) => n.class_type === "LoraLoaderModelOnly")!;
    expect(lora[1].inputs.lora_name).toBe(p.loras[0].file);
    const ckpt = Object.entries(wf).find(([, n]) => n.class_type === "CheckpointLoaderSimple")![0];
    expect(lora[1].inputs.model).toEqual([ckpt, 0]);
    // The guider samples with the LoRA's model, not the bare checkpoint.
    expect(Object.values(wf).find((n) => n.class_type === "CFGGuider")!.inputs.model).toEqual([lora[0], 0]);
    expect(wf["130"].inputs.value).toBe(121);
    expect(wf["114"].inputs.value).toBe(24);
    const [w, h] = [wf["113"].inputs.value as number, wf["98"].inputs.value as number];
    expect(w % 32).toBe(0);
    expect(h % 32).toBe(0);
    expect(h).toBeGreaterThan(w);
    expect(wf["31"].inputs.image).toBe("up_a.png");
  });
});

describe("Fuobe DoP on the GPU", () => {
  it("runs a Fun Camera pose on its graph, a LoRA mixed in on its experts", async () => {
    const p = plan("open", { presetId: "motion-zoom", mix: { presetId: "effect-building-explosion", strength: 0.7 } });
    expect(routesFor(p.model, "i2v")[0].endpoint).toBe("wan22-i2v-14b");
    expect(p.params.extra).toEqual({ cameraMotion: "Zoom In" });
    const { manifest, workflow } = await prepareWorkflow("wan22-i2v-14b", { ...p.params, prompt: p.prompt, images: ["up_a.png"], loras: p.loras, seed: 1 }, ctx());
    expect(manifest.id).toBe("wan22-fun-camera-14b");
    const wf = workflow as ComfyWorkflow;
    expect(Object.values(wf).find((n) => n.class_type === "WanCameraEmbedding")!.inputs.camera_pose).toBe("Zoom In");
    const loras = Object.values(wf).filter((n) => n.class_type === "LoraLoaderModelOnly").map((n) => n.inputs.lora_name);
    expect(loras.sort()).toEqual(p.loras.map((l) => l.file).sort());
    // Without a pose the plain image-to-video graph.
    const plain = await prepareWorkflow("wan22-i2v-14b", { prompt: "x", images: ["up_a.png"], duration: 3, resolution: "480p", aspectRatio: "16:9" }, ctx());
    expect(plain.manifest.id).toBe("wan22-i2v-14b");
  });

  it("runs an LTX-2.5 LoRA on the open LTX-2.5 graph, and its words in the cloud", () => {
    expect(plan("open", { presetId: "motion-slow-motion" }).model.id).toBe("oss-ltx25");
    const cloud = plan("cloud", { presetId: "motion-slow-motion" });
    expect(cloud.model.id).toBe("fuobe-dop");
    expect(cloud.loras).toEqual([]);
  });
});

describe("effects as steps", () => {
  it("grades a colour-grade effect in the browser: the clip carries the grade, its next step applies it", () => {
    const p = plan("cloud", { presetId: "effect-candy-pink" });
    expect(p.dop).toEqual({ grade: "candy-pink" });
    expect(p.loras).toEqual([]);
    // A partner model runs the words, nothing to grade.
    expect(planGeneration({ feature: "motion", modelId: "kling-2-5-turbo", presetId: "effect-candy-pink", prompt: "x", inputs: { images: ["/a.png"] } }, getModel, getPreset).dop).toBeUndefined();
    const g = {
      id: "gen123",
      status: "succeeded",
      prompt: "a woman on a bridge",
      modelId: "fuobe-dop",
      op: "i2v",
      request: { feature: "motion", modelId: "fuobe-dop", presetId: "effect-candy-pink" },
      outputs: [{ url: "/api/files/outputs/c.mp4", kind: "video", meta: { grade: "candy-pink" } }],
    } as never;
    expect(gradeOf({ kind: "video", meta: { grade: "candy-pink" } })).toEqual({ id: "candy-pink", name: "Candy Pink" });
    expect(nextSteps(g, 0)[0]).toMatchObject({ id: "grade", label: "Apply the Candy Pink grade", href: "/color-grade?video=%2Fapi%2Ffiles%2Foutputs%2Fc.mp4&preset=candy-pink" });
  });

  it("relights the start frame first, then animates the relit picture, on the engine asked for", () => {
    const req = { feature: "motion", modelId: "fuobe-dop", presetId: "effect-window", prompt: "a woman reading", inputs: { images: ["/api/files/uploads/a.png"] } };
    for (const engine of ["open", "cloud"] as const) {
      const [clip, relit] = createGenerations({ ...req, engine });
      expect(relit.modelId).toBe(engine === "open" ? "oss-qwen-relight" : "qwen-image-edit-2509-cloud");
      expect(relit.op).toBe("edit");
      expect(clip.modelId).toBe("fuobe-dop");
      expect(clip.engine).toBe(engine);
      expect(clip.request.chain).toEqual([{ slot: "images", position: "first" }]);
      expect(clip.request.inputs?.images).toBeUndefined();
      if (engine === "cloud") expect(relit.request.loras?.map((l) => l.file)).toEqual(["Qwen-Image-Edit-2509-Relight.safetensors"]);
    }
    // The price says so before the run: about $0.04 in the cloud, free on the GPU.
    const window = getPreset("effect-window")!;
    expect(prestepCost(window, "fuobe-dop", "cloud")).toBeCloseTo(0.035);
    expect(prestepCost(window, "fuobe-dop", "open")).toBe(0);
    expect(prestepCost(window, "kling-2-5-turbo", "cloud")).toBe(0);
    // On a partner model the effect is its words: no relight step.
    expect(createGenerations({ ...req, modelId: "kling-2-5-turbo" })).toHaveLength(1);
  });

  it("previews a DoP motion on the engine asked for, free on the GPU", () => {
    const open = previewGeneration({ feature: "motion", modelId: "fuobe-dop", presetId: "motion-overhead", prompt: "x", inputs: { images: ["/a.png"] }, engine: "open" });
    expect(open).toMatchObject({ engine: "open", costUsd: 0, route: { provider: "comfyui", endpoint: "wan22-i2v-14b" } });
    expect(open.loras.applied.map((l) => l.file)).toHaveLength(2);
  });
});
