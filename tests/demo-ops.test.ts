import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation, GenerationRequest } from "@/lib/catalog/types";

vi.mock("@/lib/catalog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/catalog")>();
  const { ROUND3_FIXTURES } = await import("./fixtures/round3-models");
  return { ...mod, MODELS: [...mod.MODELS, ...ROUND3_FIXTURES], getModel: (id: string) => ROUND3_FIXTURES.find((m) => m.id === id) ?? mod.getModel(id) };
});
vi.setConfig({ testTimeout: 60_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-demo-ops-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { contentTypeFor, kindFor, saveFile } = await import("@/server/storage");
const files = await import("@/app/api/files/[...path]/route");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function settle(id: string, ms = 40_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e2b6a40000000049454e44ae426082", "hex");

async function serve(url: string, download?: string) {
  const parts = url.replace(/^\/api\/files\//, "").split("/");
  return files.GET(new Request(`http://localhost${url}${download ? `?download=${download}` : ""}`), { params: Promise.resolve({ path: parts }) } as never);
}

/** Reads a GLB and checks it against the glTF 2.0 binary layout. */
function checkGlb(buf: Buffer) {
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  expect(buf.readUInt32LE(4)).toBe(2);
  expect(buf.readUInt32LE(8)).toBe(buf.length);
  const jsonLen = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a);
  expect(jsonLen % 4).toBe(0);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8").trimEnd());
  const binAt = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binAt);
  expect(buf.readUInt32LE(binAt + 4)).toBe(0x004e4942);
  expect(gltf.asset.version).toBe("2.0");
  expect(gltf.buffers[0].byteLength).toBe(binLen);
  const size = { SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>;
  const bytes = { 5126: 4, 5123: 2 } as Record<number, number>;
  for (const a of gltf.accessors) {
    const v = gltf.bufferViews[a.bufferView];
    expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(binLen);
    expect(a.count * size[a.type] * bytes[a.componentType]).toBe(v.byteLength);
    expect(v.byteOffset % bytes[a.componentType]).toBe(0);
  }
  const prim = gltf.meshes[0].primitives[0];
  expect(gltf.accessors[prim.attributes.POSITION].min).toHaveLength(3);
  expect(gltf.accessors[prim.indices].count % 3).toBe(0);
}

describe("storage", () => {
  it("knows text and 3D files", () => {
    expect(kindFor("text/plain")).toBe("text");
    expect(kindFor("application/json")).toBe("text");
    expect(kindFor("application/x-subrip")).toBe("text");
    expect(kindFor("text/plain; charset=utf-8")).toBe("text");
    expect(kindFor("model/gltf-binary")).toBe("model3d");
    expect(kindFor("image/png")).toBe("image");
    expect(contentTypeFor("a.srt")).toBe("application/x-subrip");
    expect(contentTypeFor("a.glb")).toBe("model/gltf-binary");
    expect(saveFile({ data: Buffer.from("hi"), contentType: "text/plain", source: "generation" }).url).toMatch(/\.txt$/);
    expect(saveFile({ data: Buffer.from("[]"), contentType: "application/json", source: "generation" }).kind).toBe("text");
  });

  it("ships a valid demo .glb", () => {
    checkGlb(fs.readFileSync(path.join(process.cwd(), "public/samples/demo-model.glb")));
  });
});

describe("demo outputs for every new operation", () => {
  it("gives layers, text, stems, clips and 3D the extras real providers return", async () => {
    const image = saveFile({ data: png, contentType: "image/png", source: "upload" }).url;
    const video = saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples/demo-square.mp4")), contentType: "video/mp4", source: "upload" }).url;
    const audio = saveFile({ data: Buffer.from("RIFF0000WAVEfmt "), contentType: "audio/wav", source: "upload" }).url;
    const reqs: Record<string, GenerationRequest> = {
      layers: { feature: "layers", modelId: "test-layers", prompt: "Summer sale poster", inputs: { images: [image] }, params: { numLayers: 4 } },
      textLayers: { feature: "layers", modelId: "test-text-layers", prompt: "Big summer sale", inputs: { images: [image] } },
      trim: { feature: "shorts", modelId: "test-trim", prompt: "trim", inputs: { video: video }, params: { startTime: 1, endTime: 3, aspectRatio: "9:16" } },
      captions: { feature: "captions", modelId: "test-captions", prompt: "captions", inputs: { video: video } },
      mux: { feature: "dub", modelId: "test-mux", prompt: "mux", inputs: { video: video, audio: audio } },
      transcribe: { feature: "dub", modelId: "test-transcribe", prompt: "transcribe", inputs: { video: video } },
      separate: { feature: "dub", modelId: "test-separate", prompt: "separate", inputs: { video: video } },
      model: { feature: "3d", modelId: "test-3d", prompt: "a ceramic vase", inputs: { images: [image] } },
    };
    const started = Object.fromEntries(Object.entries(reqs).map(([k, r]) => [k, gens.createGenerations(r)[0]]));
    expect(started.transcribe.kind).toBe("text");
    expect(started.model.kind).toBe("model3d");
    const done = Object.fromEntries(await Promise.all(Object.entries(started).map(async ([k, g]) => [k, await settle(g.id)] as const)));
    for (const [k, g] of Object.entries(done)) expect(g.status, `${k}: ${g.error}`).toBe("succeeded");

    const layers = done.layers.outputs;
    expect(layers.length).toBeGreaterThanOrEqual(3);
    expect(layers.length).toBeLessThanOrEqual(4);
    expect(layers.map((l) => l.meta?.z)).toEqual(layers.map((_, i) => i));
    for (const l of layers) {
      expect(l).toMatchObject({ kind: "image", contentType: "image/svg+xml" });
      expect(l.meta).toMatchObject({ name: expect.any(String), bbox: [expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)] });
    }
    expect(done.textLayers.outputs[0].meta?.textBlocks).toEqual(expect.arrayContaining([expect.objectContaining({ text: "BIG SUMMER SALE", bbox: expect.any(Array) })]));

    for (const k of ["trim", "captions", "mux"]) expect(done[k].outputs[0]).toMatchObject({ kind: "video", contentType: "video/mp4", meta: { demo: true } });

    const t = done.transcribe.outputs[0];
    expect(t).toMatchObject({ kind: "text", contentType: "application/x-subrip" });
    expect((t.meta?.cues as unknown[]).length).toBeGreaterThan(2);
    expect(t.text).toContain("This is a demo transcript.");
    const served = await serve(t.url, "transcript.srt");
    expect(served.headers.get("content-type")).toBe("application/x-subrip; charset=utf-8");
    expect(served.headers.get("content-disposition")).toBe('attachment; filename="transcript.srt"');
    expect(await served.text()).toMatch(/^1\n00:00:00,000 --> 00:00:02,300\nThis is a demo transcript\./);

    expect(done.separate.outputs.map((o) => [o.kind, o.meta?.stem])).toEqual([
      ["audio", "voice"],
      ["audio", "background"],
    ]);

    const [glb, turntable] = done.model.outputs;
    expect(glb).toMatchObject({ kind: "model3d", contentType: "model/gltf-binary" });
    expect(glb.url).toMatch(/\.glb$/);
    expect(turntable).toMatchObject({ kind: "video", meta: { turntable: true } });
    const res = await serve(glb.url, "vase.glb");
    expect(res.headers.get("content-type")).toBe("model/gltf-binary");
    checkGlb(Buffer.from(await res.arrayBuffer()));
  });
});
