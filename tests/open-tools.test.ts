import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GenInput, ModelDef, ModelRoute, Operation } from "@/lib/catalog/types";
import type { ComfyWorkflow } from "@/lib/comfy";

// Build plan O11 (rebranded open tools, Speak and finishing): Fuobe Angles (Qwen-Image-Edit 2509 + dx8152's
// Multiple-angles LoRA on both engines, the Angles app's Higgsfield-like controls), Fuobe Speak (InfiniteTalk with
// Higgsfield's Infinite Talk settings on the GPU, fal's InfiniteTalk) and Fuobe Speak · Motion (Wan 2.2 S2V), Depth
// Map's Large model as a labelled alternative, the HDR route's LoRA endpoint, and Soul's face mosaic (SAM 3.1 + a
// mosaic on the GPU, fal's SAM 3.1 masks pixelated in the browser).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-o11-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration, previewGeneration } = await import("@/server/generations");
const { falProvider } = await import("@/server/providers/fal");
const { prepareWorkflow, getWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset } = await import("@/lib/catalog");
const { onEngine } = await import("@/lib/catalog/engines");
const { planGeneration, estimateCost } = await import("@/lib/catalog/plan");
const { extractOutputs, numFramesValue } = await import("@/lib/catalog/payload");
const { soulPostStep, soulLook } = await import("@/lib/catalog/soul");
const tools = await import("@/lib/catalog/open-tools");
const { finishSteps, mosaicPixels, unionMasks } = await import("@/lib/soul-post");
const { accessList } = await import("@/server/model-access");
const { licenceInfo } = await import("@/lib/licences");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const view = (id: string, engine: "open" | "cloud") => onEngine(getModel(id)!, engine);
const plan = (r: Parameters<typeof planGeneration>[0], engine: "open" | "cloud") =>
  planGeneration(r, (id) => (getModel(id)?.engines ? view(id, engine) : getModel(id)), getPreset);
const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/fuobe-originals-recipes-5.json"), "utf8"));

async function prepare(id: string, input: GenInput, op: Operation): Promise<ComfyWorkflow> {
  const { workflow } = await prepareWorkflow(id, { seed: 7, ...input }, { generationId: "g", op, upload: async (_d, _t, name) => `up_${name}`, media: () => undefined, serverRam: async () => undefined });
  return workflow;
}

/** Submit through the fal adapter and return the endpoint URL and the JSON body it posted. */
async function submit(model: ModelDef, route: ModelRoute, given: GenInput): Promise<{ url: string; body: Record<string, unknown> }> {
  const real = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
    return new Response(JSON.stringify({ request_id: "r1", status_url: "s", response_url: "r", cancel_url: "c" }), { status: 200 });
  }) as typeof fetch;
  try {
    await falProvider.submit({ generationId: "g", model, route, input: given });
  } finally {
    globalThis.fetch = real;
  }
  return seen!;
}

