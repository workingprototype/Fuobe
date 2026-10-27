import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOUD_CLICK_PROBLEM } from "@/lib/catalog/genjutsu";
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
  it("no keys: the Original's Lite tier, run as a demo; no Higgsfield anywhere", async () => {
    const res = await estimateRoute.POST(json(body({ source: { url: clip, ...src } })));
    expect(res.status).toBe(200);
    const e = await res.json();
    expect(e).toMatchObject({ modelId: "fuobe-genjutsu-motion-lite", source: "original", tier: "standard", quality: "480p", pieces: 1, seconds: 12, demo: true });
    expect(e.higgsfield).toBeUndefined();
  });

  describe("with keys (estimates submit nothing, so the prices are the routes' own)", () => {
    beforeAll(() => setSetting("falKey", "fal-test-key"));
    afterAll(() => setSetting("falKey", ""));

    it("motion: Lite is Wan 2.2 Animate at 480p turbo; Quality: High is the full model at its own price per resolution", async () => {
      // 12 s at 16 fps = 192 frames = 12 video seconds: $0.04 each, then the sound put back.
      const lite = await (await estimateRoute.POST(json(body({ source: { url: clip, ...src } })))).json();
      expect(lite).toMatchObject({ modelId: "fuobe-genjutsu-motion-lite", tier: "standard", quality: "480p", pieces: 1, steps: 2, demo: false, providers: ["fal"] });
      expect(lite.costUsd).toBeGreaterThanOrEqual(0.48);
      expect(lite.costUsd).toBeLessThan(0.49);
      const high = await (await estimateRoute.POST(json(body({ source: { url: clip, ...src }, tier: "high", quality: "720p" })))).json();
      expect(high).toMatchObject({ modelId: "fuobe-genjutsu-motion", tier: "high", quality: "720p" });
      expect(high.costUsd).toBeGreaterThanOrEqual(0.96);
      expect(high.costUsd).toBeLessThan(0.97);
      // fal bills frames ÷ 16: a 30 fps clip costs 1.9× its length, and says so.
      const fast = await (await estimateRoute.POST(json(body({ source: { url: clip, ...src, fps: 30 } })))).json();
      expect(fast.notes.join(" ")).toMatch(/fal bills this clip's 30 fps as 1\.9× its length/);
    });

    it("Kling O3 swap at its edit price; the hosted VACE per 16-frame second", async () => {
      const kling = await (await estimateRoute.POST(json(body({ mode: "swap", modelId: "kling-o3", subject: "the red car", source: { url: clip, ...src, duration: 10 }, range: { start: 0, end: 10 } })))).json();
      expect(kling).toMatchObject({ modelId: "kling-o3", source: "partner", pieces: 1 });
      expect(kling.costUsd).toBeCloseTo(1.68, 3);
      expect(kling.notes.join(" ")).toMatch(/keeps your clip's size/);
      const vace = await (await estimateRoute.POST(json(body({ mode: "insert", target: "paint", mask: "/api/files/m.png", quality: "480p", source: { url: clip, ...src }, range: { start: 0, end: 10 } })))).json();
      // 160 frames at 16 fps → one piece of 157 frames, billed as 157 / 16 s at $0.05, then the sound put back.
      expect(vace).toMatchObject({ modelId: "wan-22-vace-inpaint", source: "open", pieces: 1, quality: "480p" });
      expect(vace.costUsd).toBeGreaterThanOrEqual((157 / 16) * 0.05);
      expect(vace.costUsd).toBeLessThan((157 / 16) * 0.05 + 0.01);
    });

    it("Character swap on fal: H3 with the swap LoRA per second, the first frame on its own price (or said when billed by tokens), the limits", async () => {
      const part = { source: { url: clip, ...src }, mode: "character", range: { start: 2, end: 9 } };
      const sun = await (await estimateRoute.POST(json(body(part)))).json();
      // 7 s at 768p: $0.075 a second; Sunburst's first frame is billed by tokens and left out, in words.
      expect(sun).toMatchObject({ modelId: "fuobe-character-swap", source: "original", quality: "768p", pieces: 1, anchors: 1, demo: false });
      expect(sun.costUsd).toBeGreaterThanOrEqual(0.525);
      expect(sun.costUsd).toBeLessThan(0.535);
      expect(sun.notes.join(" ")).toMatch(/billed by tokens .* isn't in the price/);
      expect(sun.notes.join(" ")).toMatch(/MiniMax H3 Community License — not licensed in the US, the EU, the UK and South Korea/);
      expect(sun.limits).toContain("One continuous shot: a hard cut breaks the swap");
      expect(sun.gpu).toBeUndefined();
      const nbp = await (await estimateRoute.POST(json(body({ ...part, character: { anchorModel: "nano-banana-pro" } })))).json();
      expect(nbp.costUsd).toBeCloseTo(sun.costUsd + 0.15, 3);
      // No first frame, 480p: $0.0625 a second.
      const bare = await (await estimateRoute.POST(json(body({ ...part, quality: "480p", character: { anchor: false } })))).json();
      expect(bare).toMatchObject({ anchors: 0, quality: "480p" });
      expect(bare.costUsd).toBeGreaterThanOrEqual(0.4375);
      expect(bare.costUsd).toBeLessThan(0.445);
      // MiniMax's own Recast, a partner: $0.30 a second at 768p.
      const recast = await (await estimateRoute.POST(json(body({ ...part, modelId: "h3-max-recast", range: { start: 2, end: 12 } })))).json();
      expect(recast).toMatchObject({ modelId: "h3-max-recast", source: "partner" });
      expect(recast.costUsd).toBeCloseTo(3, 2);
    });
  });

  it("Character swap on the open engine: free on your GPU, the windows, the GPU it was tested on and the licences", async () => {
    const e = await (await estimateRoute.POST(json(body({ engine: "open", mode: "character", source: { url: clip, ...src }, range: { start: 2, end: 9 } })))).json();
    expect(e).toMatchObject({ modelId: "fuobe-character-swap", source: "original", costUsd: 0, anchors: 1, gpu: { weightsGb: 46.33 } });
    expect(e.notes.join(" ")).toMatch(/2 windows of 124 frames at 24 fps/);
    expect(e.notes.join(" ")).toMatch(/nodes GPL-3\.0 · SAM License/);
    expect(e.notes.join(" ")).toMatch(/Qwen-Image-Edit 2511 first puts your character into the part's first frame/);
  });

  describe("key mixes: a run is all real or all a demo, so a missing key is said before anything is paid for", () => {
    const say = async (b: Record<string, unknown>, route: { POST: (r: Request) => Promise<Response> } = estimateRoute) => {
      const res = await route.POST(json(b));
      const out = await res.json();
      expect(res.status, JSON.stringify(out)).toBe(422);
      return out.error as string;
    };
    afterAll(() => {
      setSetting("replicateToken", "");
      setSetting("falKey", "");
      setSetting("demoMode", "auto");
    });

    it("only a Replicate token: P-Video Replace runs the whole clip; a part needs a cut on fal", async () => {
      setSetting("replicateToken", "r8_test");
      const whole = await (await estimateRoute.POST(json(body({ mode: "character", modelId: "p-video-replace", source: { url: clip, ...src } })))).json();
      expect(whole).toMatchObject({ modelId: "p-video-replace", source: "partner", steps: 1, demo: false, providers: ["replicate"] });
      expect(await say(body({ mode: "character", modelId: "p-video-replace", source: { url: clip, ...src }, range: { start: 0, end: 10 } }))).toBe("Cutting the clip runs on fal.ai — add a fal.ai key in Settings → API keys");
      // Starting it is refused the same way, and nothing is made.
      const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
      expect(await say(body({ mode: "character", modelId: "p-video-replace", source: { url: clip }, range: { start: 0, end: 10 } }), createRoute)).toMatch(/^Cutting the clip runs on fal\.ai/);
      expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
      setSetting("replicateToken", "");
    });

    it("demo mode off and no keys: the key it needs, in words", async () => {
      setSetting("demoMode", "off");
      expect(await say(body({ source: { url: clip, ...src } }))).toBe("Fuobe Genjutsu Lite · Motion runs on fal.ai, and putting the sound back runs on fal.ai — add a fal.ai key in Settings → API keys");
      setSetting("demoMode", "auto");
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
    // Character swap: a part of 5–15 s, a click only on the open engine.
    expect(await say(body({ mode: "character", source: { url: clip, ...src }, range: { start: 0, end: 4.5 } }))).toMatch(/Pick a part of 5–15 seconds/);
    expect(await say(body({ mode: "character", target: "click", source: { url: clip, ...src }, range: { start: 0, end: 6 } }))).toBe(CLOUD_CLICK_PROBLEM);
    expect(await say(body({ engine: "open", mode: "character", target: "click", source: { url: clip, ...src }, range: { start: 0, end: 6 } }))).toBe("Click the person to swap on the first frame");
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

  it("cloud motion transfer on the Original: one call and the sound, the finished video under feature genjutsu", async () => {
    const { final, items } = await run(body({ prompt: "a knight in silver armour" }));
    expect(final.feature).toBe("genjutsu");
    expect(items.filter((g) => g.feature === "genjutsu")).toHaveLength(1);
    const rows = batchOf(final.id);
    // Wan 2.2 Animate takes the whole 12 s selection in one call; the sound goes back on after.
    expect(rows.filter((r) => r.op === "motion-transfer").map((r) => r.model_id)).toEqual(["fuobe-genjutsu-motion-lite"]);
    expect(rows.some((r) => r.op === "mux")).toBe(true);
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
    expect(rows.filter((r) => r.op === "video-swap").map((r) => r.model_id)).toEqual(["fuobe-genjutsu-swap-lite", "fuobe-genjutsu-swap-lite", "fuobe-genjutsu-swap-lite"]);
    const swap = gens.getGeneration(rows.find((r) => r.op === "video-swap")!.id)!;
    expect(swap.request.params?.extra).toEqual({ maskPrompt: "the skateboard" });
    expect(swap.request.inputs?.images).toEqual([hero]);
    expect((await settle(final.id)).status).toBe("succeeded");
  });

  it("cloud swap by paint on one hosted VACE piece: the paint itself, no track", async () => {
    const { final } = await run(body({ mode: "swap", modelId: "wan-22-vace-inpaint", target: "paint", mask, range: { start: 0, end: 12 } }));
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

  it("Character swap on fal: the part cut, its first frame, the anchor, H3 with the swap LoRA, the sound put back", async () => {
    const { final } = await run(body({ mode: "character", range: { start: 2, end: 9 }, seed: 9, character: { who: "rightmost" } }));
    const rows = batchOf(final.id);
    // The part and the sound's part cut, the first frame, the anchor, the swap, the sound put back.
    expect(rows.map((r) => `${r.model_id}:${r.op}`).sort()).toEqual(
      ["trim-video:trim", "trim-video:trim", "extract-frame:frame", "gpt-image-2-5-sunburst:edit", "fuobe-character-swap:video-swap", "merge-audio-video:mux"].sort(),
    );
    const swapRow = rows.find((r) => r.op === "video-swap")!;
    expect(swapRow.model_id).toBe("fuobe-character-swap");
    expect((await settle(final.id)).status).toBe("succeeded");
    const swap = gens.getGeneration(swapRow.id)!;
    expect(swap.request.loras).toEqual([expect.objectContaining({ file: "h3_character_swap_v1.5.safetensors" })]);
    expect(swap.request.params).toMatchObject({ duration: 7, resolution: "768p", seed: 9 });
    expect(swap.request.prompt).toMatch(/^Replace the person on the right in Video 1 with the character in Image 1\./);
    // The character first, then the anchor frame made from the part's first frame.
    const anchor = gens.getGeneration(rows.find((r) => r.model_id === "gpt-image-2-5-sunburst")!.id)!;
    expect(swap.request.inputs?.images).toEqual([hero, anchor.outputs[0].url]);
  });

  it("Character swap on the open engine: the first frame, the anchor on Qwen-Image-Edit, one H3 job on the upload", async () => {
    const { final } = await run(body({ engine: "open", mode: "character", range: { start: 2, end: 9 }, character: { who: "index", index: 1, subject: "the drummer", lora: "v1" } }));
    const rows = batchOf(final.id);
    expect(rows.map((r) => r.model_id).sort()).toEqual(["fuobe-character-swap", "oss-extract-frame", "oss-qwen-edit"]);
    expect(final.modelId).toBe("fuobe-character-swap");
    expect(final.request.params).toMatchObject({ startTime: 2, endTime: 9, resolution: "768p", extra: { selection: "index", subjectIndex: 1, maskPrompt: "the drummer", lora: "v1" } });
    expect((await settle(final.id)).status).toBe("succeeded");
  });
});
