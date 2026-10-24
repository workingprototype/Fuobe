import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation, GenerationRequest, OutputFile } from "@/lib/catalog/types";

// The per-index chain slot (ChainSlot.index): one step per output of a list-making step (fan-out),
// and one step with a slot per index that gathers them back in order (fan-in).

vi.setConfig({ testTimeout: 90_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-fanout-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { createPipeline } = await import("@/server/chains");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function settle(id: string, ms = 80_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const count = () => (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;

describe("pickOutput with an index", () => {
  const frames: OutputFile[] = [
    { url: "/api/files/f2.png", kind: "image", meta: { index: 2 } },
    { url: "/api/files/f0.png", kind: "image", meta: { index: 0 } },
    { url: "/api/files/clip.mp4", kind: "video" },
    { url: "/api/files/f1.png", kind: "image", meta: { index: 1 } },
  ];

  it("takes output number i of the slot's kind, by meta.index", () => {
    expect(gens.pickOutput(frames, { slot: "images", index: 0 })?.url).toBe("/api/files/f0.png");
    expect(gens.pickOutput(frames, { slot: "images", index: 1 })?.url).toBe("/api/files/f1.png");
    expect(gens.pickOutput(frames, { slot: "images", index: 2 })?.url).toBe("/api/files/f2.png");
    expect(gens.pickOutput(frames, { slot: "video", index: 0 })?.url).toBe("/api/files/clip.mp4");
  });

  it("goes by position when the outputs carry no index, and holds the last one past the end", () => {
    const plain: OutputFile[] = [
      { url: "/a.png", kind: "image" },
      { url: "/b.png", kind: "image" },
    ];
    expect(gens.pickOutput(plain, { slot: "images", index: 1 })?.url).toBe("/b.png");
    expect(gens.pickOutput(plain, { slot: "images", index: 7 })?.url).toBe("/b.png");
    expect(gens.pickOutput(frames, { slot: "images", index: 40 })?.url).toBe("/api/files/f2.png");
    expect(gens.pickOutput([{ url: "/c.mp4", kind: "video" }], { slot: "images", index: 0 })).toBeUndefined();
  });
});

describe("fan-out and fan-in in createPipeline", () => {
  const clip = () => saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples/demo-landscape.mp4")), contentType: "video/mp4", source: "upload" }).url;

  it("refuses an output number that isn't a whole number from 0, before creating anything", () => {
    const before = count();
    for (const index of [-1, 1.5]) {
      expect(() =>
        createPipeline([
          { key: "frames", request: { feature: "t", modelId: "extract-frames", op: "extract-frames", inputs: { video: "/api/files/a.mp4" } } },
          { key: "f0", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "ink" }, after: "frames", chain: [{ slot: "images", index }] },
        ]),
      ).toThrow(/Step “f0”: an output number must be a whole number from 0/);
    }
    expect(count()).toBe(before);
  });

  it("restyles every extracted frame with the previous styled frame as a reference, then rebuilds the clip in order", async () => {
    const n = 5; // the demo extractor returns 4 frames: frame 5 holds the last one
    const steps = [
      { key: "frames", request: { feature: "t", modelId: "extract-frames", op: "extract-frames" as const, inputs: { video: clip() }, params: { frameInterval: 3 } } },
      ...Array.from({ length: n }, (_, i) => ({
        key: `f${i}`,
        request: { feature: "t", modelId: "nano-banana-2", op: "edit" as const, prompt: "Ink sketch", params: { seed: 7 } },
        after: i ? ["frames", `f${i - 1}`] : ["frames"],
        chain: i ? [{ slot: "images" as const, index: i, position: "first" as const }, { slot: "images" as const }] : [{ slot: "images" as const, index: i }],
      })),
      {
        key: "film",
        request: { feature: "t", modelId: "images-to-video", op: "images-to-video" as const, params: { fps: 8 } },
        after: Array.from({ length: n }, (_, i) => `f${i}`),
        chain: Array.from({ length: n }, () => ({ slot: "images" as const })),
      },
    ];
    const p = createPipeline(steps);
    expect(p.items.map((g) => g.op)).toEqual(["extract-frames", ...Array(n).fill("edit"), "images-to-video"]);

    const film = await settle(p.byKey.film.id);
    expect(film.status, film.error ?? "").toBe("succeeded");
    const frames = gens.getGeneration(p.byKey.frames.id)!.outputs;
    expect(frames).toHaveLength(4);
    const styled = Array.from({ length: n }, (_, i) => gens.getGeneration(p.byKey[`f${i}`].id)!);
    expect(styled[0].request.inputs?.images).toEqual([frames[0].url]);
    for (let i = 1; i < n; i++) expect(styled[i].request.inputs?.images).toEqual([frames[Math.min(i, 3)].url, styled[i - 1].outputs[0].url]);
    expect(styled.every((g) => g.request.params?.seed === 7 && g.request.chainFilled)).toBe(true);
    // Gathered back in frame order.
    expect(film.request.inputs?.images).toEqual(styled.map((g) => g.outputs[0].url));
  });

  it("takes the filled inputs out again for a retry, keeping the step's own", () => {
    const filled: GenerationRequest = {
      feature: "t",
      modelId: "nano-banana-2",
      op: "edit",
      inputs: { images: ["/frame3.png", "/own-anchor.png", "/styled2.png"], video: "/cut.mp4" },
      chain: [{ slot: "images", index: 3, position: "first" }, { slot: "images" }, { slot: "video" }],
      chainFilled: true,
    };
    const { chainFilled, ...waiting } = filled;
    expect(chainFilled).toBe(true);
    expect(gens.unfilledRequest(filled, 3)).toEqual({ ...waiting, inputs: { images: ["/own-anchor.png"] } });
    // Never filled (it never launched): unchanged.
    expect(gens.unfilledRequest(waiting, 3)).toEqual(waiting);
    // Nothing of its own: no inputs left.
    expect(gens.unfilledRequest({ feature: "t", modelId: "images-to-video", inputs: { images: ["/a.png", "/b.png"] }, chain: [{ slot: "images" }, { slot: "images" }], chainFilled: true }, 2).inputs).toBeUndefined();
  });

  it("orders and validates a few hundred steps quickly", () => {
    const n = 240;
    const steps = [
      { key: "frames", request: { feature: "t", modelId: "extract-frames", op: "extract-frames" as const, inputs: { video: "/api/files/a.mp4" } } },
      ...Array.from({ length: n }, (_, i) => ({
        key: `f${i}`,
        request: { feature: "t", modelId: "nano-banana-2", op: "edit" as const, prompt: "Ink" },
        after: i % 12 ? ["frames", `f${i - 1}`] : ["frames"],
        chain: i % 12 ? [{ slot: "images" as const, index: i, position: "first" as const }, { slot: "images" as const }] : [{ slot: "images" as const, index: i }],
      })),
    ];
    const t = performance.now();
    const p = createPipeline(steps);
    const ms = performance.now() - t;
    expect(p.items).toHaveLength(n + 1);
    // Each lane waits for the frame before it; lanes start together.
    const at = new Map(p.items.map((g, i) => [g.id, i]));
    for (let i = 1; i < n; i++) if (i % 12) expect(at.get(p.byKey[`f${i}`].id)!).toBeGreaterThan(at.get(p.byKey[`f${i - 1}`].id)!);
    expect(ms).toBeLessThan(15_000);
    for (const g of p.items) void gens.cancelGeneration(g.id);
  });
});