describe("Fuobe Angles", () => {
  it("writes the Multiple-angles LoRA's own words for a camera, and refuses one that doesn't move", () => {
    expect(tools.anglesWords({ rotate_right_left: 45 })).toBe("将镜头向左旋转45度 Rotate the camera 45 degrees to the left.");
    expect(tools.anglesWords({ rotate_right_left: -90, move_forward: 10, vertical_angle: -1, wide_angle_lens: true })).toBe(
      "将镜头向右旋转90度 Rotate the camera 90 degrees to the right. 将镜头转为特写镜头 Turn the camera to a close-up. 将相机转向鸟瞰视角 Turn the camera to a bird's-eye view. 将镜头转为广角镜头 Turn the camera to a wide-angle lens.",
    );
    expect(tools.anglesWords({ move_forward: 3, vertical_angle: 1 })).toBe("将镜头向前移动 Move the camera forward. 将相机切换到仰视视角 Turn the camera to a worm's-eye view.");
    // A half tilt isn't one of the LoRA's views, and out-of-range values are clamped.
    expect(tools.anglesWords({ vertical_angle: 0.5, rotate_right_left: 400 })).toBe("将镜头向左旋转90度 Rotate the camera 90 degrees to the left.");
    expect(tools.anglesWords({})).toBe("");
    expect(() => tools.anglesPrompt({}, "")).toThrow(/Move the camera first/);
    expect(tools.anglesPrompt({ rotate_right_left: 45 }, "keep the red scarf")).toBe("将镜头向左旋转45度 Rotate the camera 45 degrees to the left. keep the red scarf");
  });

  it("is an Original on both engines: the 2509 graph with the LoRA on your GPU, fal's LoRA gallery route in the cloud", () => {
    const m = getModel("fuobe-angles")!;
    expect(m.engines).toEqual(["open", "cloud"]);
    const open = view("fuobe-angles", "open");
    const cloud = view("fuobe-angles", "cloud");
    expect(open.routes.map((r) => r.endpoint)).toEqual(["qwen-image-edit-2509-angles"]);
    expect(cloud.routes.map((r) => r.endpoint)).toEqual(["fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles"]);
    // Higgsfield's controls on both engines: rotate −90…90°, tilt −1…1, move forward 0–10 (the research's fields).
    expect(m.options.sliders?.map((s) => [s.param, s.min, s.max])).toEqual([["rotate_right_left", -90, 90], ["vertical_angle", -1, 1], ["move_forward", 0, 10]]);
    // The LoRA is the recipe's on the GPU (downloaded before a run, switchable); fal has it built in at 1.25, 6 steps.
    expect(open.options.loras?.map((l) => [l.file, l.strength])).toEqual([["qwen-edit-2509-multiple-angles-dx8152.safetensors", 1.25]]);
    expect(cloud.options.loras).toBeUndefined();
    const record = research.studios.find((s: { id: string }) => s.id === "angles").original;
    expect(cloud.routes[0].map?.defaults).toEqual(record.cloud.defaults);
    expect(cloud.routes[0].map?.prompt).toBe(false);
  });

  it("the Angles app turns its picks into fal's fields in the cloud and the LoRA's words on your GPU", async () => {
    const req = { feature: "app:app-angles", modelId: "fuobe-angles", presetId: "app-angles", prompt: "keep the logo", inputs: { images: ["/a.png"] }, presetOptions: { rotate: "90-right", height: "from-above", distance: "close-up", lens: "wide" } };
    const open = plan(req, "open");
    expect(open.prompt).toBe(
      "将镜头向右旋转90度 Rotate the camera 90 degrees to the right. 将镜头转为特写镜头 Turn the camera to a close-up. 将相机转向鸟瞰视角 Turn the camera to a bird's-eye view. 将镜头转为广角镜头 Turn the camera to a wide-angle lens. keep the logo",
    );
    expect(open.loras.map((l) => l.file)).toEqual(["qwen-edit-2509-multiple-angles-dx8152.safetensors"]);
    const cloud = plan(req, "cloud");
    expect(cloud.prompt).toBe("");
    expect(cloud.params.extra).toMatchObject({ rotate_right_left: -90, vertical_angle: -1, move_forward: 10, wide_angle_lens: true });
    expect(cloud.notes?.join(" ")).toMatch(/takes no words/);
    // The app's default turns the camera 45° left; an unmoved camera is refused before anything runs.
    expect(plan({ ...req, presetOptions: undefined }, "cloud").params.extra).toMatchObject({ rotate_right_left: 45 });
    expect(() => plan({ ...req, presetOptions: { rotate: "front" } }, "cloud")).toThrow(/Move the camera first/);
    // fal's payload: the fields as they are, the LoRA scale and steps from the research, no prompt.
    setSetting("falKey", "fal_test_key_123456");
    try {
      const model = view("fuobe-angles", "cloud");
      const sent = await submit(model, model.routes[0], { prompt: "", images: ["https://x/a.png"], extra: cloud.params.extra, seed: 3 });
      expect(sent.url).toMatch(/fal-ai\/qwen-image-edit-2509-lora-gallery\/multiple-angles$/);
      expect(sent.body).toMatchObject({ image_urls: ["https://x/a.png"], rotate_right_left: -90, vertical_angle: -1, move_forward: 10, wide_angle_lens: true, lora_scale: 1.25, num_inference_steps: 6, seed: 3 });
      expect(sent.body.prompt).toBeUndefined();
    } finally {
      setSetting("falKey", "");
    }
  });

  it("the GPU graph: Lightning, then the Multiple-angles LoRA at 1.25, 6 steps, the words as the instruction", async () => {
    const wf = await prepare(
      "qwen-image-edit-2509-angles",
      { prompt: tools.anglesWords({ rotate_right_left: 45 }), images: ["a.png"], loras: tools.ANGLES_LORA ? [tools.ANGLES_LORA] : [] },
      "edit",
    );
    const loras = Object.fromEntries(Object.entries(wf).filter(([, n]) => n.class_type === "LoraLoaderModelOnly").map(([id, n]) => [String(n.inputs.lora_name), { id, strength: n.inputs.strength_model, from: n.inputs.model }]));
    // The recipe's LoRA is the graph's own: not loaded twice. Lightning on the model, the Multiple-angles LoRA after it.
    expect(Object.keys(loras).sort()).toEqual(["Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors", "qwen-edit-2509-multiple-angles-dx8152.safetensors"]);
    expect(loras["qwen-edit-2509-multiple-angles-dx8152.safetensors"]).toMatchObject({ strength: 1.25, from: [loras["Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors"].id, 0] });
    expect(wf["433:111"].inputs.prompt).toBe("将镜头向左旋转45度 Rotate the camera 45 degrees to the left.");
    expect(wf["433:436"].inputs.value).toBe(6);
    expect(wf["78"].inputs.image).toBe("a.png");
  });
});

