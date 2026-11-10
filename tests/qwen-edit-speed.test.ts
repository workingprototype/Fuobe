import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GenerationRequest, GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";
import type { RequirementIndex } from "@/lib/gpu/types";
import { tempDir } from "./helpers/temp-dir";

// Qwen-Image-Edit 2511's Options → Speed: Fast (the 4-step Lightning LoRA graph) by default, Best (the 40-step graph) when
// asked. The provider, the GPU pre-flight, a worker's ticket and the billing facts all name the same graph.
const tmp = tempDir("fuobe-qwen-edit-speed-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow, loadManifest, getWorkflow } = await import("@/server/providers/comfyui");
const { getModel } = await import("@/lib/catalog");
const { controlsFor } = await import("@/lib/composer");
const { requestWorkflowId, resolveWorkflowId } = await import("@/lib/comfy-variants");
const S = await import("@/lib/qwen-edit-speed");
const { composeWorkflow, withoutSaveMetadata } = await import("@/lib/comfy-compose");
const { composeTicket, ticketFor } = await import("@/lib/ticket-compose");
const { computeCatalogVersion } = await import("@/server/computer/catalog-version");
const { laneOf } = await import("@/lib/lanes");
const { writeSnapshot, dropSnapshots } = await import("@/server/gpu/snapshots");
const { gateGeneration } = await import("@/server/gpu/gate");
const { runFacts } = await import("@/server/hosted");

const BASE = "qwen-image-edit-2511-multi";
const FAST = "qwen-image-edit-2511-multi-fast";
const LORA = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors";
const LORA_URL = `https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/${LORA}`;

const LIBRARY = path.join(process.cwd(), "workflows/comfyui");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(LIBRARY, f), "utf8"));
const manifest = read("manifest.json") as { workflows: ManifestWorkflow[] };
const entry = (id: string) => manifest.workflows.find((w) => w.id === id)!;
const graph = (id: string) => read(`${id}.json`) as ComfyWorkflow;
const index = read("requirements.json") as RequirementIndex;
const pins = read("model-pins.json") as Record<string, { revision: string; sizeBytes: number; sha256: string }>;
const has = (id: string) => manifest.workflows.some((w) => w.id === id);
const variant = (endpoint: string, extra: Record<string, unknown>, op = "edit") => resolveWorkflowId(endpoint, { op, clips: 0, images: 1, audio2: false, extra, has });
const ofClass = (wf: ComfyWorkflow, cls: string) => Object.entries(wf).filter(([, n]) => n.class_type === cls);
const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

async function prepare(input: GenInput) {
  return prepareWorkflow(BASE, { seed: 7, ...input }, {
    generationId: "g-qe",
    op: "edit",
    upload: async (_d, _t, name) => `up_${name}`,
    media: () => ({ width: 1184, height: 880 }) as never,
    serverRam: async () => undefined,
  });
}

describe("Qwen-Image-Edit 2511's Options → Speed", () => {
  it("offers Fast (the default) and Best under Options, and keeps the model's name", () => {
    const m = getModel("oss-qwen-edit")!;
    expect(m.name).toBe("Qwen-Image-Edit 2511");
    expect(m.routes).toEqual([expect.objectContaining({ provider: "comfyui", op: "edit", endpoint: BASE })]);
    expect(m.options.controls).toEqual([S.QWEN_EDIT_SPEED]);
    expect(S.QWEN_EDIT_SPEED).toMatchObject({ param: "speed", values: ["fast", "best"], default: "fast" });
    expect(S.QWEN_EDIT_SPEED.labels).toEqual({ fast: "Fast · about 4 steps", best: "Best · 40 steps, slower" });
    expect(controlsFor(m.options.controls!, "edit").map((c) => c.values)).toEqual([["fast", "best"]]);
  });

  it("runs the Fast graph when no speed is sent or Fast is, and the base graph on Best", () => {
    expect(variant(BASE, {})).toBe(FAST);
    expect(variant(BASE, { speed: "fast" })).toBe(FAST);
    expect(variant(BASE, { speed: "best" })).toBe(BASE);
    // Without the Fast graph in the library, the base graph runs.
    expect(resolveWorkflowId(BASE, { op: "edit", clips: 0, images: 1, audio2: false, extra: {}, has: (id) => id !== FAST && has(id) })).toBe(BASE);
    // Other graphs never move: Qwen-Image 2.1 keeps its own speeds, and its default stays Full.
    expect(variant("qwen-image-21-edit", {})).toBe("qwen-image-21-edit");
    expect(variant("qwen-image-21-edit", { speed: "fast" })).toBe("qwen-image-21-edit-fast");
    expect(variant("qwen-image-21-edit", { speed: "best" })).toBe("qwen-image-21-edit");
    expect(variant("style-ref-qwen-edit-2511", {}, "style-reference")).toBe("style-ref-qwen-edit-2511");
  });
});

