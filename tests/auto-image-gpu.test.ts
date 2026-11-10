import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import type { GpuInventory, RequirementIndex } from "@/lib/gpu/types";
import { tempDir } from "./helpers/temp-dir";

// Auto on a ComfyUI the GPU check reads (the owner's own server here; an account's own GPU and a computer read the same
// way): MiniMax H3 Image is planned only where the last check reads a card with the VRAM its lane needs (about 32 GB) and
// its files; elsewhere the run starts on the next model, and a later fallback never goes to it either. With no check to
// read, MiniMax H3 Image is tried, and its failure moves to the next model. This install's GPUs on the workers:
// tests/auto-image-pool.test.ts. Stand-ins only: nothing here reaches a GPU.
vi.setConfig({ testTimeout: 60_000 });
process.env.FUOBE_DATA_DIR = tempDir("fuobe-auto-image-gpu-");
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: runs fall back to the demo
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.FUOBE_GPU_PREFLIGHT;

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration, previewGeneration } = await import("@/server/generations");
const { mockProvider } = await import("@/server/providers/mock");
const { changeAccess } = await import("@/server/model-access");
const { writeSnapshot, dropSnapshots } = await import("@/server/gpu/snapshots");
const { autoFitsHere } = await import("@/server/auto-gpu");
const { AUTO_IMAGE } = await import("@/lib/auto-image");

const index = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/requirements.json"), "utf8")) as RequirementIndex;
const H3 = "oss-minimax-h3-image";
const H3_FILES = index.workflows["minimax-h3-image-t2i"].files.map((k) => `${index.files[k].folder}/${index.files[k].file}`);
const GIB = 2 ** 30;
const INSTALL = { kind: "install", key: "install", via: "server" } as const;

/** The install's last GPU check: one graphics card of `gb` (none: a CPU), with these model files. */
function inventory(o: { gb?: number; files?: string[] }): GpuInventory {
  const at = Date.now();
  const models: GpuInventory["models"] = { diffusion_models: { have: {}, total: 0 }, text_encoders: { have: {}, total: 0 }, vae: { have: {}, total: 0 }, loras: { have: {}, total: 0 } };
  for (const key of o.files ?? []) {
    const [folder, file] = key.split("/");
    (models[folder] ??= { have: {}, total: 0 }).have[file] = null;
  }
  for (const m of Object.values(models)) m.total = Object.keys(m.have).length;
  return {
    v: 1,
    via: "server",
    checkedAt: at,
    tookMs: 5,
    reachable: true,
    comfy: { version: "0.45.0", os: "posix", torch: "2.12.0+cu130", embeddedPython: false, deployEnv: "local-git", flags: {} as never },
    devices: o.gb === undefined ? [] : [{ name: "cuda:0 NVIDIA GeForce RTX : cudaMallocAsync", type: "cuda", index: 0, vramTotal: o.gb * GIB, vramFree: o.gb * GIB }],
    manager: { api: "none" },
    nodes: { have: [], missing: [], total: 1, readAt: at, how: "object_info" },
    combos: {},
    packs: {},
    models,
    loras: {},
    fingerprint: "x",
    errors: [],
  } as never;
}
const checked = (o: Parameters<typeof inventory>[0]) => writeSnapshot(INSTALL, inventory(o));
const picked = (prompt: string) => previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt }).model.id;

let failing = new Set<string>();
let handed: string[] = [];
const submit = mockProvider.submit;
const poll = mockProvider.poll;

beforeAll(() => setSetting("demoMode", "auto"));
beforeEach(() => {
  setSetting("enhanceProvider", "none");
  setSetting("autoImagePatterns", "");
  changeAccess([{ kind: "reset" }]);
  dropSnapshots("install");
  failing = new Set();
  handed = [];
  mockProvider.submit = async (ctx) => {
    handed.push(ctx.model.id);
    return submit(ctx);
  };
  mockProvider.poll = async (ctx) => (failing.has(ctx.model.id) ? { state: "failed", error: "Out of memory on the GPU" } : poll(ctx));
});
afterEach(() => {
  mockProvider.submit = submit;
  mockProvider.poll = poll;
});