describe("Fuobe Speak", () => {
  it("is InfiniteTalk on both engines and Speak · Motion is Wan 2.2 S2V, each as long as the voice", () => {
    expect(view("fuobe-speak", "open").routes.map((r) => r.endpoint)).toEqual(["infinitetalk-wanwrapper"]);
    expect(view("fuobe-speak", "cloud").routes.map((r) => r.endpoint)).toEqual(["fal-ai/infinitalk"]);
    expect(view("fuobe-speak-motion", "open").routes.map((r) => r.endpoint)).toEqual(["wan22-s2v-14b"]);
    expect(view("fuobe-speak-motion", "cloud").routes.map((r) => r.endpoint)).toEqual(["fal-ai/wan/v2.2-14b/speech-to-video"]);
    // fal's InfiniteTalk renders 25 fps frames (41–721): 6 s of voice is 150; S2V 16 fps, a multiple of 4 up to 120.
    const it = view("fuobe-speak", "cloud").routes[0].map!.numFrames!;
    expect(numFramesValue(it, { sourceDuration: 6 })).toBe(150);
    expect(numFramesValue(it, { sourceDuration: 60 })).toBe(721);
    const s2v = view("fuobe-speak-motion", "cloud").routes[0].map!.numFrames!;
    expect(numFramesValue(s2v, { sourceDuration: 5.1 })).toBe(80);
    expect(numFramesValue(s2v, { sourceDuration: 1 })).toBe(40);
    expect(numFramesValue(s2v, { sourceDuration: 30 })).toBe(120);
    // The hosted InfiniteTalk used to be sent seconds as num_frames: it follows the voice now too.
    expect(getModel("infinitetalk-cloud")!.routes[0].map?.numFrames).toMatchObject({ key: "num_frames", fps: 25 });
    // Prices before a run: $0.20 a second (InfiniteTalk); $0.10 / $0.15 / $0.20 by resolution (S2V).
    expect(estimateCost(view("fuobe-speak", "cloud"), { duration: 10 })).toBeCloseTo(2, 5);
    expect(estimateCost(view("fuobe-speak-motion", "cloud"), { duration: 5, resolution: "720p" })).toBeCloseTo(1, 5);
    expect(estimateCost(view("fuobe-speak", "open"), { duration: 10 })).toBe(0);
  });

  it("sends Higgsfield's Infinite Talk settings on your GPU: FusioniX in the wrapper's LoRA slot, 15 motion frames, 25 steps, shift 10, guidance 5 / 5", async () => {
    const m = view("fuobe-speak", "open");
    expect(m.options.loras?.map((l) => l.file)).toEqual(["Wan2.1_I2V_14B_FusionX_LoRA.safetensors"]);
    const route = m.routes[0];
    expect(route.extra).toEqual(tools.SPEAK_GRAPH);
    const record = research.studios.find((s: { id: string }) => s.id === "speak").original.open.defaults;
    expect(route.extra).toMatchObject({ motionFrame: record.motionFrame, steps: record.steps, shift: record.shift, cfg: record.cfg, audioCfg: record.audioCfg, scheduler: record.scheduler });
    // The provider merges the route's settings under the run's own (a run that asks for 30 steps gets 30).
    const run = async (extra?: Record<string, unknown>) =>
      prepare("infinitetalk-wanwrapper", { prompt: tools.SPEAK_PROMPT, images: ["face.png"], audio: "voice.wav", loras: m.options.loras, extra: { ...route.extra, ...extra } }, "avatar");
    const wf = await run();
    expect(wf["138"].inputs).toMatchObject({ lora: "Wan2.1_I2V_14B_FusionX_LoRA.safetensors", strength: 1 });
    expect(wf["128"].inputs).toMatchObject({ steps: 25, cfg: 5, shift: 10, scheduler: "unipc" });
    expect(wf["192"].inputs).toMatchObject({ motion_frame: 15, colormatch: "reinhard", mode: "infinitetalk" });
    expect(wf["194"].inputs.audio_cfg_scale).toBe(5);
    expect((await run({ steps: 30 }))["128"].inputs.steps).toBe(30);
    // The solver and colour match it sends are ones the wrapper's nodes take (object_info, the validation server's).
    const subset = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/comfyui/object_info.subset.json"), "utf8"));
    expect(subset.WanVideoSampler.input.required.scheduler[0]).toContain("unipc");
    expect(subset.WanVideoImageToVideoMultiTalk.input.required.colormatch[0]).toContain("reinhard");
    // The graph's own defaults stay the fast lightx2v pass (InfiniteTalk Long runs it as before).
    const plain = await prepare("infinitetalk-wanwrapper", { prompt: "talk", images: ["face.png"], audio: "voice.wav" }, "avatar");
    expect(plain["138"].inputs.lora).toBe("lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors");
    expect(plain["128"].inputs.steps).toBe(6);
    // Two LoRAs don't fit the wrapper's one slot.
    await expect(prepare("infinitetalk-wanwrapper", { prompt: "talk", images: ["f.png"], audio: "v.wav", loras: [{ file: "a.safetensors" }, { file: "b.safetensors" }] }, "avatar")).rejects.toThrow(/takes one LoRA/);
  });

  it("runs without words, in the portrait's shape on your GPU", () => {
    const open = plan({ feature: "lipsync", modelId: "fuobe-speak", inputs: { images: ["/p.png"], audio: "/v.wav" } }, "open");
    expect(open.prompt).toBe(tools.SPEAK_PROMPT);
    expect(open.params.aspectRatio).toBe("auto");
    expect(open.loras.map((l) => l.file)).toEqual(["Wan2.1_I2V_14B_FusionX_LoRA.safetensors"]);
    const cloud = plan({ feature: "lipsync", modelId: "fuobe-speak", inputs: { images: ["/p.png"], audio: "/v.wav" } }, "cloud");
    expect(cloud.loras).toEqual([]);
    expect(cloud.prompt).toBe(tools.SPEAK_PROMPT);
  });

  it("lists FusioniX and the Multiple-angles LoRA with their licences in Settings → Models & licences", () => {
    const list = accessList();
    const fusionix = list.loras.find((l) => l.file === "Wan2.1_I2V_14B_FusionX_LoRA.safetensors")!;
    expect(fusionix).toMatchObject({ group: "adapter", on: true, licence: { name: "Apache-2.0", class: "commercial" } });
    expect(fusionix.licence.note).toMatch(/merges other LoRAs.*not checked/);
    expect(list.models.find((m) => m.id === "oss-video-depth-vda-large")).toMatchObject({ on: true, licence: { class: "non-commercial" } });
    expect(list.models.find((m) => m.id === "fuobe-speak")).toBeTruthy();
  });
});