describe("the Fast graph", () => {
  it("is the base graph with one Lightning LoRA after the model loader, 4 steps at CFG 1, and nothing else changed", () => {
    const fast = graph(FAST);
    const base = graph(BASE);
    const loras = ofClass(fast, "LoraLoaderModelOnly");
    expect(loras).toHaveLength(1);
    const [loraId, lora] = loras[0];
    expect(lora.inputs).toEqual({ lora_name: LORA, strength_model: 1, model: ["170:161", 0] });
    expect(fast["170:161"].class_type).toBe("UNETLoader");
    expect(fast["170:145"]).toEqual({ ...base["170:145"], inputs: { ...base["170:145"].inputs, model: [loraId, 0] } });
    expect(fast["170:166"].inputs.value).toBe(4);
    expect(fast["170:154"].inputs.value).toBe(1);
    const sampler = ofClass(fast, "KSampler")[0][1].inputs;
    expect(sampler).toMatchObject({ sampler_name: "euler", scheduler: "simple", steps: ["170:166", 0], cfg: ["170:154", 0] });
    for (const [id, n] of Object.entries(base)) {
      if (["170:145", "170:166", "170:154", "9"].includes(id)) continue;
      expect(fast[id], id).toEqual(n);
    }
    expect(Object.keys(fast).sort()).toEqual([...Object.keys(base), loraId].sort());
    expect(fast["9"].inputs.filename_prefix).toBe(`fuobe/${FAST}`);
  });

  it("leaves Best as it was: 40 steps at CFG 4, no LoRA", () => {
    const base = graph(BASE);
    expect(ofClass(base, "LoraLoaderModelOnly")).toHaveLength(0);
    expect(base["170:166"].inputs.value).toBe(40);
    expect(base["170:154"].inputs.value).toBe(4);
    expect(base["170:145"].inputs.model).toEqual(["170:161", 0]);
    expect(entry(BASE).bindings.steps).toEqual([{ node: "170:166", input: "value" }]);
    expect(entry(BASE).bindings.cfg).toEqual([{ node: "170:154", input: "value" }]);
  });

  it("binds no steps or CFG, lists the LoRA as a pinned file, and shares the base graph's lane", () => {
    const e = entry(FAST);
    expect(e.bindings.steps).toBeUndefined();
    expect(e.bindings.cfg).toBeUndefined();
    expect(Object.keys(e.bindings).sort()).toEqual(Object.keys(entry(BASE).bindings).filter((k) => k !== "steps" && k !== "cfg").sort());
    expect(e.models.find((m) => m.file === LORA)).toMatchObject({ folder: "loras", url: LORA_URL });
    expect(pins[LORA_URL].sha256).toMatch(/^[0-9a-f]{64}$/);
    const key = `loras/${LORA}`;
    expect(index.workflows[FAST].files).toEqual([...index.workflows[BASE].files, key].sort());
    expect(index.files[key]).toMatchObject({ sizeBytes: pins[LORA_URL].sizeBytes, pinnedUrl: expect.stringContaining(pins[LORA_URL].revision), loaders: [["LoraLoaderModelOnly", "lora_name"]] });
    expect(index.workflows[FAST].core).toContain("LoraLoaderModelOnly");
    expect(laneOf(index, FAST, sha)).toBe(laneOf(index, BASE, sha));
  });
});

describe("a Qwen-Image-Edit 2511 run on your GPU", () => {
  it("runs Fast by default with the LoRA's 4 steps and CFG 1, whatever steps and CFG it asks for", async () => {
    const { manifest: m, workflow: wf } = await prepare({ prompt: "make it night", images: ["/api/files/a.png"], extra: { steps: 30, cfg: 6 } });
    expect(m.id).toBe(FAST);
    expect(wf["170:166"].inputs.value).toBe(4);
    expect(wf["170:154"].inputs.value).toBe(1);
    expect(wf["170:169"].inputs.seed).toBe(7);
    expect(JSON.stringify(wf)).not.toMatch(/"speed"/);
  });

  it("runs Best's 40-step graph when asked, where steps and CFG still apply", async () => {
    const best = await prepare({ prompt: "make it night", images: ["/api/files/a.png"], extra: { speed: "best" } });
    expect(best.manifest.id).toBe(BASE);
    expect(best.workflow["170:166"].inputs.value).toBe(40);
    expect(best.workflow["170:154"].inputs.value).toBe(4);
    expect(JSON.stringify(best.workflow)).not.toMatch(/"speed"/);
    const tuned = await prepare({ prompt: "make it night", images: ["/api/files/a.png"], extra: { speed: "best", steps: 30, cfg: 3.5 } });
    expect(tuned.workflow["170:166"].inputs.value).toBe(30);
    expect(tuned.workflow["170:154"].inputs.value).toBe(3.5);
  });

  it("goes to a worker as a ticket that composes the Fast graph there, as the studio does", async () => {
    const version = computeCatalogVersion(process.cwd())!;
    const catalog = { has: (id: string) => loadManifest().workflows.some((w) => w.id === id), get: getWorkflow };
    const photo = "fuobe_t000000001.png";
    const files = new Map([[photo, { sha256: sha(photo), contentType: "image/png", facts: { container: "image", width: 1184, height: 880, hasVideo: false, hasAudio: false } }]]);
    for (const extra of [undefined, { speed: "best" }]) {
      const input: GenInput = { prompt: "make it night", images: [photo], seed: 11, ...(extra && { extra }) };
      const studio = await composeWorkflow(BASE, input, { generationId: "g-ticket", op: "edit", catalog, sent: [], accountOnInstall: true, made: async () => "", media: (n) => files.get(n)?.facts as never });
      const ticket = ticketFor(
        { endpoint: BASE, op: "edit", input, made: [] },
        { catalogVersion: version, sent: [], file: (n) => files.get(n) ?? null, facts: (n) => files.get(n)?.facts as never, outputs: { count: 1, kind: "image" }, size: studio.size },
      );
      const worker = await composeTicket({ ticket: JSON.parse(JSON.stringify(ticket)), generationId: "g-ticket", inputs: [{ name: photo, sha256: sha(photo) }] }, { catalog, catalogVersion: version });
      expect(worker.ok && worker.workflowId).toBe(extra ? BASE : FAST);
      expect(worker.ok && worker.graph).toEqual(withoutSaveMetadata(studio.workflow));
    }
  });
});

