import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { planStoryboard, STORYBOARD_LOOK_MODEL } from "@/lib/catalog/storyboard";
import { soulLook } from "@/lib/catalog/soul";
import type { OutputFile } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 90_000 });

// Popcorn with Fuobe Soul's looks (build plan O13): the planner, then boards end to end in demo mode.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-popcorn-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { createStoryboard, estimateStoryboard } = await import("@/server/storyboard");
const estimateRoute = await import("@/app/api/storyboards/estimate/route");
const { db } = await import("@/server/db");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const look = soulLook("v1-digitalcam")!;
const scenes = ["a girl at a bus stop at night", "the bus arrives", "she looks back"];

describe("Popcorn looks: the planner", () => {
  it("frame 1 on Fuobe Soul with the look on the board's engine; the next frames carry its words and take the raw frame before", () => {
    for (const engine of ["cloud", "open"] as const) {
      const frames = planStoryboard({ engine, scenes, look: { id: look.id, words: look.look, strength: 0.8 }, aspectRatio: "16:9" });
      expect(frames[0]).toMatchObject({ modelId: STORYBOARD_LOOK_MODEL, engine, presetId: look.id, presetStrength: 0.8, frame: { index: 0, look: look.id } });
      // The look's words come from Soul's recipe on frame 1, not twice.
      expect(frames[0].prompt).not.toContain(look.look.replace(/[.\s]+$/, ""));
      const next = frames[1];
      expect(next.modelId).toBe(engine === "cloud" ? "nano-banana-pro" : "oss-qwen-next-scene");
      expect(next.prompt).toContain(`Style: ${look.look.replace(/[.\s]+$/, "")}`);
      expect(next.chain).toEqual([{ slot: "images", position: engine === "cloud" ? "last" : "first", raw: true }]);
      expect(next.chainFrom).toBeUndefined();
      expect(next.frame).toMatchObject({ index: 1, of: 3, look: look.id });
    }
  });

  it("with references, frame 1 stays on the reference model with the look's words, and still gets the look's finish", () => {
    const [first] = planStoryboard({ engine: "cloud", scenes, references: ["/api/files/hero.png"], style: "35mm", look: { id: look.id, words: look.look } });
    expect(first).toMatchObject({ modelId: "nano-banana-pro", inputs: { images: ["/api/files/hero.png"] }, frame: { look: look.id } });
    expect(first.presetId).toBeUndefined();
    expect(first.prompt).toContain(`Style: 35mm. ${look.look.replace(/[.\s]+$/, "")}`);
  });

  it("21:9 with a look: made at 16:9 (Fuobe Soul has no 21:9) and cropped after; without a look nothing changes", () => {
    const wide = planStoryboard({ engine: "open", scenes, look: { id: look.id, words: look.look }, aspectRatio: "21:9" });
    expect(wide.every((f) => f.params?.aspectRatio === "16:9" && f.frame?.crop === "21:9")).toBe(true);
    const plain = planStoryboard({ engine: "open", scenes, aspectRatio: "21:9" });
    expect(plain[0]).toMatchObject({ modelId: "oss-z-image-turbo", params: { aspectRatio: "21:9" } });
    expect(plain[1]).toMatchObject({ chainFrom: "first" });
    expect(plain[1].chain).toBeUndefined();
    expect(plain.every((f) => !f.frame?.look && !f.frame?.crop)).toBe(true);
  });
});

describe("Popcorn looks: boards (demo)", () => {
  const settle = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const g = gens.getGeneration(id)!;
      if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("timed out");
  };

  it("every frame carries the look's finish as meta; a next frame is made from the frame before as it came out", async () => {
    const board = await createStoryboard({ engine: "cloud", scenes, look: look.id, aspectRatio: "21:9" });
    expect(board.items.map((g) => g.modelId)).toEqual(["fuobe-soul", "nano-banana-pro", "nano-banana-pro"]);
    const first = await settle(board.items[0].id);
    expect(first.status).toBe("succeeded");
    expect(first.outputs[0].meta).toMatchObject({ look: look.id, overlay: "date-stamp", crop: "21:9", ...(look.grade && { grade: look.grade }) });
    // A browser finished frame 1 before frame 2 started: frame 2 still gets the raw picture.
    const finished: OutputFile[] = first.outputs.map((o) => ({ ...o, url: "/api/files/finished.png", meta: { ...o.meta, finished: true, original: o.url } }));
    db().prepare("UPDATE generations SET outputs_json = ? WHERE id = ?").run(JSON.stringify(finished), first.id);
    const second = await settle(board.items[1].id);
    expect(second.status).toBe("succeeded");
    expect(second.request.inputs?.images?.at(-1)).toBe(first.outputs[0].url);
    expect(second.outputs[0].meta).toMatchObject({ look: look.id, overlay: "date-stamp", crop: "21:9" });
    await settle(board.items[2].id);
  });

  it("a raw slot takes the picture before its finish; any other slot the finished one", async () => {
    const o: OutputFile = { url: "/api/files/finished.png", kind: "image", meta: { finished: true, original: "/api/files/raw.png" } };
    expect(await gens.chainValue(o, { slot: "images", position: "last", raw: true })).toBe("/api/files/raw.png");
    expect(await gens.chainValue(o, { slot: "images", position: "last" })).toBe("/api/files/finished.png");
    expect(await gens.chainValue({ url: "/api/files/plain.png", kind: "image" }, { slot: "images", raw: true })).toBe("/api/files/plain.png");
  });

  it("prices a board before it runs: the look's model for frame 1, Free on the GPU", async () => {
    setSetting("falKey", "fal-test-key");
    try {
      const e = estimateStoryboard({ engine: "cloud", frames: 4, look: look.id });
      expect(e).toMatchObject({ frames: 4, demo: false, models: ["Fuobe Soul", "Nano Banana Pro"] });
      // Three Nano Banana Pro edits at $0.15, and Fuobe Soul's picture at about a cent.
      expect(e.costUsd).toBeGreaterThan(0.45);
      expect(e.costUsd).toBeLessThan(0.5);
      const plain = estimateStoryboard({ engine: "cloud", frames: 4 });
      expect(plain.models).toEqual(["Nano Banana Pro"]);
      expect(plain.costUsd).toBeCloseTo(0.6, 3);
    } finally {
      setSetting("falKey", "");
    }
    const res = await estimateRoute.POST(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: "open", scenes, look: look.id }) }));
    expect(await res.json()).toMatchObject({ costUsd: 0, frames: 3 });
    const bad = await estimateRoute.POST(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: "open", scenes, look: "v9-nope" }) }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toBe("That look doesn't exist — pick another one");
  });
});
