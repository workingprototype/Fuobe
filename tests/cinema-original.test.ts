import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ComfyWorkflow } from "@/lib/comfy";
import type { GenInput, LoraRef, ModelDef, ModelRoute } from "@/lib/catalog/types";

// Fuobe Cinema as a run (build plan O6): one model on both engines. In the cloud the payload fal receives (LTX-2.3 22B,
// prompt expansion off, camera_lora, exact sizes, frames at 24 fps, the plain endpoint unless a LoRA rides along) and its
// price; on the user's GPU the Wan 2.2 Lightning graphs, a Fun Camera pose on its graph and a camera LoRA injected.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-cinema-original-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { previewGeneration } = await import("@/server/generations");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { falProvider } = await import("@/server/providers/fal");
const { getModel, modelsFor } = await import("@/lib/catalog");
const { onEngine } = await import("@/lib/catalog/engines");
const { estimateCost } = await import("@/lib/catalog/plan");
const { planCinema, CINEMA_MODEL, ORIGINAL_LINES, modelLine } = await import("@/lib/catalog/cinema");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const view = (engine: "open" | "cloud") => onEngine(getModel(CINEMA_MODEL)!, engine);
const fal = (op: string) => view("cloud").routes.find((r) => r.provider === "fal" && r.op === op)!;

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

const ctx = () => ({
  generationId: "g",
  op: "i2v" as const,
  upload: async (_d: Buffer, _t: string, name: string) => `up_${name}`,
  media: (() => undefined) as never,
  serverRam: async () => undefined,
});

const LTX_LORA: LoraRef = {
  file: "my-ltx-style.safetensors",
  url: "https://huggingface.co/someone/ltx-style/resolve/main/my-ltx-style.safetensors",
  strength: 0.8,
  licence: { commercial: true, hostedOk: true, snapshotDate: "2026-10-26" },
};

