import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { planGeneration } from "@/lib/catalog/plan";

/** The REST seam the evaluation harness (scripts/eval) needs: a recipe's LoRAs on POST /api/generations. */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-eval-api-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
const { POST } = await import("@/app/api/generations/route");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const post = async (body: unknown, preview = true) => {
  const res = await POST(new Request(`http://localhost/api/generations${preview ? "?preview=1" : ""}`, { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { error?: string; items?: { request: { loras?: unknown[] } }[] } };
};

const soul = { feature: "eval", modelId: "oss-z-image-turbo", prompt: "a portrait in soft daylight", params: { seed: 1001 } };

describe("POST /api/generations with a recipe's LoRAs", () => {
  it("takes LoRAs by ComfyUI file name with an optional https URL, strength, trigger and Wan expert", async () => {
    const loras = [
      { file: "AWPortrait-Z.safetensors", url: "https://huggingface.co/Shakker-Labs/AWPortrait-Z/resolve/main/AWPortrait-Z.safetensors", strength: 0.6 },
      { file: "civitai-2463391-hardflash.safetensors", strength: 0.7, trigger: "hardflashy" },
      { file: "wan/camera-overhead-high.safetensors", strength: 1, target: "high" },
    ];
    expect((await post({ ...soul, loras })).status).toBe(200);
    const made = await post({ ...soul, loras }, false);
    expect(made.status).toBe(201);
    // The stored request keeps them, so Reuse and the harness's records show the recipe that ran.
    expect(made.body.items?.[0].request.loras).toEqual(loras);
  });

  it("refuses names that leave models/loras, links that aren't https and strengths out of range", async () => {
    for (const bad of [
      { file: "../../etc/passwd" },
      { file: "loras/../../x.safetensors" },
      { file: "/abs.safetensors" },
      { file: "ok.safetensors", url: "http://insecure.example/x.safetensors" },
      { file: "ok.safetensors", url: "file:///etc/passwd" },
      { file: "ok.safetensors", strength: 9 },
      { file: "ok.safetensors", target: "middle" },
    ]) {
      const r = await post({ ...soul, loras: [bad] });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error).toMatch(/^loras\./);
    }
    expect((await post({ ...soul, loras: Array.from({ length: 9 }, (_, i) => ({ file: `l${i}.safetensors` })) })).status).toBe(400);
  });
});

describe("planGeneration with request LoRAs", () => {
  it("adds them after the preset's own and drops any at strength 0", () => {
    const plan = planGeneration(
      { ...soul, loras: [{ file: "a.safetensors", strength: 0.5 }, { file: "off.safetensors", strength: 0 }] },
      getModel,
      getPreset,
    );
    expect(plan.loras.map((l) => l.file)).toEqual(["a.safetensors"]);
  });

  it("preset strength 0 is the motion's prompt without its LoRAs (the harness's prompt-only baseline)", () => {
    const motion = getPreset("motion-dolly-in");
    expect(motion?.open?.loras?.length, "a motion with an open LoRA").toBeGreaterThan(0);
    const req = { feature: "eval", presetId: motion!.id, modelId: motion!.open!.modelId, prompt: "a cyclist on a coastal road", inputs: { images: ["start.png"] } };
    const full = planGeneration(req, getModel, getPreset);
    const none = planGeneration({ ...req, presetStrength: 0 }, getModel, getPreset);
    expect(full.loras.length).toBeGreaterThan(0);
    expect(none.loras).toEqual([]);
    expect(none.prompt).toBe(full.prompt);
  });
});
