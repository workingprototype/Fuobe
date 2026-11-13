import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildIndex, loadInputs } from "../scripts/comfy/build-requirements.mjs";
import { parseArgv } from "@/lib/gpu/argv";
import { emptyInventory } from "@/lib/gpu/gather";
import { fileChoices, genInside, hasVariants, pickFiles, swapGraphFiles, type FileChoice } from "@/lib/gpu/model-variants";
import { filesHere, workflowReadiness } from "@/lib/gpu/readiness";
import { parseIndex } from "@/lib/gpu/requirements";
import type { FileKey, GpuInventory, RequirementIndex } from "@/lib/gpu/types";
import { composeWorkflow, withoutSaveMetadata, type ComposeCatalog } from "@/lib/comfy-compose";
import { ticketProblem, type JobTicket } from "@/lib/job-ticket";
import { lanesFor, type Inventory } from "@/lib/lanes";
import { composeTicket, graphFingerprint, ticketFor } from "@/lib/ticket-compose";

/**
 * Model variants (workflows/comfyui/model-variants.json, src/lib/gpu/model-variants.ts): other files of the same models a
 * workflow may load in place of some of its own. The build refuses a variant that could load a file outside the catalog's
 * pins; a GPU runs a variant made for its card's generation when it has its files, its own files otherwise; the graph
 * gets the variant's files in its loader inputs only; a person's own GPU counts as ready with a variant's files.
 */

vi.setConfig({ testTimeout: 60_000 });

const ROOT = path.resolve(__dirname, "..");
const LIBRARY = path.join(ROOT, "workflows/comfyui");
const idx: RequirementIndex = parseIndex(JSON.parse(fs.readFileSync(path.join(LIBRARY, "requirements.json"), "utf8")));

const KREA = "krea2-turbo-t2i";
const FP8 = "diffusion_models/krea2_turbo_fp8_scaled.safetensors" as FileKey;
const INT8 = "diffusion_models/krea2_turbo_int8_convrot.safetensors" as FileKey;
const TE_FP8 = "text_encoders/qwen3vl_4b_fp8_scaled.safetensors" as FileKey;
const TE_INT8 = "text_encoders/qwen3vl_4b_int8_convrot.safetensors" as FileKey;
const VAE = "vae/qwen_image_vae.safetensors" as FileKey;

/** The committed inputs with model-variants.json replaced. */
const build = (variants: object[]) => buildIndex({ ...loadInputs(LIBRARY), variants: { variants } });
const variant = (o: Record<string, unknown> = {}) => ({ id: "int8", gpuGen: { min: "8.0", max: "8.6" }, workflows: [KREA], files: { [FP8]: INT8 }, ...o });

