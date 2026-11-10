import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { planGeneration, routesFor } from "@/lib/catalog/plan";
import type { GenerationRequest, GenInput, Operation } from "@/lib/catalog/types";
import { PROMPT_HELPER_FILES, PROMPT_HELPER_GRAPHS, PROMPT_HELPER_OPT_IN, skipPromptHelper, type ComfyWorkflow, type Manifest } from "@/lib/comfy";
import { filterModels, settingsShape, settingsSummary, studioBest } from "@/lib/composer";
import { isH3Graph } from "@/lib/h3-prompt";
import { licenceInfo } from "@/lib/licences";
import { EDIT_STUDIO, IMAGE_STUDIO } from "@/lib/studios";
import { graphCheck } from "../bin/lib/worker/checks.mjs";
import { loaderInput } from "../bin/lib/worker/rules.mjs";
import { allowedNodeList, inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { tempDir } from "./helpers/temp-dir";

// MiniMax H3 Image on your GPU: two core-node graphs from Comfy-Org's image_minimax_h3_image templates, an opt-in Prompt helper
// (TextGenerateV2 → JsonExtractString) that is taken out when off, the edit's resize chain, and 2K / 4K canvases.
process.env.FUOBE_DATA_DIR = tempDir("fuobe-h3-image-");
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { STUDIO_ROWS } = await import("@/server/gpu/tools");

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "workflows/comfyui");
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;
const manifest = read<Manifest>("manifest.json");
const pins = read<Record<string, { revision: string; sizeBytes: number; sha256?: string }>>("model-pins.json");
const requirements = read<{ workflows: Record<string, { core: string[]; packs: Record<string, string[]>; files: string[]; optional: string[]; vramGb: number }> }>("requirements.json");
const subset = read<Record<string, unknown>>("object_info.subset.json");
const entry = (id: string) => manifest.workflows.find((w) => w.id === id)!;
const graph = (id: string) => read<ComfyWorkflow>(`${id}.json`);
const classes = (wf: ComfyWorkflow) => Object.values(wf).map((n) => n.class_type);

const T2I = "minimax-h3-image-t2i";
const EDIT = "minimax-h3-image-edit";
const MODEL = "oss-minimax-h3-image";
const HELPER_NODES = ["10", "11", "12", "13", "14"];

/** The pinned files: Comfy-Org's repack at 892de7cb and the int8 encoder of Comfy-Org/MiniMax-H3 at 54472221. */
const PINS: Record<string, { url: string; sizeBytes: number; sha256: string }> = {
  "diffusion_models/minimax_h3_image_pruned_int8_convrot.safetensors": {
    url: "https://huggingface.co/Comfy-Org/MiniMax-H3-Image/resolve/892de7cb61df49753bf15145a711154803a355cb/diffusion_models/minimax_h3_image_pruned_int8_convrot.safetensors",
    sizeBytes: 20979314802,
    sha256: "83eb140f1ff95c068f8a6886e6d3f3d0d4ab2e07bb2fe6d2ef992a51146ee622",
  },
  "vae/minimax_h3_image_vae_fp16.safetensors": {
    url: "https://huggingface.co/Comfy-Org/MiniMax-H3-Image/resolve/892de7cb61df49753bf15145a711154803a355cb/vae/minimax_h3_image_vae_fp16.safetensors",
    sizeBytes: 1168505312,
    sha256: "d80e9c2e5cfc9844869961ff5a58c9a9e52182df6bfb30b26018dd7f348721af",
  },
  "text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors": {
    url: "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/54472221d27c695fca9621b0c3ed52f06c4af707/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
    sizeBytes: 27141342152,
    sha256: "bc2ced0fbea64757fa9acddccfc0b3f4819d1dcf1da6c124d690d368be283923",
  },
};
const HELPER_FILE = "text_encoders/qwen3.5_9b_w4a8_gptq.safetensors";

async function prepare(id: string, input: GenInput, op: Operation) {
  return (await prepareWorkflow(id, { seed: 7, ...input }, { generationId: "g-h3-image", op, upload: async (_d, _t, name) => name })).workflow;
}
const plan = (req: Partial<GenerationRequest>) => planGeneration({ feature: "image", prompt: "a perfume campaign still", ...req } as GenerationRequest, getModel, getPreset);

