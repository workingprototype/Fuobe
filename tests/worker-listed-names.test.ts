import { describe, expect, it } from "vitest";
import { asListed, listedNames } from "../bin/lib/worker/inventory.mjs";

/**
 * ComfyUI on Windows lists a model file in a subfolder with "\", and a catalog graph names it with "/": ComfyUI then
 * refuses the job ("value not in list"). The worker reads its ComfyUI's lists with its nodes and sends such a name as
 * its ComfyUI lists it.
 */

const BS = String.fromCharCode(92);
const nested = ["Kandinsky-6.0-Lite-distill-5s-Diffusers", "transformer", "diffusion_pytorch_model.safetensors"];
const slash = nested.join("/");
const back = nested.join(BS);

const info = {
  UNETLoader: { input: { required: { unet_name: [["flux.safetensors", back], {}], weight_dtype: [["default", "fp8_e4m3fn"], {}] } } },
  VAELoader: { input: { required: { vae_name: ["COMBO", { options: ["ae.safetensors", ["vae", "wan.safetensors"].join(BS)] }] } } },
  CLIPTextEncode: { input: { required: { text: ["STRING", { multiline: true }] } } },
  Broken: { input: null },
};

describe("listedNames", () => {
  it("keeps only the list inputs that name something with a backslash, in both list forms", () => {
    const listed = listedNames(info);
    expect([...listed.keys()].sort()).toEqual(["UNETLoader\u0000unet_name", "VAELoader\u0000vae_name"]);
    expect(listed.get("UNETLoader\u0000unet_name")?.get(slash)).toBe(back);
    expect(listed.get("VAELoader\u0000vae_name")?.get("vae/wan.safetensors")).toBe(["vae", "wan.safetensors"].join(BS));
  });

  it("is empty where no list has one (Linux, macOS) or for nothing read", () => {
    expect(listedNames({ UNETLoader: { input: { required: { unet_name: [["a/b.safetensors"], {}] } } } }).size).toBe(0);
    expect(listedNames(null).size).toBe(0);
    expect(listedNames({}).size).toBe(0);
  });
});

describe("asListed", () => {
  const listed = listedNames(info);

  it("writes a nested model name as its ComfyUI lists it, and leaves the graph passed in as it was", () => {
    const graph = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: slash, weight_dtype: "default" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "a/b and c/d", clip: ["3", 0] } },
    };
    const before = JSON.stringify(graph);
    const out = asListed(graph, listed) as typeof graph;
    expect(out["1"].inputs.unet_name).toBe(back);
    expect(out["1"].inputs.weight_dtype).toBe("default");
    expect(out["2"]).toBe(graph["2"]);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it("changes nothing that its ComfyUI doesn't list that way: another input, another class, an unknown name, a link", () => {
    const graph = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "other/x.safetensors" } },
      "2": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: slash } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: slash } },
      "4": { class_type: "UNETLoader", inputs: { unet_name: ["5", 0] } },
    };
    expect(asListed(graph, listed)).toBe(graph);
  });

  it("returns the graph as it is with nothing listed", () => {
    const graph = { "1": { class_type: "UNETLoader", inputs: { unet_name: slash } } };
    expect(asListed(graph, new Map())).toBe(graph);
    expect(asListed(graph, undefined as never)).toBe(graph);
  });
});
