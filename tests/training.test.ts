import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { applyMentions, type ElementLora, type StudioElement } from "@/lib/catalog/elements";
import { onEngine, runsOn } from "@/lib/catalog/engines";
import { planGeneration } from "@/lib/catalog/plan";
import { HOSTED_TRAINERS } from "@/lib/catalog/trainers.generated";
import {
  aiToolkitJob,
  datasetName,
  falTrainingInput,
  getTrainer,
  getTrainingTarget,
  identityFor,
  loraFamily,
  needsConsent,
  photosBlocker,
  photoTips,
  targetsFor,
  trainerCost,
  TRAINING_FAMILIES,
  TRAINING_TARGETS,
  triggerFor,
  usableOn,
} from "@/lib/catalog/training";
import { buildPayload } from "@/lib/catalog/payload";
import { OWN_LOOK, soulPostSteps, soulRecipe } from "@/lib/catalog/soul";
import { zip } from "@/server/zip";

const ROOT = path.resolve(__dirname, "..");

describe("Fuobe Soul ID targets (build plan O3)", () => {
  it("makes short, rare trigger words", () => {
    expect(triggerFor("Nova_Reyes")).toBe("nvrysfz");
    expect(triggerFor("Al")).toBe("alfz");
  });

  it("has no Higgsfield target: every one trains on fal or the user's GPU", () => {
    expect(TRAINING_TARGETS.map((t) => t.provider).every((p) => p === "fal" || p === "ai-toolkit")).toBe(true);
    expect(TRAINING_TARGETS.map((t) => t.id)).not.toContain("soul-id-v2");
    expect(TRAINING_TARGETS.map((t) => t.id)).not.toContain("soul-id-cinema");
  });

  it("retargets training to the Fuobe Soul models, whose LoRAs run on both engines", () => {
    for (const t of TRAINING_TARGETS) {
      expect(t.modelIds.length).toBeGreaterThan(0);
      for (const id of t.modelIds) expect(getModel(id), `${t.id} → ${id}`).toBeDefined();
    }
    expect(getTrainingTarget("fal-z-image")!.modelIds).toEqual(expect.arrayContaining(["fuobe-soul", "fuobe-soul-cinema"]));
    expect(getTrainingTarget("aitk-z-image")!.modelIds).toEqual(expect.arrayContaining(["fuobe-soul", "fuobe-soul-cinema"]));
    expect(getTrainingTarget("fal-qwen-2512")!.modelIds).toContain("fuobe-soul-hd");
    // The family's lead model is an Original on both engines.
    for (const f of Object.values(TRAINING_FAMILIES)) {
      const lead = getModel(f.lead)!;
      expect(runsOn(lead, "open") && runsOn(lead, "cloud")).toBe(true);
    }
  });

  it("trains only on commercial weights, at fal's price for the steps (research §3.3)", () => {
    for (const t of TRAINING_TARGETS.filter((x) => x.provider === "fal")) {
      const tr = getTrainer(t.trainer)!;
      expect(tr, t.id).toBeDefined();
      expect(tr.commercial).toBe(true);
      expect(tr.licence).toBe("Apache-2.0");
    }
    // $0.85 per 1,000 steps: the default 2,000-step run is $1.70 (research §4.5).
    expect(getTrainingTarget("fal-z-image")).toMatchObject({ steps: 2000, learningRate: 0.0005, costUsd: 1.7, price: "≈ $1.70 (2,000 steps)" });
    expect(getTrainingTarget("fal-qwen-2512")).toMatchObject({ steps: 1000, costUsd: 1.5 });
    expect(getTrainingTarget("fal-z-image-style")).toMatchObject({ steps: 1500, costUsd: 3.39, extra: { training_type: "style" } });
    expect(getTrainingTarget("aitk-z-image")).toMatchObject({ price: "Free", costUsd: 0 });
    // fal's floors: 500 billed steps on Z-Image Turbo v2.
    expect(trainerCost(getTrainer("fal-ai/z-image-turbo-trainer-v2"), 100)).toBe(0.43);
  });

  it("offers subject trainings to characters and style trainings to styles, consent for people only", () => {
    expect(targetsFor("character").map((t) => t.id)).toEqual(["aitk-z-image", "fal-z-image", "fal-qwen-2512"]);
    expect(targetsFor("style").map((t) => t.id)).toEqual(["aitk-z-image", "fal-z-image-style"]);
    expect(targetsFor("voice")).toEqual([]);
    expect(needsConsent("character")).toBe(true);
    expect(needsConsent("style")).toBe(false);
  });

  it("follows Higgsfield's photo rules: 5 to start, 20+ recommended, 80 at most", () => {
    expect(photosBlocker(4, "Maya")).toMatch(/at least 5 photos of Maya/);
    expect(photosBlocker(5)).toBeNull();
    expect(photosBlocker(81)).toMatch(/up to 80/);
    const photos = Array.from({ length: 8 }, (_, i) => ({ key: `p${i % 7}`, width: i === 0 ? 400 : 1024, height: 1024 }));
    const tips = photoTips(photos);
    expect(tips[0]).toMatch(/20\+ photos.*you have 8/);
    expect(tips.join(" ")).toMatch(/1 photo is smaller than 512 px/);
    expect(tips.join(" ")).toMatch(/1 duplicate photo/);
    expect(photoTips(Array.from({ length: 20 }, (_, i) => ({ key: String(i) })))).toEqual([]);
  });

  it("writes fal's request from the trainer's own fields: zip, steps, caption, learning rate, training type", () => {
    expect(falTrainingInput(getTrainingTarget("fal-z-image")!, "https://fal/zip", "photo of mayafz")).toEqual({
      image_data_url: "https://fal/zip",
      steps: 2000,
      default_caption: "photo of mayafz",
      learning_rate: 0.0005,
    });
    expect(falTrainingInput(getTrainingTarget("fal-z-image-style")!, "z", "mayafz style")).toEqual({ image_data_url: "z", steps: 1500, default_caption: "mayafz style", training_type: "style" });
    expect(datasetName(0, "jpg")).toBe("001.jpg");
    expect(datasetName(11, "txt")).toBe("012.txt");
  });

  it("writes AI-Toolkit jobs for Z-Image Turbo with the training adapter, rank 16–32", () => {
    const job = aiToolkitJob({ name: "x", trigger: "nvrysfz", datasetFolder: "/d", outputFolder: "/o" });
    const p = job.config.process[0];
    expect(p.trigger_word).toBe("nvrysfz");
    expect(p.model.arch).toBe("zimage:turbo");
    expect(p.model.assistant_lora_path).toMatch(/training_adapter_v2/);
    expect(p.datasets[0].folder_path).toBe("/d");
    expect(p.train.steps).toBe(2000);
    expect(p.network.linear).toBe(16);
    expect(aiToolkitJob({ name: "x", trigger: "t", datasetFolder: "/d", outputFolder: "/o", photos: 30 }).config.process[0].network.linear).toBe(32);
    expect(aiToolkitJob({ name: "x", trigger: "t", datasetFolder: "/d", outputFolder: "/o", kind: "style", photos: 30 }).config.process[0]).toMatchObject({ network: { linear: 16 }, train: { steps: 1500 } });
  });

  it("switches hosted Z-Image to its LoRA endpoint only when a LoRA URL is present", () => {
    const route = getModel("z-image-turbo-cloud")!.routes[0];
    expect(route.loraEndpoint).toBe("fal-ai/z-image/turbo/lora");
    expect(buildPayload(route.map!, { prompt: "x" }).loras).toBeUndefined();
  });

  it("writes zips other tools can read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-zip-"));
    const file = path.join(dir, "kit.zip");
    fs.writeFileSync(file, zip([{ name: "dataset/001.txt", data: Buffer.from("photo of nvrysfz") }, { name: "a.yaml", data: Buffer.from("{}") }]));
    const out = execFileSync("python3", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(), z.read('dataset/001.txt').decode())", file]).toString();
    expect(out.trim()).toBe("None photo of nvrysfz");
  });
});