describe("MiniMax H3 Image's graphs in the library", () => {
  it("are core-node graphs with the template's loaders and sampler, the words on their own node, and the licence as data", () => {
    for (const id of [T2I, EDIT]) {
      const e = entry(id);
      expect(e, id).toMatchObject({ customNodes: [], vramGb: 32, outputs: [{ node: "9", kind: "image" }], source: `hand-built (scripts/comfy/hand-built/${id}.json)` });
      expect(e.license, id).toMatch(/^MiniMax-H3-Image Community License .*EXCLUDES the US, the EU, the UK and South Korea/);
      expect(licenceInfo(e.license!)).toMatchObject({ name: "MiniMax-H3-Image Community License", class: "regions" });
      expect(e.bindings.prompt, id).toEqual([{ node: "4", input: "value" }]);
      expect(e.bindings.seed, id).toEqual([
        { node: "7", input: "seed" },
        { node: "11", input: "sampling_mode.seed" },
      ]);
      expect(requirements.workflows[id].packs, id).toEqual({});
      for (const c of classes(graph(id))) expect(subset[c], `${id} ${c}`).toBeTruthy();
      // The hand-built graph is the one the library ships.
      expect(graph(id)).toEqual(JSON.parse(fs.readFileSync(path.join(root, "scripts/comfy/hand-built", `${id}.json`), "utf8")));
      const g = graph(id);
      expect(g["1"].inputs).toEqual({ unet_name: "minimax_h3_image_pruned_int8_convrot.safetensors", weight_dtype: "default" });
      expect(g["2"].inputs).toEqual({ clip_name: "qwen3vl_32b_minimax_h3_int8_convrot.safetensors", type: "minimax", device: "default" });
      expect(g["3"].inputs).toEqual({ vae_name: "minimax_h3_image_vae_fp16.safetensors" });
      expect(g["5"].class_type).toBe("MiniMaxH3ImageConditioning");
      expect(g["5"].inputs).toMatchObject({ clip: ["2", 0], vae: ["3", 0], prompt: ["12", 0] });
      expect(g["6"]).toMatchObject({ class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } });
      // The conditioning's latent is the sampler's: 6 steps, CFG 1, euler / simple, denoise 1.
      expect(g["7"].inputs).toEqual({ model: ["1", 0], positive: ["5", 0], negative: ["6", 0], latent_image: ["5", 1], seed: 0, steps: 6, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 });
      expect(g["8"].inputs).toEqual({ samples: ["7", 0], vae: ["3", 0] });
      // The helper: the words in the template's task text, TextGenerateV2 thinking first, its expanded_caption read back.
      expect(g["4"].class_type).toBe("PrimitiveStringMultiline");
      expect(g["10"].inputs).toEqual({ clip_name: "qwen3.5_9b_w4a8_gptq.safetensors", type: "minimax", device: "default" });
      expect(g["13"]).toMatchObject({ class_type: "StringReplace", inputs: { find: "{input text}", replace: ["4", 0] } });
      expect(String(g["13"].inputs.string)).toContain("{input text}");
      expect(g["11"].class_type).toBe("TextGenerateV2");
      expect(g["11"].inputs).toMatchObject({ clip: ["10", 0], prompt: ["13", 0], max_length: 8192, sampling_mode: "on", "sampling_mode.temperature": 1, "sampling_mode.top_k": 20, "sampling_mode.top_p": 0.95, thinking: true, system_prompt: ["14", 0] });
      expect(g["12"]).toMatchObject({ class_type: "JsonExtractString", inputs: { json_string: ["11", 0], key: "expanded_caption" } });
      expect(String(g["14"].inputs.value)).toMatch(/^Reason in the thinking section first\. .*expanded_caption and aspect_ratio/);
      expect(PROMPT_HELPER_GRAPHS.has(id) && PROMPT_HELPER_OPT_IN.has(id), id).toBe(true);
      expect(PROMPT_HELPER_FILES[id]).toBe(HELPER_FILE);
    }
    expect(String(graph(T2I)["13"].inputs.string)).toMatch(/^You are a caption-expansion and canvas-selection model/);
    expect(String(graph(EDIT)["13"].inputs.string)).toMatch(/^You are an expert at enhancing a short image-editing instruction/);
    expect(entry(T2I).defaults).toEqual({ width: 2048, height: 2048 });
    expect(entry(T2I).limits).toEqual({ maxWidth: 6272, maxHeight: 6272, dimensionMultiple: 32 });
    expect(entry(EDIT).limits).toEqual({ maxImages: 5 });
    expect(entry(EDIT).bindings.width).toBeUndefined();
  });

  it("pins every file by revision, size and SHA-256, the helper's Qwen3.5 9B as an optional file", () => {
    for (const id of [T2I, EDIT]) {
      const r = requirements.workflows[id];
      expect(r.files.sort(), id).toEqual(Object.keys(PINS).sort());
      expect(r.optional, id).toEqual([HELPER_FILE]);
      expect(entry(id).models.find((m) => m.file === "qwen3.5_9b_w4a8_gptq.safetensors"), id).toMatchObject({ optional: true });
      expect(r.core, id).toEqual(expect.arrayContaining(["MiniMaxH3ImageConditioning", "TextGenerateV2", "JsonExtractString", "StringReplace"]));
    }
    for (const [key, pin] of Object.entries(PINS)) {
      const m = entry(T2I).models.find((x) => `${x.folder}/${x.file}` === key)!;
      expect(m.url, key).toBe(pin.url);
      expect(pins[pin.url], key).toEqual({ revision: pin.url.split("/resolve/")[1].split("/")[0], sizeBytes: pin.sizeBytes, sha256: pin.sha256 });
    }
    expect(requirements.workflows[EDIT].core).toEqual(expect.arrayContaining(["ResizeImageMaskNode", "GetImageSize", "LoadImage"]));
    // Its newest core classes are read one by one when /object_info can't be read (an older ComfyUI lacks them first).
    const index = read<{ sentinels: string[] }>("requirements.json");
    expect(index.sentinels).toEqual(expect.arrayContaining(["MiniMaxH3ImageConditioning", "TextGenerateV2"]));
    expect(index.sentinels).not.toContain("MiniMaxH3ImageToVideo");
  });

  it("feeds each edit picture through the template's two resizes, and Picture 1's size is the canvas", () => {
    const g = graph(EDIT);
    for (let i = 0; i < 5; i++) {
      const [load, total, grid] = [String(20 + i), String(30 + i), String(35 + i)];
      expect(g[load]).toMatchObject({ class_type: "LoadImage" });
      expect(g[total]).toMatchObject({ class_type: "ResizeImageMaskNode", inputs: { input: [load, 0], resize_type: "scale total pixels", "resize_type.megapixels": 4, scale_method: "area" } });
      expect(g[grid]).toMatchObject({ class_type: "ResizeImageMaskNode", inputs: { input: [total, 0], resize_type: "scale to multiple", "resize_type.multiple": 32, scale_method: "area" } });
      expect(g["5"].inputs[`images.image_${i + 1}`]).toEqual([grid, 0]);
      expect(entry(EDIT).bindings[i ? `image${i + 1}` : "image"]).toEqual([{ node: load, input: "image" }]);
    }
    // Never the picture straight in with width and height 0: GetImageSize of the resized Picture 1.
    expect(g["40"]).toMatchObject({ class_type: "GetImageSize", inputs: { image: ["35", 0] } });
    expect(g["5"].inputs).toMatchObject({ width: ["40", 0], height: ["40", 1] });
    // The helper looks at Picture 1, resized the same way, and at no other picture.
    expect(Object.entries(g["11"].inputs).filter(([k]) => k.startsWith("images."))).toEqual([["images.image1", ["35", 0]]]);
  });
});

