import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { fitLoras, loraEntry, loraRef } from "@/lib/catalog/loras";
import type { GenInput, LoraRef, ModelRoute } from "@/lib/catalog/types";

// Providers and route choice read keys and preferences from the settings table: a throwaway database.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-replicate-lora-"));
process.env.FUOBE_DATA_DIR = dir;
const { replicateProvider } = await import("@/server/providers/replicate");
const { setSetting } = await import("@/server/settings");
const { chooseRoute } = await import("@/server/generations");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function submit(route: ModelRoute, input: GenInput): Promise<{ url: string; body: Record<string, unknown> }> {
  const real = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
    return new Response(JSON.stringify({ id: "p1" }), { status: 201 });
  }) as typeof fetch;
  try {
    await replicateProvider.submit({ generationId: "g", model: getModel("z-image-turbo-cloud")!, route, input });
  } finally {
    globalThis.fetch = real;
  }
  return seen!;
}

const route = (modelId: string, op: string, provider = "replicate") => {
  const r = getModel(modelId)?.routes.find((x) => x.op === op && x.provider === provider);
  if (!r) throw new Error(`${modelId} has no ${provider} ${op} route`);
  return r;
};
const hf = (file: string, extra: Partial<LoraRef> = {}): LoraRef => ({ file, url: `https://huggingface.co/a/b/resolve/main/${file}`, strength: 1, ...extra });

describe("Replicate LoRA payloads", () => {
  it("prunaai/z-image-turbo-lora: lora_weights[] and lora_scales[], run by its pinned version, size from the aspect ratio", async () => {
    const r = route("z-image-turbo-cloud", "t2i");
    expect(r.endpoint).toMatch(/^prunaai\/z-image-turbo-lora:[0-9a-f]{64}$/);
    const looks = ["awportrait", "grainscape"].map((k) => loraRef(loraEntry(k)!));
    const { url, body } = await submit(r, { prompt: "a portrait", aspectRatio: "16:9", seed: 7, loras: looks });
    // A community model: POST /v1/predictions with the version.
    expect(url).toBe("https://api.replicate.com/v1/predictions");
    expect(body.version).toBe(r.endpoint.split(":")[1]);
    const input = body.input as Record<string, unknown>;
    expect(input.lora_weights).toEqual(looks.map((l) => l.url));
    expect(input.lora_scales).toEqual([0.6, 0.5]);
    expect(input).toMatchObject({ prompt: "a portrait", seed: 7, width: 1360, height: 768 });
  });

  it("wan-2.2 fast: one LoRA per expert (lora_weights_transformer = high, _2 = low), a both-LoRA fills the two", async () => {
    const r = route("wan-2-2-a14b-cloud", "i2v");
    const pair = ["civitai-2126493-camera-tilt-up-overhead", "civitai-2126538-camera-tilt-up-overhead"].map((k) => ({ ...loraRef(loraEntry(k)!), hostedUrl: `https://replicate.delivery/${k}.safetensors` }));
    const { url, body } = await submit(r, { prompt: "rise", images: ["https://x/a.png"], duration: 5, loras: pair });
    expect(url).toBe("https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions");
    expect(body.input).toMatchObject({
      lora_weights_transformer: pair[0].hostedUrl,
      lora_scale_transformer: 1,
      lora_weights_transformer_2: pair[1].hostedUrl,
      lora_scale_transformer_2: 1,
      num_frames: 81,
    });
    const both = await submit(r, { prompt: "squish", images: ["https://x/a.png"], loras: [hf("squish_18.safetensors", { target: "both", strength: 0.7 })] });
    expect(both.body.input).toMatchObject({ lora_weights_transformer: expect.stringContaining("squish"), lora_weights_transformer_2: expect.stringContaining("squish"), lora_scale_transformer_2: 0.7 });
  });

  it("leaves out what doesn't fit one LoRA per expert, with a note", () => {
    const r = route("wan-2-2-a14b-cloud", "i2v");
    const motion = hf("motion_high.safetensors", { target: "high" });
    const effect = hf("effect_high.safetensors", { target: "high" });
    const fitted = fitLoras([motion, effect], r);
    expect(fitted.loras).toEqual([motion]);
    expect(fitted.notes).toEqual(["This API takes one LoRA per expert, so the effect_high LoRA is left out"]);
  });

  it("qwen-image-edit-2511: a single LoRA in lora_weights / lora_scale", async () => {
    const r = route("qwen-image-edit-2511-cloud", "edit");
    const { body } = await submit(r, { prompt: "relight", images: ["https://x/a.png"], loras: [hf("relight.safetensors", { strength: 0.9 })] });
    expect(body.input).toMatchObject({ image: ["https://x/a.png"], lora_weights: expect.stringContaining("relight"), lora_scale: 0.9 });
  });

  it("runs a Mix on fal when Replicate's one-per-expert model can't carry it, even with Replicate preferred", () => {
    setSetting("falKey", "id:secret");
    setSetting("replicateToken", "r8_test");
    setSetting("cloudProvider", "replicate");
    setSetting("demoMode", "auto");
    const routes = getModel("wan-2-2-a14b-cloud")!.routes.filter((r) => r.op === "i2v");
    const one = [hf("motion_high.safetensors", { target: "high" })];
    const mix = [...one, hf("effect_high.safetensors", { target: "high" })];
    expect(chooseRoute(routes, 1, one).route.provider).toBe("replicate");
    expect(chooseRoute(routes, 1, mix).route.provider).toBe("fal");
    // Local-only LoRAs don't count: they never go to the cloud.
    const wiggle = loraRef(loraEntry("civitai-2490836-wiggle-redmond")!);
    expect(chooseRoute(routes, 1, [...one, wiggle]).route.provider).toBe("replicate");
  });
});