describe("the catalog's variants (build-requirements.mjs)", () => {
  it("puts each workflow's variants in requirements.json, in the order of model-variants.json", () => {
    expect(idx.workflows[KREA].variants).toEqual([{ id: "int8", files: { [FP8]: INT8, [TE_FP8]: TE_INT8 }, gpuGen: { min: "8.0", max: "8.6" } }]);
    // The Krea 2 workflows that load the fp8 diffusion file all carry it.
    for (const id of ["krea2-edit-general", "krea2-inpaint", "krea2-turbo-i2i"]) expect(idx.workflows[id].variants?.map((v) => v.id), id).toEqual(["int8"]);
    // A workflow with none keeps no field.
    expect("variants" in idx.workflows["sdxl-t2i"]).toBe(false);
    expect("variants" in idx.workflows["ideogram4-t2i"]).toBe(false);
  });

  it("swaps only to pinned catalog files, each in the same model folder, read by the same loader inputs", () => {
    const pins = loadInputs(LIBRARY).pins as Record<string, { sha256?: string; sizeBytes?: number }>;
    for (const [id, wf] of Object.entries(idx.workflows)) {
      for (const v of wf.variants ?? []) {
        for (const [from, to] of Object.entries(v.files) as [FileKey, FileKey][]) {
          const a = idx.files[from];
          const b = idx.files[to];
          expect(wf.files, `${id} ${v.id}`).toContain(from);
          expect(b.folder, `${id} ${v.id}`).toBe(a.folder);
          expect(pins[b.url]?.sha256 ?? b.sha256, `${to}`).toMatch(/^[0-9a-f]{64}$/);
          expect(pins[b.url]?.sizeBytes, `${to}`).toBe(b.sizeBytes);
          // A smaller build no graph loads is one of the workflow's optional files, and fills the old file's slot.
          if (!b.loaders?.length) {
            expect(wf.optional, `${id} ${to}`).toContain(to);
            continue;
          }
          // Each loader input that reads the old file in this workflow's graph reads the new one in some catalog workflow.
          const graph = JSON.parse(fs.readFileSync(path.join(LIBRARY, `${id}.json`), "utf8")) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
          const slots = (a.loaders ?? []).filter(([cls, input]) => Object.values(graph).some((n) => n.class_type === cls && n.inputs[input] === a.file));
          expect(slots.length, `${id} ${from}`).toBeGreaterThan(0);
          for (const l of slots) expect(b.loaders?.map((x) => x.join(".")), `${to}`).toContain(l.join("."));
        }
      }
    }
  });

  it("refuses a variant whose new file has no pinned size and SHA-256", () => {
    const inputs = loadInputs(LIBRARY);
    const url = idx.files[INT8].url;
    const pins = { ...inputs.pins } as Record<string, { revision: string; sizeBytes: number; sha256?: string }>;
    pins[url] = { ...pins[url], sha256: undefined };
    expect(() => buildIndex({ ...inputs, pins, variants: { variants: [variant()] } })).toThrow(`${INT8} has no pinned size and SHA-256`);
    // No pin at all (its size is then only the manifest's guess).
    delete pins[url];
    expect(() => buildIndex({ ...inputs, pins, variants: { variants: [variant()] } })).toThrow(`${INT8} has no pinned size and SHA-256`);
  });

  it("refuses a file that isn't in the catalog, one in another model folder, and one the workflow doesn't load", () => {
    expect(() => build([variant({ files: { [FP8]: "diffusion_models/made_up_int8.safetensors" } })])).toThrow("diffusion_models/made_up_int8.safetensors isn't a file of the catalog");
    expect(() => build([variant({ files: { [FP8]: TE_INT8 } })])).toThrow(`${TE_INT8} is in another model folder than ${FP8}`);
    expect(() => build([variant({ workflows: ["style-ref-krea2"] })])).toThrow(`${FP8} isn't one of style-ref-krea2's files`);
    expect(() => build([variant({ workflows: ["no-such-workflow"] })])).toThrow("no-such-workflow isn't a workflow of the manifest");
  });

  it("refuses a file that the workflow's loader input reads in no catalog workflow", () => {
    // clip_l is read by DualCLIPLoader only: Krea 2's CLIPLoader.clip_name never loads it.
    expect(() => build([variant({ files: { [TE_FP8]: "text_encoders/clip_l.safetensors" } })])).toThrow("loads text_encoders/qwen3vl_4b_fp8_scaled.safetensors with CLIPLoader.clip_name, which reads text_encoders/clip_l.safetensors in no workflow of the catalog");
  });

  it("takes a smaller build that no graph loads when the workflow names it as an optional file, in the slot it stands in for", () => {
    const inputs = loadInputs(LIBRARY);
    const url = "https://huggingface.co/example/krea-2-small/resolve/main/krea2_turbo_small_int4.safetensors";
    const SMALL = "diffusion_models/krea2_turbo_small_int4.safetensors" as FileKey;
    const manifest = structuredClone(inputs.manifest);
    manifest.workflows.find((w: { id: string }) => w.id === KREA).models.push({ file: "krea2_turbo_small_int4.safetensors", folder: "diffusion_models", url, sizeGb: 7, optional: true });
    const pins = { ...inputs.pins, [url]: { revision: "a".repeat(40), sizeBytes: 7_000_000_000, sha256: "b".repeat(64) } };
    const withSmall = (v: object) => buildIndex({ ...inputs, manifest, pins, variants: { variants: [v] } });
    const out = withSmall(variant({ id: "int4", files: { [FP8]: SMALL } }));
    expect(out.workflows[KREA].variants).toEqual([{ id: "int4", gpuGen: { min: "8.0", max: "8.6" }, files: { [FP8]: SMALL } }]);
    expect(out.files[SMALL].loaders).toBeUndefined();
    // The graph gets it in the old file's loader input.
    const graph = JSON.parse(fs.readFileSync(path.join(LIBRARY, `${KREA}.json`), "utf8"));
    expect(JSON.stringify(swapGraphFiles(graph, { [FP8]: SMALL }, out))).toContain("krea2_turbo_small_int4.safetensors");
    // A workflow that doesn't name it among its own optional files can't swap to it.
    expect(() => withSmall(variant({ id: "int4", workflows: ["krea2-turbo-i2i"], files: { [FP8]: SMALL } }))).toThrow(
      "loads diffusion_models/krea2_turbo_fp8_scaled.safetensors with UNETLoader.unet_name, which reads diffusion_models/krea2_turbo_small_int4.safetensors in no workflow of the catalog",
    );
  });

  it("refuses a malformed entry: its id, its card generations, its VRAM, two of one name", () => {
    expect(() => build([variant({ id: "Int 8" })])).toThrow(/id must be lower case/);
    expect(() => build([variant({ gpuGen: { min: "8.6", max: "8.0" } })])).toThrow(/gpuGen must be/);
    expect(() => build([variant({ gpuGen: { min: "sm86", max: "8.6" } })])).toThrow(/gpuGen must be/);
    expect(() => build([variant({ vramGb: -2 })])).toThrow(/vramGb must be a number/);
    expect(() => build([variant({ files: {} })])).toThrow(/files must map/);
    expect(() => build([variant(), variant()])).toThrow(`${KREA} has two variants named int8`);
    // A good one builds, with its own VRAM and no card generation.
    const ok = build([variant({ gpuGen: undefined, vramGb: 12 })]);
    expect(ok.workflows[KREA].variants).toEqual([{ id: "int8", files: { [FP8]: INT8 }, vramGb: 12 }]);
  });
});