describe("MiniMax H3 Image's Prompt helper", () => {
  it("off (the default), the conditioning reads your words and the helper's nodes go", async () => {
    const runs: [string, Operation, GenInput & { prompt: string }][] = [
      [T2I, "t2i", { prompt: "a perfume bottle on wet black stone" }],
      [EDIT, "edit", { prompt: "In <Picture 1>, make the gown liquid silver", images: ["gown.png"] }],
    ];
    for (const [id, op, input] of runs) {
      const wf = await prepare(id, input, op);
      expect(wf["5"].inputs.prompt, id).toEqual(["4", 0]);
      expect(wf["4"].inputs.value, id).toBe(input.prompt);
      for (const n of HELPER_NODES) expect(wf[n], `${id} ${n}`).toBeUndefined();
      expect(classes(wf), id).not.toEqual(expect.arrayContaining(["TextGenerateV2"]));
      expect(classes(wf).filter((c) => c === "CLIPLoader"), id).toHaveLength(1);
      expect(wf["7"].inputs.seed, id).toBe(7);
      // "off" said in so many words is the same.
      expect(await prepare(id, { ...input, extra: { promptHelper: "off" } }, op), id).toEqual(wf);
    }
  });

  it("on, your words go into the helper's task text and the conditioning reads its caption", async () => {
    const wf = await prepare(T2I, { prompt: "a perfume campaign shot", extra: { promptHelper: "on" } }, "t2i");
    expect(wf["5"].inputs.prompt).toEqual(["12", 0]);
    expect(wf["13"].inputs).toMatchObject({ find: "{input text}", replace: ["4", 0] });
    expect(wf["4"].inputs.value).toBe("a perfume campaign shot");
    expect(wf["11"].inputs["sampling_mode.seed"]).toBe(7);
    expect(wf["10"].inputs.clip_name).toBe("qwen3.5_9b_w4a8_gptq.safetensors");
    const edit = await prepare(EDIT, { prompt: "In <Picture 1>, swap the car for a pink truck", images: ["car.png"], extra: { promptHelper: "on" } }, "edit");
    expect(edit["11"].inputs["images.image1"]).toEqual(["35", 0]);
    expect(edit["5"].inputs.prompt).toEqual(["12", 0]);
  });

  it("skipPromptHelper reads the words from StringReplace, or from TextGenerateV2's own prompt, and leaves other graphs alone", () => {
    const out = skipPromptHelper(graph(T2I), ["9"]);
    expect(out["5"].inputs.prompt).toEqual(["4", 0]);
    for (const n of HELPER_NODES) expect(out[n], n).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    // The words written on StringReplace itself, or straight on TextGenerateV2 (no task text): the conditioning takes them.
    const g = graph(T2I);
    g["13"].inputs.replace = "typed words";
    expect(skipPromptHelper(g, ["9"])["5"].inputs.prompt).toBe("typed words");
    const plain = graph(T2I);
    plain["11"].inputs.prompt = "plain words";
    const skipped = skipPromptHelper(plain, ["9"]);
    expect(skipped["5"].inputs.prompt).toBe("plain words");
    expect(skipped["13"]).toBeUndefined();
    // A conditioning that reads its own words (no helper) stays as it is.
    const none: ComfyWorkflow = { "5": { class_type: "MiniMaxH3ImageConditioning", inputs: { prompt: "as typed", width: 2048, height: 2048 } } };
    expect(skipPromptHelper(none)).toBe(none);
    // The edit keeps every picture and its resizes; only the helper goes.
    const edit = skipPromptHelper(graph(EDIT), ["9"]);
    expect(edit["5"].inputs.prompt).toEqual(["4", 0]);
    for (const n of ["20", "24", "30", "34", "35", "39", "40"]) expect(edit[n], n).toBeTruthy();
    for (const n of HELPER_NODES) expect(edit[n], n).toBeUndefined();
  });
});