/** The install's last GPU check: a 32 GB card that has the base graph's files, and the LoRA when `lora`. */
const INSTALL = { kind: "install", key: "install", via: "server" } as const;
function checked(lora: boolean) {
  const at = Date.now();
  const models: Record<string, { have: Record<string, number | null>; total: number }> = {};
  for (const key of [...index.workflows[BASE].files, ...(lora ? [`loras/${LORA}`] : [])]) {
    const [folder, file] = key.split("/");
    (models[folder] ??= { have: {}, total: 0 }).have[file] = null;
  }
  models.loras ??= { have: {}, total: 0 };
  for (const x of Object.values(models)) x.total = Object.keys(x.have).length;
  writeSnapshot(INSTALL, {
    v: 1,
    via: "server",
    checkedAt: at,
    tookMs: 5,
    reachable: true,
    devices: [{ name: "GPU", type: "cuda", index: 0, vramTotal: 32 * 2 ** 30, vramFree: 32 * 2 ** 30 }],
    manager: { api: "none" },
    nodes: { have: [], missing: [], total: 1, readAt: at, how: "object_info" },
    combos: {},
    packs: {},
    models,
    loras: {},
    fingerprint: "x",
    errors: [],
  } as never);
}

describe("the GPU pre-flight on a Qwen-Image-Edit 2511 run", () => {
  const request = (extra?: Record<string, unknown>): GenerationRequest => ({ feature: "image", modelId: "oss-qwen-edit", prompt: "make it night", inputs: { images: ["/api/files/a.png"] }, ...(extra && { params: { extra } }) });
  const gate = (extra?: Record<string, unknown>) => gateGeneration(INSTALL, { request: request(extra), route: { provider: "comfyui", endpoint: BASE }, op: "edit", modelId: "oss-qwen-edit", actor: "owner" });

  it("checks the graph the run takes: Fast needs the LoRA, Best doesn't", async () => {
    expect(requestWorkflowId(BASE, request(), { op: "edit", has }).id).toBe(FAST);
    expect(requestWorkflowId(BASE, request({ speed: "best" }), { op: "edit", has }).id).toBe(BASE);
    checked(false);
    try {
      expect(await gate()).toMatchObject({ ok: true, warning: expect.stringMatching(/1 more thing/) });
      expect(await gate({ speed: "fast" })).toMatchObject({ ok: true, warning: expect.stringMatching(/1 more thing/) });
      expect(await gate({ speed: "best" })).toEqual({ ok: true });
      checked(true);
      expect(await gate()).toEqual({ ok: true });
    } finally {
      dropSnapshots("install");
    }
  });
});

describe("the billing facts of a run", () => {
  const planned = (endpoint: string | undefined, engine: "open" | "cloud", providerId: string) => ({
    model: { id: "oss-qwen-edit", kind: "image", engine },
    op: "edit",
    jobs: 1,
    outputs: 1,
    providerId,
    costUsd: null,
    loras: { applied: [] },
    ...(endpoint && { route: { endpoint } }),
  });
  const req = (extra?: Record<string, unknown>): GenerationRequest => ({ feature: "image", modelId: "oss-qwen-edit", prompt: "make it night", inputs: { images: ["/api/files/a.png"] }, ...(extra && { params: { extra } }) });

  it("name the graph an open-engine run resolves to (RunFacts.workflow), and nothing for other runs", () => {
    expect(runFacts(req(), planned(BASE, "open", "comfyui"), "image").workflow).toBe(FAST);
    expect(runFacts(req({ speed: "fast" }), planned(BASE, "open", "comfyui"), "image").workflow).toBe(FAST);
    expect(runFacts(req({ speed: "best" }), planned(BASE, "open", "comfyui"), "image").workflow).toBe(BASE);
    expect(runFacts(req(), planned("fal-ai/some-edit", "cloud", "fal"), "image")).not.toHaveProperty("workflow");
    expect(runFacts(req(), planned(undefined, "open", "local"), "image")).not.toHaveProperty("workflow");
  });
});
