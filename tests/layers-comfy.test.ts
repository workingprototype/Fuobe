import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ManifestWorkflow } from "@/lib/comfy";
import type { GenerationRequest } from "@/lib/catalog/types";
import type { LayerJobInput } from "@/lib/layers";

// The Layers tools' open-engine requests, bound into the real library graphs: extras bind by name and
// silently fall back to defaults when a name is wrong, so check the values land where they should.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-layers-comfy-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { jobSteps } = await import("@/server/layers");
const { getModel } = await import("@/lib/catalog");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function bind(req: GenerationRequest) {
  const route = getModel(req.modelId)!.routes.find((r) => r.op === req.op)!;
  expect(route.provider).toBe("comfyui");
  const res = await prepareWorkflow(
    route.endpoint,
    { prompt: req.prompt, images: req.inputs?.images, ...req.params },
    { generationId: "gen1", op: req.op!, upload: async (_d, _t, name) => `up_${name}`, media: () => undefined, serverRam: async () => undefined },
  );
  const wf = res.workflow as Record<string, { inputs: Record<string, unknown> }>;
  const m = res.manifest as ManifestWorkflow;
  return (key: string) => (m.bindings[key] ?? []).map((t) => wf[t.node].inputs[t.input]);
}

const step = (i: Partial<LayerJobInput>) => jobSteps({ tool: "decompose", engine: "open", frame: [0, 0, 100, 100], image: "/api/files/a.png", ...i } as LayerJobInput)[0].request;

describe("Layers on the cloud engine", () => {
  it("Seedream gets its resolution tier, mode and instruction; Qwen hosted its layer count", async () => {
    const { buildPayload } = await import("@/lib/catalog/payload");
    const payload = (req: GenerationRequest) => {
      const route = getModel(req.modelId)!.routes.find((r) => r.op === req.op)!;
      return buildPayload(route.map!, { prompt: req.prompt, images: req.inputs?.images, ...req.params });
    };
    expect(payload(step({ engine: "cloud", settings: { resolution: "1.5K", mode: "fast", layers: 6 } }))).toEqual({
      image_url: "/api/files/a.png",
      image_size: "auto_1.5K",
      enhance_prompt_mode: "fast",
      prompt: "Separate the major elements into up to 6 layers. Return name and description in English.",
    });
    expect(payload(step({ engine: "cloud", modelId: "qwen-image-layered-cloud", settings: { layers: 5 } }))).toMatchObject({ image_url: "/api/files/a.png", num_layers: 5 });
  });
});

describe("Layers on the open engine", () => {
  it("decomposition: layer count, Fast steps and the resolution tier reach Qwen-Image-Layered", async () => {
    const at = await bind(step({ settings: { layers: 6, mode: "fast", resolution: "2K" } }));
    expect(at("numLayers")).toEqual([6]);
    expect(at("steps")).toEqual([10]);
    expect(at("maxSize")).toEqual([1024]);
    // (The runner uploads inputs before this; here the name passes through.)
    expect(at("image")).toEqual(["/api/files/a.png"]);
  });

  it("separate by name: Layered-Control gets the element and two layers", async () => {
    const at = await bind(step({ tool: "split", prompt: "the guitar" }));
    expect(at("prompt")).toEqual(["the guitar"]);
    expect(at("numLayers")).toEqual([2]);
  });

  it("expand: the padding reaches FLUX Fill", async () => {
    const at = await bind(step({ tool: "expand", settings: { pads: { left: 64, top: 0, right: 128, bottom: 8 } } }));
    expect([at("padLeft"), at("padTop"), at("padRight"), at("padBottom")]).toEqual([[64], [0], [128], [8]]);
  });

  it("relight and edit text: the instruction reaches the edit graphs", async () => {
    const relight = await bind(step({ tool: "relight", settings: { light: "Candlelight", direction: "Left" } }));
    expect(String(relight("prompt")[0])).toContain("warm flickering candlelight, coming from the left");
    const text = await bind(step({ tool: "text-edit", settings: { rows: [{ from: "SALE", to: "OPEN" }] } }));
    expect(text("prompt")).toEqual(["Preserve the original design and change only the requested text. Change “SALE” to “OPEN”."]);
  });
});
