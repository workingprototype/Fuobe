import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import { injectLoras, type ComfyWorkflow } from "@/lib/comfy";

// Build plan O10: Fuobe Marketing Image and Fuobe Try-On on both engines, the try-on LoRA as an adapter with its
// licence and switch, the AI Influencer app on Fuobe Soul, and the product-shot graph inside Marketing Image.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-originals-marketing-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { getModel, getPreset } = await import("@/lib/catalog");
const { onEngine, enginesOf } = await import("@/lib/catalog/engines");
const { planGeneration } = await import("@/lib/catalog/plan");
const { loraEndpointFor, loraFields, routeLoraField } = await import("@/lib/catalog/loras");
const { LORA_LIBRARY } = await import("@/lib/catalog/lora-library.generated");
const { AD_VISUAL_MODELS, adVisualModel, formatModels, FORMATS, MARKETING_IMAGE_MODEL, wordsOnTop } = await import("@/lib/catalog/marketing");
const { FASHION_MODELS, PHOTODUMP_MODELS, TRYON_MODEL } = await import("@/lib/catalog/packs");
const { CAST_LOOK } = await import("@/lib/catalog/soul-cards");
const { setSetting } = await import("@/server/settings");
const { previewGeneration, appEngine } = await import("@/server/generations");
const { changeAccess, accessList } = await import("@/server/model-access");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const research = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/research/fuobe-originals-recipes-5.json"), "utf8"));

setSetting("demoMode", "auto");
afterEach(() => changeAccess([{ kind: "reset" }]));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const TRYON_FILE = "tryon-klein-4b.safetensors";
const plan = (r: Parameters<typeof planGeneration>[0], engine: "cloud" | "open") =>
  planGeneration(r, (id) => (getModel(id) && enginesOf(getModel(id)!).length > 1 ? onEngine(getModel(id)!, engine) : getModel(id)), getPreset);

async function prepare(id: string, input: GenInput, op: Operation) {
  return prepareWorkflow(id, { seed: 7, ...input }, { generationId: "g", op, upload: async (_d, _t, name) => `up_${name}`, media: () => undefined, serverRam: async () => undefined });
}

describe("Fuobe Marketing Image", () => {
  const m = getModel(MARKETING_IMAGE_MODEL)!;

  it("runs Qwen-Image-Edit 2511 (and Qwen-Image 2512 without a photo) on both engines", () => {
    expect(m).toMatchObject({ vendor: "Fuobe Original", engines: ["open", "cloud"], kind: "image" });
    const open = onEngine(m, "open");
    expect(open.routes.map((r) => [r.op, r.endpoint])).toEqual([
      ["edit", "qwen-image-edit-2511-multi"],
      ["t2i", "qwen-image-2512-t2i"],
    ]);
    expect(open.options.maxImages).toBe(3);
    const cloud = onEngine(m, "cloud");
    expect(cloud.routes.map((r) => [r.op, r.provider, r.endpoint, r.loraEndpoint])).toEqual([
      ["edit", "fal", "fal-ai/qwen-image-edit-2511", "fal-ai/qwen-image-edit-2511/lora"],
      ["edit", "replicate", "qwen/qwen-image-edit-2511", undefined],
      ["t2i", "fal", "fal-ai/qwen-image-2512", "fal-ai/qwen-image-2512/lora"],
    ]);
    expect(cloud.options.maxImages).toBe(10);
    expect(m.pricing).toMatchObject({ unit: "megapixel", usd: 0.03, withLoras: 0.035 });
    expect(m.licence).toMatchObject({ licence: "Apache-2.0", commercial: true });
    // Its research record says what it is and which partners stay choices.
    const studio = research.studios.find((s: { id: string }) => s.id === "marketing");
    expect(studio.original.model).toBe(MARKETING_IMAGE_MODEL);
    for (const id of studio.original.partners) expect(getModel(id), id).toBeDefined();
  });

  it("is the first model of every image format and of Ads Studio's pictures, partners after it", () => {
    for (const f of Object.values(FORMATS).filter((x) => x.pipeline === "image")) {
      for (const engine of ["cloud", "open"] as const) {
        for (const product of [true, false]) expect(formatModels(f, engine, { product, avatar: false })[0].id, `${f.id}/${engine}`).toBe(MARKETING_IMAGE_MODEL);
      }
    }
    expect(formatModels(FORMATS.ads, "cloud", { product: true, avatar: false }).map((c) => c.id)).toContain("gpt-image-2-5");
    expect(AD_VISUAL_MODELS.cloud.map((c) => c.id)).toEqual([MARKETING_IMAGE_MODEL, "nano-banana-pro", "gpt-image-2-5"]);
    expect(adVisualModel("open", "nano-banana-pro")).toBe(MARKETING_IMAGE_MODEL);
    expect(adVisualModel("cloud", "gpt-image-2-5")).toBe("gpt-image-2-5");
    // Its words are set over the picture on both engines; a partner draws them.
    expect([wordsOnTop("cloud", MARKETING_IMAGE_MODEL), wordsOnTop("open", MARKETING_IMAGE_MODEL), wordsOnTop("cloud", "gpt-image-2-5")]).toEqual([true, true, false]);
  });

  it("runs a Standalone product shot of one photo on the product-shot graph on the user's GPU", async () => {
    const shot = await prepare("qwen-image-edit-2511-multi", { prompt: "on wet marble", images: ["product.png"], extra: { productShot: true } }, "edit");
    expect(shot.manifest.id).toBe("product-shot-qwen-edit-2509");
    expect(JSON.stringify(shot.workflow)).not.toContain("productShot");
    // Two photos (or no flag): the multi-reference edit.
    expect((await prepare("qwen-image-edit-2511-multi", { prompt: "x", images: ["a.png", "b.png"], extra: { productShot: true } }, "edit")).manifest.id).toBe("qwen-image-edit-2511-multi");
    expect((await prepare("qwen-image-edit-2511-multi", { prompt: "x", images: ["a.png"] }, "edit")).manifest.id).toBe("qwen-image-edit-2511-multi");
  });
});