async function run(prompt: string): Promise<Generation> {
  const made = createGenerations({ feature: "image", modelId: AUTO_IMAGE, prompt });
  const end = Date.now() + 30_000;
  for (;;) {
    const g = getGeneration(made[0].id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`${g.id} is still ${g.status}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("Auto and the GPU's size and files", () => {
  it("a 32 GB card with MiniMax H3 Image's files: plain words and lettering start on it", () => {
    checked({ gb: 32, files: H3_FILES });
    expect(autoFitsHere(H3, "t2i")).toBe(true);
    expect(picked("a red fox in deep snow")).toBe(H3);
    expect(picked('a poster that says "GRAND OPENING"')).toBe(H3);
    // A prompt the patterns match keeps Krea 2 Realism first.
    expect(picked("editorial photo of a model in swimwear on a yacht")).toBe("oss-krea2-realism");
    // A larger card too.
    checked({ gb: 96, files: H3_FILES });
    expect(picked("a red fox in deep snow")).toBe(H3);
  });

  it("a smaller card: Krea 2 Realism for plain words, MOSS-Image for lettering", () => {
    for (const gb of [24, 16, 12]) {
      checked({ gb, files: H3_FILES });
      expect(autoFitsHere(H3, "t2i"), `${gb} GB`).toBe(false);
      expect(picked("a red fox in deep snow"), `${gb} GB`).toBe("oss-krea2-realism");
      expect(picked('a poster that says "GRAND OPENING"'), `${gb} GB`).toBe("oss-moss-image");
    }
  });

  it("a large card without MiniMax H3 Image's files, or with only some: the next model", () => {
    checked({ gb: 48 });
    expect(autoFitsHere(H3, "t2i")).toBe(false);
    expect(picked("a red fox in deep snow")).toBe("oss-krea2-realism");
    checked({ gb: 48, files: H3_FILES.slice(0, 1) });
    expect(picked("a red fox in deep snow")).toBe("oss-krea2-realism");
    expect(picked('a sign that says "OPEN"')).toBe("oss-moss-image");
  });

  it("a ComfyUI on its CPU: the next model", () => {
    checked({ files: H3_FILES });
    expect(autoFitsHere(H3, "t2i")).toBe(false);
    expect(picked("a red fox in deep snow")).toBe("oss-krea2-realism");
  });

  it("no check to read: MiniMax H3 Image is tried", () => {
    expect(autoFitsHere(H3, "t2i")).toBe(true);
    expect(picked("a red fox in deep snow")).toBe(H3);
  });

  it("only MiniMax H3 Image switched on: it is planned all the same, rather than no model", () => {
    checked({ gb: 16 });
    changeAccess([{ kind: "model", id: "oss-krea2-realism", on: false }, { kind: "model", id: "oss-moss-image", on: false }]);
    expect(picked("a red fox in deep snow")).toBe(H3);
  });

  it("on a smaller card, a fallback never goes to MiniMax H3 Image: Krea 2 Realism fails, MOSS-Image makes it", async () => {
    checked({ gb: 24, files: H3_FILES });
    failing = new Set(["oss-krea2-realism"]);
    const g = await run("a red fox in deep snow");
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed).toEqual(["oss-krea2-realism", "oss-moss-image"]);
    expect(g.request.auto).toEqual({ model: "oss-moss-image", why: "fallback" });
  });

  it("on a card that takes it, MiniMax H3 Image fails: Krea 2 Realism makes it; lettering goes to MOSS-Image", async () => {
    checked({ gb: 32, files: H3_FILES });
    failing = new Set([H3]);
    const g = await run("a red fox in deep snow");
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed).toEqual([H3, "oss-krea2-realism"]);
    handed = [];
    const t = await run('a poster that says "GRAND OPENING"');
    expect(t.status, t.error ?? "").toBe("succeeded");
    expect(handed).toEqual([H3, "oss-moss-image"]);
    expect(t.request.auto).toEqual({ model: "oss-moss-image", why: "fallback" });
  });
});