describe("MiniMax H3 Image's canvas and pictures", () => {
  it("makes 2K as 2048 x 2048 of area and 4K as 4096 x 4096, in the aspect ratio asked, on the 32 px grid", async () => {
    const size = async (aspectRatio: string, resolution: string) => {
      const wf = await prepare(T2I, { prompt: "x", aspectRatio, resolution }, "t2i");
      return [Number(wf["5"].inputs.width), Number(wf["5"].inputs.height)];
    };
    expect(await size("1:1", "2K")).toEqual([2048, 2048]);
    expect(await size("16:9", "2K")).toEqual([2720, 1536]);
    expect(await size("9:16", "2K")).toEqual([1536, 2720]);
    expect(await size("1:1", "4K")).toEqual([4096, 4096]);
    expect(await size("21:9", "4K")).toEqual([6272, 2688]);
    for (const ar of ["4:3", "3:2", "21:9", "4:5"]) for (const r of ["2K", "4K"]) for (const v of await size(ar, r)) expect(v % 32, `${ar} ${r}`).toBe(0);
  });

  it("is not an H3 video graph: no 768p video canvas, no frame grid", () => {
    expect(isH3Graph(T2I)).toBe(false);
    expect(isH3Graph(EDIT)).toBe(false);
    expect(isH3Graph("minimax-h3-t2v")).toBe(true);
  });

  it("leaves out the pictures not given, from the last, with their resizes", async () => {
    const one = await prepare(EDIT, { prompt: "In <Picture 1>, add rain", images: ["a.png"] }, "edit");
    expect(Object.keys(one["5"].inputs).filter((k) => k.startsWith("images."))).toEqual(["images.image_1"]);
    for (const n of ["21", "22", "23", "24", "31", "32", "33", "34", "36", "37", "38", "39"]) expect(one[n], n).toBeUndefined();
    expect(one["20"].inputs.image).toBe("a.png");
    expect(one["5"].inputs).toMatchObject({ width: ["40", 0], height: ["40", 1] });
    const three = await prepare(EDIT, { prompt: "Put the bag of <Picture 2> and the hat of <Picture 3> on <Picture 1>", images: ["a.png", "b.png", "c.png"] }, "edit");
    expect(Object.keys(three["5"].inputs).filter((k) => k.startsWith("images.")).sort()).toEqual(["images.image_1", "images.image_2", "images.image_3"]);
    expect(three["22"].inputs.image).toBe("c.png");
    expect(three["37"].inputs.input).toEqual(["32", 0]);
    for (const n of ["23", "24", "33", "34", "38", "39"]) expect(three[n], n).toBeUndefined();
    const five = await prepare(EDIT, { prompt: "a collage", images: ["a.png", "b.png", "c.png", "d.png", "e.png"] }, "edit");
    expect(five["24"].inputs.image).toBe("e.png");
    await expect(prepare(EDIT, { prompt: "x", images: [] }, "edit")).rejects.toThrow(/Add an image/);
  });
});

