import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 120_000 });

// /api/genjutsu end to end in demo mode (no keys, no ComfyUI): each mode on both engines becomes one pipeline of
// ordinary generations, which the mock provider runs through; estimates with keys set price the real routes.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-genjutsu-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { db } = await import("@/server/db");
const createRoute = await import("@/app/api/genjutsu/route");
const estimateRoute = await import("@/app/api/genjutsu/estimate/route");

const json = (body?: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let clip = "";
let hero = "";
let mask = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  // A 12 s, 16 fps, 72×128 clip with a sound track.
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "dance.mp4" }).url;
  const px = (w: number, h: number, on: (x: number, y: number) => boolean) => {
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const at = (y * w + x) * 4;
        data.fill(on(x, y) ? 255 : 0, at, at + 3);
        data[at + 3] = 255;
      }
    return encodePng({ width: w, height: h, data });
  };
  hero = saveFile({ data: px(64, 64, () => true), contentType: "image/png", source: "upload", name: "hero.png" }).url;
  mask = saveFile({ data: px(72, 128, (x, y) => x >= 20 && x < 50 && y >= 80 && y < 110), contentType: "image/png", source: "upload", name: "mask.png" }).url;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function settle(id: string, ms = 90_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const batchOf = (id: string) => {
  const b = (db().prepare("SELECT batch_id FROM generations WHERE id = ?").get(id) as { batch_id: string }).batch_id;
  return db().prepare("SELECT id, model_id, op, feature FROM generations WHERE batch_id = ? ORDER BY created_at, id").all(b) as { id: string; model_id: string; op: string; feature: string }[];
};

const src = { duration: 12, fps: 16, width: 1280, height: 720, hasAudio: true };
const body = (over: Record<string, unknown> = {}) => ({ engine: "cloud", mode: "motion", references: [hero], source: { url: clip, name: "dance.mp4" }, ...over });

describe("Genjutsu: estimates", () => {
  it("without a Higgsfield key: Kling Motion Control in 10 s pieces, run as a demo", async () => {
    const res = await estimateRoute.POST(json(body({ source: { url: clip, ...src } })));
    expect(res.status).toBe(200);
    const e = await res.json();
    expect(e).toMatchObject({ modelId: "kling-motion-control", pieces: 2, seconds: 12, demo: true, higgsfield: false });
    expect(e.notes.join(" ")).toMatch(/2 pieces, joined with its own sound/);
  });

  describe("with keys (estimates submit nothing, so the prices are the routes' own)", () => {
    beforeAll(() => {
      setSetting("higgsfieldKey", "key-id:key-secret");
      setSetting("falKey", "fal-test-key");
    });
    afterAll(() => {
      setSetting("higgsfieldKey", "");
      setSetting("falKey", "");
    });

    it("Genjutsu Lite by default; Quality: High is the full model at its own price per resolution", async () => {
      const lite = await (await estimateRoute.POST(json(body({ source: { url: clip, ...src }, quality: "1080p" })))).json();
      // One 12 s call (Lite takes 15 s) that keeps the sound: $0.20 a second at 1080p.
      expect(lite).toMatchObject({ modelId: "genjutsu-lite-motion-transfer", tier: "standard", quality: "1080p", pieces: 1, steps: 1, demo: false, higgsfield: true });
      expect(lite.costUsd).toBeCloseTo(2.4, 4);
      expect(lite.notes.join(" ")).toMatch(/50% off/);
      const full = await (await estimateRoute.POST(json(body({ source: { url: clip, ...src, duration: 12.3 }, range: { start: 0, end: 12.3 }, tier: "high", quality: "480p" })))).json();
      // Whole seconds: 13 × $0.318.
      expect(full).toMatchObject({ modelId: "genjutsu-motion-transfer", tier: "high" });
      expect(full.costUsd).toBeCloseTo(13 * 0.318, 4);
    });

    it("Kling O3 swap at its edit price; the hosted VACE per 16-frame second", async () => {
      const kling = await (await estimateRoute.POST(json(body({ mode: "swap", modelId: "kling-o3", subject: "the red car", source: { url: clip, ...src, duration: 10 }, range: { start: 0, end: 10 } })))).json();
      expect(kling).toMatchObject({ modelId: "kling-o3", pieces: 1 });
      expect(kling.costUsd).toBeCloseTo(1.68, 3);
      expect(kling.notes.join(" ")).toMatch(/keeps your clip's size/);
      const vace = await (await estimateRoute.POST(json(body({ mode: "insert", target: "paint", mask: "/api/files/m.png", quality: "480p", source: { url: clip, ...src }, range: { start: 0, end: 10 } })))).json();
      // 160 frames at 16 fps → one piece of 157 frames, billed as 157 / 16 s at $0.05, then the sound put back.
      expect(vace).toMatchObject({ modelId: "wan-22-vace-inpaint", pieces: 1, quality: "480p" });
      expect(vace.costUsd).toBeGreaterThanOrEqual((157 / 16) * 0.05);
      expect(vace.costUsd).toBeLessThan((157 / 16) * 0.05 + 0.01);
    });
  });

  it("blockers come back in words", async () => {
    const say = async (b: Record<string, unknown>) => {
      const res = await estimateRoute.POST(json(b));
      expect(res.status).toBe(422);
      return (await res.json()).error as string;
    };
    expect(await say(body({ references: [], source: { url: clip, ...src } }))).toBe("Add a picture of your character");
    expect(await say(body({ source: { url: clip, ...src }, range: { start: 0, end: 3 } }))).toMatch(/between 4 and 30 seconds/);
    expect(await say(body({ mode: "swap", target: "paint", engine: "open", source: { url: clip, ...src } }))).toMatch(/name what to swap/);
    expect(await say(body({ mode: "swap", modelId: "kling-o3", source: { url: clip, ...src, duration: 10 }, range: { start: 0, end: 10 } }))).toMatch(/Say what to swap/);
    expect(await say(body({ mode: "restyle", references: [], source: { url: clip, ...src } }))).toBe("Pick a look");
    setSetting("engineMode", "open");
    expect(await say(body({ source: { url: clip, ...src } }))).toMatch(/open-source models only/);
    setSetting("engineMode", "both");
  });
});

describe("Genjutsu: runs (demo)", () => {
  const run = async (b: Record<string, unknown>) => {
    const res = await createRoute.POST(json(b));
    const out = await res.json();
    expect(res.status, out.error).toBe(201);
    return out as { final: Generation; items: Generation[] };
  };

  it("cloud motion transfer: pieces, a join and the sound, the finished video under feature genjutsu", async () => {
    const { final, items } = await run(body({ prompt: "a knight in silver armour" }));
    expect(final.feature).toBe("genjutsu");
    expect(items.filter((g) => g.feature === "genjutsu")).toHaveLength(1);
    const rows = batchOf(final.id);
    expect(rows.filter((r) => r.op === "motion-transfer").map((r) => r.model_id)).toEqual(["kling-motion-control", "kling-motion-control"]);
    expect(rows.some((r) => r.op === "concat") && rows.some((r) => r.op === "mux")).toBe(true);
    expect((await settle(final.id)).status).toBe("succeeded");
  });

  it("a repeated requestId gets the first run", async () => {
    const b = body({ requestId: "genjutsu-nonce-1" });
    const a = await run(b);
    const again = await run(b);
    expect(again.final.id).toBe(a.final.id);
  });

  it("open object swap by name: VACE windows from the upload, joined under the sound", async () => {
    const { final } = await run(body({ engine: "open", mode: "swap", subject: "the skateboard", references: [hero, hero] }));
    const rows = batchOf(final.id);
    // 192 frames at 16 fps → 3 windows of ≤81.
    expect(rows.filter((r) => r.op === "video-swap").map((r) => r.model_id)).toEqual(["oss-vace-swap", "oss-vace-swap", "oss-vace-swap"]);
    const swap = gens.getGeneration(rows.find((r) => r.op === "video-swap")!.id)!;
    expect(swap.request.params?.extra).toEqual({ maskPrompt: "the skateboard" });
    expect(swap.request.inputs?.images).toEqual([hero]);
    expect((await settle(final.id)).status).toBe("succeeded");
  });

  it("cloud swap by paint on one hosted VACE piece: the paint itself, no track", async () => {
    const { final } = await run(body({ mode: "swap", target: "paint", mask, range: { start: 0, end: 12 } }));
    const rows = batchOf(final.id);
    expect(rows.some((r) => r.model_id === "sam-3-1-video-mask")).toBe(false);
    // 12 s at 16 fps is one hosted VACE piece (≤241 frames): the paint itself, no track.
    expect(rows.filter((r) => r.op === "video-swap").map((r) => r.model_id)).toEqual(["wan-22-vace-inpaint"]);
    expect((await settle(final.id)).status).toBe("succeeded");
  });

  it("insert on the open engine and restyle on a Fuobe look run through", async () => {
    const ins = await run(body({ engine: "open", mode: "insert", target: "paint", mask, prompt: "a lamp on the table", range: { start: 0, end: 5 } }));
    expect(batchOf(ins.final.id).filter((r) => r.op === "video-insert").length).toBe(1);
    expect((await settle(ins.final.id)).status).toBe("succeeded");
    const look = await run(body({ mode: "restyle", references: [], look: { kind: "preset", id: "shorts-claymation" } }));
    const rows = batchOf(look.final.id);
    expect(rows.filter((r) => r.op === "v2v").every((r) => r.feature === "genjutsu-step")).toBe(true);
    expect(rows.filter((r) => r.feature === "genjutsu")).toHaveLength(1);
    expect((await settle(look.final.id)).status).toBe("succeeded");
  });
});
