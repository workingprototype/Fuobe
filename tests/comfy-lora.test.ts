import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loraEntry, loraRef } from "@/lib/catalog/loras";
import type { GenInput, Operation } from "@/lib/catalog/types";
import { canTakeLoras, type ComfyWorkflow } from "@/lib/comfy";

// LoRAs on the open engine through the provider: a recipe's LoRA stack on the library graphs (injectLoras after
// each diffusion model loader, Wan 2.2's high / low-noise experts apart), and graphs that can't take one.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-comfy-lora-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow, getWorkflow } = await import("@/server/providers/comfyui");
const { getModel, PRESETS, MOTIONS, EFFECTS } = await import("@/lib/catalog");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function prepare(id: string, input: GenInput, op: Operation) {
  return prepareWorkflow(id, { seed: 7, ...input }, { generationId: "g", op, upload: async (_d, _t, name) => `up_${name}`, media: () => undefined, serverRam: async () => undefined });
}

/** The LoRA chain after a loader: each LoraLoaderModelOnly from the loader on, in order. */
function chainAfter(wf: ComfyWorkflow, loader: string): { file: string; strength: number }[] {
  const out: { file: string; strength: number }[] = [];
  let up = loader;
  for (;;) {
    const next = Object.entries(wf).find(([, n]) => n.class_type === "LoraLoaderModelOnly" && Array.isArray(n.inputs.model) && n.inputs.model[0] === up);
    if (!next) return out;
    out.push({ file: String(next[1].inputs.lora_name), strength: Number(next[1].inputs.strength_model) });
    up = next[0];
  }
}

const loaderOf = (wf: ComfyWorkflow, match: RegExp) => Object.entries(wf).find(([, n]) => n.class_type === "UNETLoader" && match.test(String(n.inputs.unet_name)))![0];

describe("LoRA stacks on ComfyUI graphs", () => {
  it("puts each Wan 2.2 LoRA on its expert: the pair apart, a Wan 2.1 LoRA on both", async () => {
    const pair = ["civitai-2126493-camera-tilt-up-overhead", "civitai-2126538-camera-tilt-up-overhead"].map((k) => loraRef(loraEntry(k)!, 0.8));
    const squish = { file: "squish_18.safetensors", strength: 0.6, target: "both" as const };
    const { workflow: wf } = await prepare("wan22-i2v-14b", { prompt: "rise", images: ["a.png"], duration: 5, loras: [...pair, squish] }, "i2v");
    expect(chainAfter(wf, loaderOf(wf, /high_noise/))).toEqual([
      { file: pair[0].file, strength: 0.8 },
      { file: "squish_18.safetensors", strength: 0.6 },
    ]);
    expect(chainAfter(wf, loaderOf(wf, /low_noise/))).toEqual([
      { file: pair[1].file, strength: 0.8 },
      { file: "squish_18.safetensors", strength: 0.6 },
    ]);
    // Everything that read a loader now reads the end of its LoRA chain.
    const loaders = new Set([loaderOf(wf, /high_noise/), loaderOf(wf, /low_noise/)]);
    const readers = Object.values(wf).filter((n) => n.class_type !== "LoraLoaderModelOnly" && Object.values(n.inputs).some((v) => Array.isArray(v) && loaders.has(String(v[0]))));
    expect(readers).toEqual([]);
  });

  it("stacks a Soul look's three LoRAs after Z-Image Turbo's loader, in order", async () => {
    const looks = ["awportrait", "y2k", "hardflash"].map((k) => loraRef(loraEntry(k)!));
    const { workflow: wf } = await prepare("z-image-turbo-t2i", { prompt: "a woman leaving a club", aspectRatio: "3:4", loras: looks }, "t2i");
    expect(chainAfter(wf, loaderOf(wf, /z_image_turbo/))).toEqual(looks.map((l) => ({ file: l.file, strength: l.strength })));
  });

  it("refuses LoRAs on a graph with no model loader instead of dropping them", async () => {
    const graph = "video-trim";
    expect(canTakeLoras(getWorkflow(graph).workflow)).toBe(false);
    await expect(prepare(graph, { video: "a.mp4", startTime: 0, endTime: 1, loras: [loraRef(loraEntry("awportrait")!)] }, "trim")).rejects.toThrow(/can't take LoRAs/);
  });

  it("sends every preset's open LoRAs to a graph that can take them", () => {
    const bad: string[] = [];
    for (const p of [...PRESETS, ...MOTIONS, ...EFFECTS]) {
      if (!p.open?.loras?.length) continue;
      const m = getModel(p.open.modelId);
      for (const r of m?.routes.filter((x) => x.provider === "comfyui" && x.op === p.open!.op) ?? []) {
        if (!canTakeLoras(getWorkflow(r.endpoint.replace("{n}", "2")).workflow)) bad.push(`${p.id} → ${r.endpoint}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