describe("MiniMax H3 Image in the catalog", () => {
  const model = getModel(MODEL)!;

  it("is an open image model with both routes, badged new, 2K by default and 4K as Max, its helper off", () => {
    expect(model).toMatchObject({ name: "MiniMax H3 Image", vendor: "MiniMax", family: "minimax-h3", kind: "image", engine: "open" });
    expect(model.badges).toEqual(["open", "new"]);
    expect(model.routes.map((r) => [r.op, r.endpoint])).toEqual([["t2i", T2I], ["edit", EDIT]]);
    expect(model.routes.find((r) => r.op === "edit")).toMatchObject({ unsized: true, maxImages: 5 });
    expect(model.options).toMatchObject({ resolutions: ["2K", "4K"], resolutionLabels: { "4K": "4K · Max" }, maxImages: 5, seed: true });
    expect(model.defaults).toMatchObject({ aspectRatio: "1:1", resolution: "2K" });
    const helper = model.options.controls!.find((c) => c.param === "promptHelper")!;
    expect(helper).toMatchObject({ values: ["off", "on"], default: "off" });
    expect(helper.labels!.on).toMatch(/longer/);
    expect(helper.labels!.off).toMatch(/as typed/);
    expect(JSON.stringify(helper)).not.toMatch(/\$|price|credit/i);
    expect(model.hidden).toBeFalsy();
  });

  it("plans 2K by default, an edit with pictures on its edit graph, and shows 4K as Max", () => {
    expect(plan({ modelId: MODEL }).params.resolution).toBe("2K");
    expect(routesFor(model, "edit").map((r) => r.endpoint)).toEqual([EDIT]);
    const images = Array.from({ length: 5 }, (_, i) => `/api/files/p${i}.png`);
    expect(plan({ feature: "edit", modelId: MODEL, inputs: { images } }).op).toBe("edit");
    expect(() => plan({ feature: "edit", modelId: MODEL, inputs: { images: [...images, "/api/files/p5.png"] } })).toThrow(/up to 5 images/);
    const shape = settingsShape(model, "t2i", "image", true);
    expect(shape.resolution).toEqual(["2K", "4K"]);
    expect(settingsSummary(shape, { resolution: "4K" }, model)).toContain("4K · Max");
    expect(settingsSummary(shape, {}, model)).toContain("2K");
  });

  it("changes no studio's default or Best list", () => {
    expect(Object.values(IMAGE_STUDIO.defaultModels)).not.toContain(MODEL);
    expect(Object.values(EDIT_STUDIO.defaultModels)).not.toContain(MODEL);
    const image = studioBest(filterModels(MODELS, { kind: "image", ops: IMAGE_STUDIO.pickerOps }), "open", IMAGE_STUDIO.defaultModels.open, IMAGE_STUDIO.ops);
    const edit = studioBest(filterModels(MODELS, { kind: "image", ops: EDIT_STUDIO.ops }), "open", EDIT_STUDIO.defaultModels.open, EDIT_STUDIO.ops);
    expect([...image, ...edit]).not.toContain(MODEL);
    expect(filterModels(MODELS, { kind: "image", ops: IMAGE_STUDIO.pickerOps }).map((m) => m.id)).toContain(MODEL);
    expect(filterModels(MODELS, { kind: "image", ops: EDIT_STUDIO.ops }).map((m) => m.id)).toContain(MODEL);
  });

  it("has a row on the GPU board that opens the Image studio on it", () => {
    const row = STUDIO_ROWS.find((r) => r.href === `/image?model=${MODEL}`)!;
    expect(row).toMatchObject({ label: "MiniMax H3 Image", group: "Images" });
    expect(row.steps).toEqual([
      { modelId: MODEL, op: "t2i" },
      { modelId: MODEL, op: "edit" },
    ]);
  });
});