describe("gen-trainers.py", () => {
  it("writes what is committed (the trainers match the research)", () => {
    const file = path.join(ROOT, "src/lib/catalog/trainers.generated.ts");
    const before = fs.readFileSync(file, "utf8");
    execFileSync("python3", ["scripts/gen-trainers.py"], { cwd: ROOT });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
  it("keeps the non-commercial trainers flagged (never a Soul ID route)", () => {
    expect(HOSTED_TRAINERS.find((t) => t.id === "fal-ai/flux-2-klein-9b-base-trainer")?.commercial).toBe(false);
    const used = new Set(TRAINING_TARGETS.map((t) => t.trainer).filter(Boolean));
    expect(HOSTED_TRAINERS.filter((t) => used.has(t.id)).every((t) => t.commercial)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The trained LoRA on a run

const lora = (o: Partial<ElementLora>): ElementLora => ({ engine: "cloud", modelId: "fuobe-soul", family: "z-image-turbo", file: "fuobe/maya-abc123.safetensors", trigger: "myfz", strength: 1, ...o });
const maya = (loras: ElementLora[]): StudioElement => ({
  id: "m1",
  name: "Maya",
  handle: "Maya",
  kind: "character",
  description: null,
  references: ["/api/files/a.png", "/api/files/b.png"],
  loras,
  status: "ready",
  createdAt: 0,
});

describe("a Soul ID on every model of its family, on both engines", () => {
  const soul = getModel("fuobe-soul")!;
  const openSoul = onEngine(soul, "open");
  const cloudSoul = onEngine(soul, "cloud");

  it("reads the family of LoRAs from before O3 from the model they were trained for", () => {
    expect(loraFamily({ modelId: "oss-z-image-turbo" })).toBe("z-image-turbo");
    expect(loraFamily({ modelId: "z-image-turbo-cloud" })).toBe("z-image-turbo");
    expect(loraFamily({ modelId: "soul-2", referenceId: "ref" })).toBeUndefined();
  });

  it("runs a fal-trained LoRA on the cloud by URL and on the open engine from Fuobe's copy", () => {
    const fal = lora({ url: "https://v3.fal.media/maya.safetensors", own: true });
    expect(usableOn(fal, "cloud") && usableOn(fal, "open")).toBe(true);
    expect(identityFor([fal], cloudSoul)).toBe(fal);
    expect(identityFor([fal], openSoul)).toBe(fal);
    expect(identityFor([fal], onEngine(getModel("fuobe-soul-cinema")!, "cloud"))).toBe(fal);
    // Another family needs its own training.
    expect(identityFor([fal], onEngine(getModel("fuobe-soul-hd")!, "cloud"))).toBeUndefined();
  });

  it("runs a GPU-trained LoRA in the cloud only when Fuobe keeps its file", () => {
    const gpu = lora({ engine: "open" });
    expect(usableOn(gpu, "open")).toBe(true);
    expect(usableOn(gpu, "cloud")).toBe(false);
    expect(usableOn({ ...gpu, own: true }, "cloud")).toBe(true);
  });

  it("prefers the LoRA trained on the run's engine, then the newest", () => {
    const gpu = lora({ engine: "open", own: true, trainedAt: 2, file: "fuobe/gpu.safetensors" });
    const cloud = lora({ url: "https://x/c.safetensors", trainedAt: 1, file: "fuobe/cloud.safetensors" });
    expect(identityFor([gpu, cloud], openSoul)).toBe(gpu);
    expect(identityFor([gpu, cloud], cloudSoul)).toBe(cloud);
  });

  it("never uses a demo training or a Higgsfield Soul ID", () => {
    expect(identityFor([lora({ demo: true, url: "x" })], cloudSoul)).toBeUndefined();
    expect(identityFor([{ engine: "cloud", modelId: "fuobe-soul", file: "", trigger: "", referenceId: "ref" }], cloudSoul)).toBeUndefined();
  });

  it("puts the @character's LoRA first on Fuobe Soul, at the character strength's scale", () => {
    const el = maya([lora({ url: "https://v3.fal.media/maya.safetensors", own: true })]);
    const { request } = applyMentions({ feature: "image", modelId: soul.id, engine: "cloud", prompt: "@Maya on a beach" }, cloudSoul, [el]);
    expect(request.loras).toEqual([{ file: "fuobe/maya-abc123.safetensors", url: "https://v3.fal.media/maya.safetensors", strength: 1, trigger: "myfz", own: true }]);
    expect(request.inputs?.images).toBeUndefined();
    const plan = planGeneration({ ...request, params: { extra: { characterStrength: 0.5 } } }, (id) => (id === soul.id ? cloudSoul : getModel(id)), getPreset);
    expect(plan.loras[0]).toMatchObject({ file: "fuobe/maya-abc123.safetensors", strength: 0.8 });
    expect(plan.prompt).toMatch(/myfz Maya on a beach/);
  });

  it("makes a trained moodboard the look on Fuobe Soul: its LoRA alone, no look words, tail or grade", () => {
    const style = { file: "fuobe/dusk-a1.safetensors", strength: 1, trigger: "dskfz", own: true as const };
    const r = soulRecipe("soul", "dskfz Dusk, a lighthouse at night", { look: OWN_LOOK, userLoras: [style] });
    expect(r.loras).toEqual([style]);
    expect(r.prompt).toBe("dskfz Dusk, a lighthouse at night.");
    expect(r.grade).toBeUndefined();
    expect(soulPostSteps("fuobe-soul", OWN_LOOK)).toBeUndefined();
  });

  it("falls back to reference photos when no LoRA runs there", () => {
    const el = maya([lora({ engine: "open" })]);
    const nb = getModel("nano-banana-pro")!;
    expect(applyMentions({ feature: "image", modelId: nb.id, prompt: "@Maya" }, nb, [el]).request.inputs?.images).toEqual(["/api/files/a.png", "/api/files/b.png"]);
  });
});