const own = (c: FileChoice | null) => c?.variant ?? "own";

describe("which files a GPU runs (pickFiles)", () => {
  const choices = fileChoices(idx, KREA);
  const files = (keys: string[]) => (k: FileKey) => keys.includes(k);
  const BOTH = [FP8, TE_FP8, INT8, TE_INT8, VAE];
  const BASE = [FP8, TE_FP8, VAE];
  const VARIANT = [INT8, TE_INT8, VAE];

  it("lists the workflow's own files first, then each variant with its files in place", () => {
    expect(choices.map((c) => c.variant)).toEqual([null, "int8"]);
    expect(choices[1].files.sort()).toEqual([INT8, TE_INT8, VAE].sort());
    expect(choices[1].vramGb).toBe(idx.workflows[KREA].vramGb);
    expect(hasVariants(idx, KREA)).toBe(true);
    expect(hasVariants(idx, "sdxl-t2i")).toBe(false);
    expect(fileChoices(idx, "sdxl-t2i").map((c) => c.variant)).toEqual([null]);
  });

  it("a card of the variant's generation runs the variant when it has its files; another card runs the workflow's own", () => {
    expect(own(pickFiles(choices, { gpuGen: "8.6", has: files(BOTH), variants: true }))).toBe("int8");
    expect(own(pickFiles(choices, { gpuGen: "8.0", has: files(BOTH), variants: true }))).toBe("int8");
    expect(own(pickFiles(choices, { gpuGen: "8.9", has: files(BOTH), variants: true }))).toBe("own");
    expect(own(pickFiles(choices, { gpuGen: "12.0", has: files(BOTH), variants: true }))).toBe("own");
  });

  it("falls back to whichever files it has: its own on the variant's card, the variant on another card", () => {
    expect(own(pickFiles(choices, { gpuGen: "8.6", has: files(BASE), variants: true }))).toBe("own");
    expect(own(pickFiles(choices, { gpuGen: "12.0", has: files(VARIANT), variants: true }))).toBe("int8");
    // An unknown card: its own files when it has them, else a variant it has.
    expect(own(pickFiles(choices, { gpuGen: null, has: files(BOTH), variants: true }))).toBe("own");
    expect(own(pickFiles(choices, { has: files(VARIANT), variants: true }))).toBe("int8");
    // Part of a variant's files is no variant.
    expect(pickFiles(choices, { gpuGen: "8.6", has: files([INT8, TE_FP8]), variants: true })).toBeNull();
  });

  it("a GPU that takes no variant gets the workflow's own files only", () => {
    expect(own(pickFiles(choices, { gpuGen: "8.6", has: files(BOTH), variants: false }))).toBe("own");
    expect(pickFiles(choices, { gpuGen: "8.6", has: files(VARIANT), variants: false })).toBeNull();
  });

  it("leaves out a choice that needs more VRAM than the card has", () => {
    const tight: FileChoice[] = [choices[0], { ...choices[1], vramGb: 40 }];
    expect(own(pickFiles(tight, { gpuGen: "8.6", has: files(BOTH), fits: (gb) => gb <= 24, variants: true }))).toBe("own");
    expect(pickFiles(tight, { gpuGen: "8.6", has: files(VARIANT), fits: (gb) => gb <= 24, variants: true })).toBeNull();
  });

  it("reads card generations as numbers", () => {
    expect(genInside("8.6", { min: "8.0", max: "8.6" })).toBe(true);
    expect(genInside("8.10", { min: "8.0", max: "8.6" })).toBe(false);
    expect(genInside("12.0", { min: "10.0", max: "12.1" })).toBe(true);
    expect(genInside(null, { min: "8.0", max: "8.6" })).toBe(false);
    expect(genInside("8.6", undefined)).toBe(false);
  });
});