describe("Fuobe Try-On and its LoRA", () => {
  const m = getModel(TRYON_MODEL)!;

  it("carries the try-on LoRA on both engines, pinned, with its licence as information", () => {
    expect(m).toMatchObject({ vendor: "Fuobe Original", engines: ["open", "cloud"] });
    expect(onEngine(m, "open").routes).toEqual([expect.objectContaining({ provider: "comfyui", op: "edit", endpoint: "tryon-flux2-klein-4b" })]);
    expect(onEngine(m, "cloud").routes).toEqual([expect.objectContaining({ provider: "fal", op: "edit", endpoint: "fal-ai/flux-2/klein/4b/edit", loraEndpoint: "fal-ai/flux-2/klein/4b/edit/lora" })]);
    const entry = LORA_LIBRARY.find((e) => e.file === TRYON_FILE)!;
    expect(entry).toMatchObject({ key: "tryon-klein-4b", group: "adapter", base: "flux2-klein-4b", trigger: "TRYON", download: "direct", licence: { commercial: true, hostedOk: true, name: "Apache-2.0" } });
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.url).toBe(`https://huggingface.co/xocialize/tryon-FLUX.2-klein-4B-lora/resolve/${entry.version}/${TRYON_FILE}`);
    expect(m.options.loras).toEqual([expect.objectContaining({ file: TRYON_FILE, url: entry.url, strength: 1, trigger: "TRYON" })]);
  });

  it("plans the LoRA and its trigger on every run, and the LoRA card's words when none are given", () => {
    for (const engine of ["cloud", "open"] as const) {
      const p = plan({ feature: "image", modelId: TRYON_MODEL, op: "edit", inputs: { images: ["/me.png", "/dress.png"] } }, engine);
      expect(p.prompt).toMatch(/^TRYON a full-body photo of a person\. Replace the outfit/);
      expect(p.loras.map((l) => l.file)).toEqual([TRYON_FILE]);
    }
    const worded = plan({ feature: "image", modelId: TRYON_MODEL, op: "edit", prompt: "a summer dress", inputs: { images: ["/me.png", "/dress.png"] } }, "cloud");
    expect(worded.prompt).toBe("TRYON a summer dress");
    expect(() => plan({ feature: "image", modelId: TRYON_MODEL, op: "edit", inputs: { images: ["/me.png"] } }, "cloud")).toThrow("Add a photo of the person, then the garment");
    // fal's klein edit takes the LoRA by URL on its /lora endpoint.
    const route = onEngine(m, "cloud").routes[0];
    const loras = m.options.loras!;
    expect(loraEndpointFor(route, loras)).toBe("fal-ai/flux-2/klein/4b/edit/lora");
    expect(loraFields(routeLoraField(route)!, loras)).toEqual({ loras: [{ path: loras[0].url, scale: 1 }] });
  });

  it("isn't loaded twice on the graph that loads it itself", async () => {
    const lora = m.options.loras!;
    const { workflow } = await prepare("tryon-flux2-klein-4b", { prompt: "TRYON a dress", images: ["me.png", "dress.png"], loras: lora }, "edit");
    expect(Object.values(workflow).filter((n) => /^LoraLoader/.test(n.class_type)).map((n) => n.inputs.lora_name)).toEqual([TRYON_FILE]);
    // Another LoRA still goes on after the loader.
    const wf: ComfyWorkflow = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "klein.safetensors" } },
      "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: TRYON_FILE, strength_model: 1 } },
      "3": { class_type: "KSampler", inputs: { model: ["2", 0] } },
    };
    const out = injectLoras(wf, [...lora, { file: "other.safetensors", strength: 0.5 }]);
    expect(Object.values(out).filter((n) => n.class_type === "LoraLoaderModelOnly").map((n) => n.inputs.lora_name).sort()).toEqual(["other.safetensors", TRYON_FILE]);
    expect(injectLoras(wf, lora)).toBe(wf);
  });

  it("previews the hosted try-on with its LoRA, and refuses it while Settings switches the LoRA off", () => {
    const req = { feature: "image", modelId: TRYON_MODEL, engine: "cloud" as const, op: "edit" as const, inputs: { images: ["/api/files/me.png", "/api/files/dress.png"] } };
    const p = previewGeneration(req);
    expect(p).toMatchObject({ engine: "cloud", route: { provider: "fal", endpoint: "fal-ai/flux-2/klein/4b/edit/lora" } });
    expect(p.loras.applied.map((l) => l.file)).toEqual([TRYON_FILE]);
    expect(p.prompt).toMatch(/^TRYON /);
    // The LoRA's row in Settings → Models & licences: its licence, and a switch.
    const row = accessList().loras.find((l) => l.file === TRYON_FILE)!;
    expect(row).toMatchObject({ group: "adapter", on: true, licence: { class: "commercial", name: "Apache-2.0" } });
    changeAccess([{ kind: "lora", id: TRYON_FILE, on: false }]);
    for (const engine of ["cloud", "open"] as const) {
      expect(() => previewGeneration({ ...req, engine })).toThrow(/Fuobe Try-On runs with the LoRA “Virtual Try-On for FLUX\.2 \[klein\] 4B \(xocialize\)”, which is switched off in Settings → Models & licences/);
    }
  });

  it("is Fashion Factory's outfit model on both engines, with Qwen-Image-Edit 2511 making the photoset", () => {
    expect(FASHION_MODELS.outfit.open).toEqual([TRYON_MODEL]);
    expect(FASHION_MODELS.outfit.cloud[0]).toBe(TRYON_MODEL);
    expect(FASHION_MODELS.photoset).toEqual({ cloud: ["qwen-image-edit-2511-cloud", "nano-banana-pro"], open: ["oss-qwen-edit"] });
    expect(PHOTODUMP_MODELS.cloud).toEqual(["fuobe-soul", "qwen-image-edit-2511-cloud", "nano-banana-pro", "seedream-5-pro"]);
  });
});