describe("Depth Map and Upscale routes", () => {
  it("offers Video Depth Anything Large on your GPU, labelled non-commercial, without making it the default", async () => {
    const m = getModel("oss-video-depth-vda-large")!;
    expect(m.tagline).toMatch(/non-commercial/);
    const wf = await prepare("video-depth-vda-large", { video: "clip.mp4", colormap: "inferno" }, "depth-video");
    expect(Object.values(wf).find((n) => n.class_type === "LoadVideoDepthAnythingModel")?.inputs.model).toBe("video_depth_anything_vitl.pth");
    expect(licenceInfo(getWorkflow("video-depth-vda-large").manifest.license ?? "").class).toBe("non-commercial");
    const { VIDEO_DEPTH_STUDIO } = await import("@/lib/studios");
    expect(VIDEO_DEPTH_STUDIO.defaultModels).toEqual({ cloud: "depth-anything-video-cloud", open: "oss-video-depth-vda" });
  });

  it("SDR to HDR on fal switches to the /lora endpoint when a LoRA rides along", () => {
    const r = getModel("ltx-2-3-hdr")!.routes[0];
    expect(r.loraEndpoint).toBe("fal-ai/ltx-2.3-quality/hdr/lora");
    expect(r.map?.loras).toMatchObject({ key: "loras", max: 3, required: true });
  });
});