describe("the graph with a variant's files (swapGraphFiles)", () => {
  const graph = JSON.parse(fs.readFileSync(path.join(LIBRARY, `${KREA}.json`), "utf8")) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  const swap = idx.workflows[KREA].variants![0].files;

  it("writes the variant's files into the loader inputs only, and leaves the graph it was given as it was", () => {
    const before = JSON.stringify(graph);
    const withName: typeof graph = { ...graph, x: { class_type: "SaveImage", inputs: { filename_prefix: "krea2_turbo_fp8_scaled.safetensors" } } };
    const out = swapGraphFiles(withName, swap, idx);
    expect(out["10"].inputs.unet_name).toBe("krea2_turbo_int8_convrot.safetensors");
    expect(out["11"].inputs.clip_name).toBe("qwen3vl_4b_int8_convrot.safetensors");
    expect(out["12"]).toBe(withName["12"]);
    // A value that only looks like the file, outside a loader input, stays.
    expect(out.x.inputs.filename_prefix).toBe("krea2_turbo_fp8_scaled.safetensors");
    expect(JSON.stringify(graph)).toBe(before);
    expect(swapGraphFiles(graph, {}, idx)).toBe(graph);
  });

  it("refuses a swap that names a file the catalog doesn't have", () => {
    expect(() => swapGraphFiles(graph, { [FP8]: "diffusion_models/other.safetensors" as FileKey }, idx)).toThrow("isn't a file of the catalog");
  });
});

/** A worker's inventory with these files (verified: size and pin) and every pack and kind of input. */
function workerInventory(keys: FileKey[]): Inventory {
  return {
    files: keys.map((k) => ({ folder: idx.files[k].folder, name: idx.files[k].file, size: idx.files[k].sizeBytes, sha256: "a".repeat(64) })),
    nodePacks: Object.keys(idx.packs).map((name) => ({ name, commit: null })),
    media: ["image", "video", "audio"],
  };
}
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