describe("the AI Influencer app on Fuobe Soul", () => {
  const app = getPreset("app-ai-influencer")!;

  it("draws the sheet on Fuobe Soul in the casting look in the cloud, on the Soul Cast graph on the user's GPU", () => {
    expect(app.cloud).toMatchObject({ modelId: "fuobe-soul", op: "t2i", look: CAST_LOOK, params: { aspectRatio: "16:9", resolution: "1080p" } });
    expect(app.open).toMatchObject({ modelId: "oss-zimage-soul-cast" });
    const p = plan({ feature: "app:app-ai-influencer", presetId: app.id, modelId: "fuobe-soul", engine: "cloud", prompt: "a surfer from Lisbon" }, "cloud");
    expect(p.soul?.look).toBe(CAST_LOOK);
    expect(p.prompt).toContain("A character sheet of an original character: a surfer from Lisbon");
    expect(p.params).toMatchObject({ aspectRatio: "16:9", resolution: "1080p" });
    // Fuobe Soul's own looks still go by their id.
    expect(plan({ feature: "image", modelId: "fuobe-soul", presetId: "v1-general", prompt: "a fox" }, "cloud").soul?.look).toBe("v1-general");
    expect(() => plan({ feature: "image", modelId: "fuobe-soul", presetId: "app-nope", prompt: "a fox" }, "cloud")).toThrow(/Unknown Soul look/);
  });

  it("runs on the engine whose route names the Original when the request names none", () => {
    expect(appEngine({ presetId: app.id }, getModel("fuobe-soul")!)).toBe("cloud");
    expect(appEngine({ presetId: app.id }, getModel("oss-zimage-soul-cast")!)).toBe("open");
    expect(appEngine({ presetId: "v1-general" }, getModel("fuobe-soul")!)).toBeUndefined();
    const p = previewGeneration({ feature: "app:app-ai-influencer", presetId: app.id, modelId: "fuobe-soul", prompt: "a surfer" });
    expect(p).toMatchObject({ engine: "cloud", demo: true });
  });
});