describe("Fuobe Cinema on both engines", () => {
  it("is one model: Wan 2.2 Lightning on the GPU, LTX-2.3 on fal, listed for video on both engines", () => {
    const m = getModel(CINEMA_MODEL)!;
    expect(m.engines).toEqual(["open", "cloud"]);
    expect(view("open").routes.map((r) => [r.op, r.endpoint])).toEqual([
      ["t2v", "wan22-t2v-14b-lightx2v"],
      ["i2v", "wan22-i2v-14b-lightx2v"],
      ["flf2v", "wan22-flf2v-14b"],
    ]);
    expect(view("cloud").routes.map((r) => [r.op, r.endpoint, r.loraEndpoint])).toEqual([
      ["t2v", "fal-ai/ltx-2.3-22b/text-to-video", "fal-ai/ltx-2.3-22b/text-to-video/lora"],
      ["i2v", "fal-ai/ltx-2.3-22b/image-to-video", "fal-ai/ltx-2.3-22b/image-to-video/lora"],
      ["flf2v", "fal-ai/ltx-2.3-22b/image-to-video", "fal-ai/ltx-2.3-22b/image-to-video/lora"],
      ["extend", "fal-ai/ltx-2.3-22b/extend-video", "fal-ai/ltx-2.3-22b/extend-video/lora"],
      ["v2v", "fal-ai/ltx-2.3-22b/video-to-video", "fal-ai/ltx-2.3-22b/video-to-video/lora"],
    ]);
    expect(view("open").options).toMatchObject({ durations: [3, 5], resolutions: ["480p", "720p"], audio: false, multiShot: { mode: "concat" } });
    expect(view("cloud").options).toMatchObject({ resolutions: ["480p", "720p", "1080p"], audio: true });
    expect(view("cloud").options.durations).toContain(20);
    expect(view("open").defaults).toMatchObject({ resolution: "480p", duration: 5 });
    expect(view("cloud").defaults).toMatchObject({ resolution: "720p", duration: 5, aspectRatio: "16:9", generateAudio: true });
    for (const engine of ["open", "cloud"] as const) expect(modelsFor({ kind: "video", engine }).some((x) => x.id === CINEMA_MODEL)).toBe(true);
    expect(modelLine(view("open"), "open")).toBe(ORIGINAL_LINES[CINEMA_MODEL].open);
    expect(modelLine(getModel("kling-3")!, "cloud")).toBe(getModel("kling-3")!.tagline);
  });

  it("prices a second of video from fal's per-megapixel price, by resolution and with LoRAs; free on the GPU", () => {
    const cloud = view("cloud");
    expect(estimateCost(cloud, { duration: 5, resolution: "720p" })).toBeCloseTo(5 * 0.0347, 3);
    expect(estimateCost(cloud, { duration: 5, resolution: "480p" })).toBeCloseTo(5 * 0.016, 3);
    expect(estimateCost(cloud, { duration: 5, resolution: "1080p" })).toBeCloseTo(5 * 0.0805, 2);
    expect(estimateCost(cloud, { duration: 5, resolution: "720p" }, 1, "t2v", true)).toBeCloseTo(5 * 0.039, 3);
    expect(estimateCost(cloud, { duration: 5, resolution: "1080p" }, 1, "t2v", true)).toBeCloseTo(5 * 0.0905, 2);
    // 1280 × 704 × 24 frames per second at $0.001605 per megapixel.
    expect(cloud.pricing!.byResolution!["720p"]).toBeCloseTo((1280 * 704 * 24 * 0.001605) / 1e6, 4);
    expect(estimateCost(view("open"), { duration: 5 })).toBe(0);
  });

  it("sends fal the plain LTX-2.3 endpoint with camera_lora, prompt expansion off and the tier's exact size", async () => {
    const plan = planCinema({ engine: "cloud", mode: "video", action: "generate", prompt: "a lighthouse at dusk", moves: ["truck-left"], settings: {}, images: ["/api/files/a.png"], duration: 8, resolution: "720p", aspectRatio: "9:16" }, { cloudAllowed: true });
    const req = plan.steps[0].request;
    expect(req.params!.extra).toEqual({ camera_lora: "dolly_left" });
    const { url, body } = await submit(view("cloud"), fal("i2v"), { ...req.params, prompt: req.prompt, images: ["https://x/a.png"] });
    expect(url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/image-to-video$/);
    expect(body).toMatchObject({
      image_url: "https://x/a.png",
      camera_lora: "dolly_left",
      enable_prompt_expansion: false,
      generate_audio: true,
      num_frames: 193,
      video_size: { width: 704, height: 1280 },
    });
    expect(body.loras).toBeUndefined();
  });

  it("switches to the /lora endpoint when a LoRA rides along, and never sends a GPU-only LoRA", async () => {
    const { url, body } = await submit(view("cloud"), fal("t2v"), { prompt: "x", duration: 5, resolution: "720p", aspectRatio: "16:9", loras: [LTX_LORA] });
    expect(url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/text-to-video\/lora$/);
    expect(body.loras).toEqual([{ path: LTX_LORA.url, scale: 0.8 }]);
    const local = { ...LTX_LORA, licence: { commercial: true, hostedOk: false, snapshotDate: "2026-10-26" } };
    const plain = await submit(view("cloud"), fal("t2v"), { prompt: "x", duration: 5, loras: [local] });
    expect(plain.url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/text-to-video$/);
    expect(plain.body.loras).toBeUndefined();
  });

  it("an extend and an edit keep their source clip's size; the prequel extends backward", async () => {
    const ext = await submit(view("cloud"), fal("extend"), { prompt: "x", video: "https://x/take.mp4", duration: 10, resolution: "720p", aspectRatio: "16:9", extra: { extend_direction: "backward" } });
    expect(ext.url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/extend-video$/);
    expect(ext.body).toMatchObject({ video_url: "https://x/take.mp4", num_frames: 241, extend_direction: "backward", enable_prompt_expansion: false });
    expect(ext.body.video_size).toBeUndefined();
    const edit = await submit(view("cloud"), fal("v2v"), { prompt: "make it snow", video: "https://x/take.mp4" });
    expect(edit.url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/video-to-video$/);
    expect(edit.body).toMatchObject({ video_url: "https://x/take.mp4", enable_prompt_expansion: false });
    expect(edit.body.video_size).toBeUndefined();
  });

  it("previews on the engine asked for: priced on fal, free on the GPU", () => {
    const req = { feature: "cinema", modelId: CINEMA_MODEL, prompt: "a lighthouse at dusk", params: { duration: 5, resolution: "720p", aspectRatio: "16:9" } };
    // Demo mode is free; with a fal key the run is priced.
    expect(previewGeneration({ ...req, engine: "cloud" })).toMatchObject({ demo: true, costUsd: 0 });
    setSetting("falKey", "test-key");
    try {
      const cloud = previewGeneration({ ...req, engine: "cloud" });
      expect(cloud).toMatchObject({ engine: "cloud", demo: false, route: { provider: "fal", endpoint: "fal-ai/ltx-2.3-22b/text-to-video" } });
      expect(cloud.costUsd).toBeCloseTo(5 * 0.0347, 3);
    } finally {
      setSetting("falKey", "");
    }
    const open = previewGeneration({ ...req, engine: "open" });
    expect(open).toMatchObject({ engine: "open", costUsd: 0, route: { provider: "comfyui", endpoint: "wan22-t2v-14b-lightx2v" } });
  });
});

describe("Fuobe Cinema on the GPU", () => {
  it("runs a Fun Camera pose on its graph and a camera LoRA on the Lightning image-to-video graph", async () => {
    const posed = planCinema({ engine: "open", mode: "video", action: "generate", prompt: "a lighthouse at dusk", moves: ["pan-left"], settings: {}, images: ["/api/files/a.png"], duration: 5 }, { cloudAllowed: true });
    const p = posed.steps[0].request;
    expect(p.params!.extra).toEqual({ cameraMotion: "Pan Left" });
    const fun = await prepareWorkflow("wan22-i2v-14b-lightx2v", { ...p.params, prompt: p.prompt, images: ["up_a.png"], seed: 1 }, ctx());
    expect(fun.manifest.id).toBe("wan22-fun-camera-14b");
    expect(Object.values(fun.workflow as ComfyWorkflow).find((n) => n.class_type === "WanCameraEmbedding")!.inputs.camera_pose).toBe("Pan Left");

    const lora = planCinema({ engine: "open", mode: "video", action: "generate", prompt: "a lighthouse at dusk", moves: ["arc-left"], settings: {}, images: ["/api/files/a.png"], duration: 5 }, { cloudAllowed: true });
    const l = lora.steps[0].request;
    const wan = await prepareWorkflow("wan22-i2v-14b-lightx2v", { ...l.params, prompt: l.prompt, images: ["up_a.png"], loras: l.loras, seed: 1 }, ctx());
    expect(wan.manifest.id).toBe("wan22-i2v-14b-lightx2v");
    const injected = Object.values(wan.workflow as ComfyWorkflow)
      .filter((n) => n.class_type === "LoraLoaderModelOnly")
      .map((n) => n.inputs.lora_name);
    for (const f of l.loras!.map((x) => x.file)) expect(injected).toContain(f);
  });
});