describe("what a worker can run (lanesFor)", () => {
  it("counts a workflow whose own files or one variant's files are all there", () => {
    expect(lanesFor(idx, workerInventory([FP8, TE_FP8, VAE]), sha).workflows).toContain(KREA);
    expect(lanesFor(idx, workerInventory([INT8, TE_INT8, VAE]), sha).workflows).toContain(KREA);
    const part = lanesFor(idx, workerInventory([INT8, TE_FP8, VAE]), sha);
    expect(part.workflows).not.toContain(KREA);
    // What it lacks is said in the workflow's own files.
    expect(part.missing.flatMap((m) => m.files)).toContain(FP8);
  });

  it("says which file sets of a workflow with variants it has whole", () => {
    expect(lanesFor(idx, workerInventory([FP8, TE_FP8, INT8, TE_INT8, VAE]), sha).sets[KREA]).toEqual([null, "int8"]);
    expect(lanesFor(idx, workerInventory([INT8, TE_INT8, VAE]), sha).sets[KREA]).toEqual(["int8"]);
    expect(lanesFor(idx, workerInventory([FP8, TE_FP8, VAE]), sha).sets[KREA]).toEqual([null]);
    expect(lanesFor(idx, workerInventory([INT8, VAE]), sha).sets[KREA]).toBeUndefined();
  });
});

/** A person's ComfyUI (as its GPU check reads it) with these files and every node class. */
function comfyWith(keys: FileKey[]): GpuInventory {
  const inv = emptyInventory("server", 1);
  inv.reachable = true;
  inv.comfy = { version: "0.42.1", os: "posix", embeddedPython: false, deployEnv: "local-git", flags: parseArgv(["main.py"]) };
  inv.devices = [{ name: "cuda:0 NVIDIA GeForce RTX 3080 : cudaMallocAsync", type: "cuda", index: 0, vramTotal: 24 * 2 ** 30, vramFree: 0 }];
  inv.manager = { api: "none" };
  inv.nodes = { have: [], missing: [], total: 0, readAt: 1, how: "object_info" };
  for (const folder of idx.folders) inv.models[folder] = { have: {}, total: 0 };
  for (const f of Object.values(idx.files)) for (const [cls, input] of f.loaders ?? []) inv.combos[`${cls}.${input}`] ??= [];
  for (const k of keys) {
    const f = idx.files[k];
    inv.models[f.folder].have[f.file] = f.sizeBytes;
    for (const [cls, input] of f.loaders ?? []) inv.combos[`${cls}.${input}`].push(f.file);
  }
  return inv;
}

describe("a person's own GPU (readiness)", () => {
  it("is ready with a variant's files, and asks for no file of the same model in another format", () => {
    const r = workflowReadiness(KREA, comfyWith([INT8, TE_INT8, VAE]), idx, { account: true });
    expect(r.state).toBe("ready");
    expect(r.needs).toEqual([]);
    expect(r.have.map((n) => n.file)).toEqual(expect.arrayContaining([INT8, TE_INT8, VAE]));
    expect(filesHere(KREA, comfyWith([INT8, TE_INT8, VAE]), idx)?.variant).toBe("int8");
  });

  it("runs its own files when they are there, and asks for them when neither set is whole", () => {
    expect(filesHere(KREA, comfyWith([FP8, TE_FP8, INT8, TE_INT8, VAE]), idx)?.variant).toBeNull();
    const r = workflowReadiness(KREA, comfyWith([INT8, VAE]), idx, { account: true });
    expect(r.needs.map((n) => n.file).sort()).toEqual([FP8, TE_FP8].sort());
  });
});

const { loadManifest, getWorkflow } = await import("@/server/providers/comfyui");
const { computeCatalogVersion } = await import("@/server/computer/catalog-version");