describe("Soul's face mosaic", () => {
  it("PixeletedFace asks for it; other looks and Soul Cinema don't", () => {
    expect(soulLook("v1-pixeletedface")?.post).toBe("face-mosaic");
    expect(soulPostStep("fuobe-soul", "v1-pixeletedface")).toBe("face-mosaic");
    expect(soulPostStep("fuobe-soul", "v1-general")).toBeUndefined();
    expect(soulPostStep("fuobe-soul-cinema", "v1-pixeletedface")).toBeUndefined();
    expect(tools.faceMosaicStep("open")).toEqual({ modelId: "oss-face-mosaic", op: "face-mosaic", prompt: "face" });
    expect(tools.faceMosaicStep("cloud").modelId).toBe("sam-3-1-face-mask");
  });

  it("chains the picture and the mosaic on the engine it runs on, one pair per picture", () => {
    for (const engine of ["open", "cloud"] as const) {
      const made = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine, presetId: "v1-pixeletedface", params: { numOutputs: 2 } });
      expect(made).toHaveLength(4);
      const steps = made.map((g) => getGeneration(g.id)!).map((g) => [g.modelId, g.op, g.request?.step?.label]);
      expect(steps).toEqual(
        expect.arrayContaining([
          ["fuobe-soul", "t2i", "Before the face mosaic 1 of 2"],
          [tools.FACE_MOSAIC_MODELS[engine], "face-mosaic", "Face mosaic 1 of 2"],
          ["fuobe-soul", "t2i", "Before the face mosaic 2 of 2"],
          [tools.FACE_MOSAIC_MODELS[engine], "face-mosaic", "Face mosaic 2 of 2"],
        ]),
      );
      expect(new Set(made.map((g) => g.batchId)).size).toBe(1);
    }
    // Another look runs as one job.
    expect(createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine: "cloud", presetId: "v1-general" })).toHaveLength(1);
  });

  it("the GPU graph: SAM 3.1 on the words ('face' by default), the mask grown, a 25 px mosaic under it", async () => {
    const p = plan({ feature: "image", modelId: "oss-face-mosaic", op: "face-mosaic", inputs: { images: ["/a.png"] } }, "open");
    expect(p.prompt).toBe("face");
    const wf = await prepare("image-face-mosaic-sam3", { prompt: p.prompt, images: ["a.png"] }, "face-mosaic");
    expect(wf["1"].inputs.image).toBe("a.png");
    expect(wf["3"].inputs.text).toBe("face");
    expect(wf["7"].inputs.scale_by).toBe(tools.MOSAIC_SCALE);
    expect(wf["9"].inputs.mask).toEqual(["5", 0]);
  });

  it("the cloud step: fal's SAM 3.1 masks, all of them kept, and the browser's finish pixelates the picture under them", async () => {
    const m = getModel("sam-3-1-face-mask")!;
    expect(m.hidden).toBe(true);
    setSetting("falKey", "fal_test_key_123456");
    try {
      const sent = await submit(m, m.routes[0], { prompt: "face", images: ["https://x/a.png"] });
      expect(sent.url).toMatch(/fal-ai\/sam-3-1\/image$/);
      expect(sent.body).toMatchObject({ image_url: "https://x/a.png", prompt: "face", apply_mask: false, return_multiple_masks: true, max_masks: 16, output_format: "png" });
    } finally {
      setSetting("falKey", "");
    }
    const out = extractOutputs({ masks: [{ url: "https://f/m1.png", content_type: "image/png" }, { url: "https://f/m2.png" }], image: { url: "https://f/preview.png" } }, "face-mosaic");
    expect(out).toEqual([{ url: "https://f/m1.png", kind: "image", contentType: "image/png", meta: { role: "mask", masks: ["https://f/m1.png", "https://f/m2.png"] } }]);
    expect(extractOutputs({ masks: [] }, "face-mosaic")).toEqual([]);
    // What the server writes on the step (meta.mosaic) is a finish the browser does once.
    const steps = finishSteps({ kind: "image", meta: { role: "mask", mosaic: { source: "/api/files/a.png", masks: ["/api/files/m1.png"] } } });
    expect(steps).toEqual({ mosaic: { source: "/api/files/a.png", masks: ["/api/files/m1.png"], scale: tools.MOSAIC_SCALE } });
    expect(finishSteps({ kind: "image", meta: { finished: true, mosaic: { source: "/a.png", masks: ["/m.png"] } } })).toBeNull();
  });

  it("pixelates whole blocks wherever a mask touches them, and nothing else", () => {
    const w = 60;
    const h = 30;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([i % w < 30 ? 200 : 20, (i * 7) % 255, 0, 255], i * 4);
    const before = rgba.slice();
    const mask = (x0: number, y0: number) => {
      const m = new Uint8ClampedArray(w * h * 4);
      m.set([255, 255, 255, 255], (y0 * w + x0) * 4);
      return m;
    };
    // Two masks, one pixel each: blocks (0,0) and (2,1) of the 25 px grid (3 × 2 blocks over 60 × 30).
    const changed = mosaicPixels(rgba, unionMasks([mask(3, 3), mask(55, 28)]), w, h, tools.MOSAIC_SCALE);
    expect(changed).toBe(2);
    const at = (x: number, y: number, a = rgba) => Array.from(a.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
    // Inside a block every pixel is the block's average; outside the touched blocks nothing moved.
    expect(at(0, 0)).toEqual(at(24, 24));
    expect(at(0, 0)[0]).toBe(200);
    expect(at(30, 5)).toEqual(at(30, 5, before));
    expect(at(26, 26)).toEqual(at(26, 26, before));
    expect(at(50, 25)).toEqual(at(59, 29));
  });

  it("the preview prices the Soul picture; the mosaic step is $0.01 in the cloud and free on your GPU", () => {
    expect(estimateCost(getModel("sam-3-1-face-mask")!, {})).toBeCloseTo(0.01, 5);
    expect(estimateCost(getModel("oss-face-mosaic")!, {})).toBe(0);
    expect(previewGeneration({ feature: "image", modelId: "oss-face-mosaic", op: "face-mosaic", inputs: { images: ["/a.png"] } }).op).toBe("face-mosaic");
  });
});