describe("a worker takes MiniMax H3 Image's graphs", () => {
  type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  const catalog = readCatalog(root) as unknown as { requirements: { files: Record<string, { folder: string; file: string }> } };
  const rules = inputRules(catalog as never);
  const allowed = new Set(allowedNodeList(root, catalog as never));
  const verified = Object.values(catalog.requirements.files).map((f) => ({ folder: f.folder, name: f.file }));
  const sent = (g: Graph) => Object.values(g).flatMap((n) => Object.entries(n.inputs).filter(([k, v]) => loaderInput(n.class_type, k) && typeof v === "string").map(([, v]) => v as string));

  it("with the helper on and off, every node allowed and every input inside its rule", async () => {
    for (const promptHelper of ["off", "on"]) {
      const t2i = (await prepare(T2I, { prompt: "a neon sign that reads \"OPEN\"", aspectRatio: "16:9", resolution: "4K", extra: { promptHelper } }, "t2i")) as unknown as Graph;
      const edit = (await prepare(EDIT, { prompt: "In <Picture 1>, add a hat from <Picture 2>", images: ["fuobe_abcdefgh01.png", "fuobe_abcdefgh02.png"], extra: { promptHelper } }, "edit")) as unknown as Graph;
      for (const g of [t2i, edit]) expect(graphCheck(g, allowed, verified, { rules, staged: sent(g) }), promptHelper).toBeNull();
    }
  });

  it("refuses a model file that isn't verified on it", async () => {
    const g = (await prepare(T2I, { prompt: "x" }, "t2i")) as unknown as Graph;
    expect(graphCheck(g, allowed, verified.filter((v) => v.name !== "minimax_h3_image_pruned_int8_convrot.safetensors"), { rules, staged: [] })?.reason).toBe("model-unverified");
  });
});