describe("a job ticket that names a variant", () => {
  const VERSION = computeCatalogVersion(ROOT)!;
  const catalog: ComposeCatalog = { has: (id) => loadManifest().workflows.some((w) => w.id === id), get: getWorkflow };
  const files = idx.workflows[KREA].variants![0].files;

  async function studio() {
    const input = { prompt: "A calm portrait in soft window light", seed: 7, numOutputs: 1 };
    const out = await composeWorkflow(KREA, input, { generationId: "variant-gen-1", op: "t2i", catalog, sent: [], accountOnInstall: true, made: async () => "none" });
    const ticket = ticketFor({ endpoint: KREA, op: "t2i", input, made: [] }, { catalogVersion: VERSION, sent: [], file: () => null, facts: () => undefined, outputs: { count: 1, kind: "image" }, size: out.size });
    return { graph: withoutSaveMetadata(out.workflow), ticket };
  }
  const compose = (ticket: JobTicket, o: { index?: RequirementIndex; version?: string } = {}) =>
    composeTicket({ ticket, generationId: "variant-gen-1", inputs: [] }, { catalog, catalogVersion: o.version ?? VERSION, ...(o.index && { index: o.index }) });

  it("composes the studio's graph, then writes in the variant's files as the worker's own catalog defines them", async () => {
    const s = await studio();
    expect(ticketProblem({ ...s.ticket, variant: { id: "int8", files } }, { catalogVersion: VERSION })).toBeNull();
    const r = await compose({ ...s.ticket, variant: { id: "int8", files } }, { index: idx });
    if (!r.ok) throw new Error(r.detail);
    expect(r.graph).toEqual(swapGraphFiles(s.graph, files, idx));
    expect(JSON.stringify(r.graph)).toContain("krea2_turbo_int8_convrot.safetensors");
    expect(JSON.stringify(r.graph)).not.toContain("krea2_turbo_fp8_scaled.safetensors");
    // Without a variant: the workflow's own files, as before.
    const plain = await compose(s.ticket, { index: idx });
    expect(plain.ok && plain.graph).toEqual(s.graph);
  });

  it("checks a ticket for another catalog against the graph before the variant", async () => {
    const s = await studio();
    const graphSha = graphFingerprint(s.graph, []);
    const r = await compose({ ...s.ticket, catalogVersion: "f".repeat(64), graphSha, variant: { id: "int8", files } }, { index: idx });
    expect(r.ok && JSON.stringify(r.graph)).toContain("krea2_turbo_int8_convrot.safetensors");
  });

  it("goes back in line for an updated worker when the build doesn't define the same variant", async () => {
    const s = await studio();
    const other = { ...s.ticket, variant: { id: "int8", files: { [FP8]: INT8 } } };
    expect(await compose(other, { index: idx })).toMatchObject({ ok: false, reason: "update-worker", graphChanged: true });
    expect(await compose({ ...s.ticket, variant: { id: "fp4", files } }, { index: idx })).toMatchObject({ ok: false, reason: "update-worker" });
    // A build that has no variants to read takes none.
    expect(await compose({ ...s.ticket, variant: { id: "int8", files } })).toMatchObject({ ok: false, reason: "update-worker" });
  });

  it("refuses a variant field that isn't one", async () => {
    const s = await studio();
    const bad = (variant: unknown) => ticketProblem({ ...s.ticket, variant } as JobTicket, { catalogVersion: VERSION })?.detail;
    expect(bad("int8")).toMatch(/^variant: /);
    expect(bad({ id: "int8", files: {}, extra: 1 })).toMatch(/unknown field/);
    expect(bad({ id: "INT 8", files })).toMatch(/not a variant id/);
    expect(bad({ id: "int8", files: {} })).toMatch(/files out of range/);
    expect(bad({ id: "int8", files: { [FP8]: "../../etc/passwd" } })).toMatch(/isn't a model file/);
    expect(bad({ id: "int8", files: { [FP8]: "diffusion_models/../../x.safetensors" } })).toMatch(/isn't a model file/);
    expect(bad({ id: "int8", files: { [FP8]: "C:/models/x.safetensors" } })).toMatch(/isn't a model file/);
  });
});
