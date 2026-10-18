import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 120_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-shorts-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");
const shorts = await import("@/server/shorts");
const mixed = await import("@/server/mixed-media");
const sessionsRoute = await import("@/app/api/shorts/sessions/route");
const sessionRoute = await import("@/app/api/shorts/sessions/[id]/route");
const regenRoute = await import("@/app/api/shorts/sessions/[id]/segments/[index]/route");
const primaryRoute = await import("@/app/api/shorts/sessions/[id]/segments/[index]/primary/route");
const stitchRoute = await import("@/app/api/shorts/sessions/[id]/stitch/route");
const estimateRoute = await import("@/app/api/shorts/estimate/route");
const presetsRoute = await import("@/app/api/shorts/presets/route");
const mixedRoute = await import("@/app/api/mixed-media/route");
const mixedPreviewRoute = await import("@/app/api/mixed-media/preview/route");
const mixedEstimateRoute = await import("@/app/api/mixed-media/estimate/route");

const json = (method: string, body?: unknown) =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) }) as never;

let clip = "";
let png = "";

beforeAll(() => {
  setSetting("demoMode", "auto");
  // A 12 s, 16 fps clip with a sound track.
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "beach day.mp4" }).url;
  png = saveFile({ data: Buffer.from("89504e470d0a1a0a", "hex"), contentType: "image/png", source: "upload" }).url;
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

const dependsOn = (id: string) => {
  const v = (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null }).depends_on;
  return !v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v];
};

const body = (over: Record<string, unknown> = {}) => ({
  engine: "cloud",
  presetId: "shorts-claymation",
  source: { url: clip, name: "beach day.mp4" },
  range: { start: 0, end: 12 },
  aspectRatio: "9:16",
  language: "auto",
  ...over,
});

describe("Shorts sessions", () => {
  it("reads the clip's length, frame rate and sound from its header", async () => {
    const info = await shorts.probeSource(clip);
    expect(info.duration).toBeCloseTo(12, 1);
    expect(info.fps).toBeCloseTo(16, 1);
    expect(info.hasAudio).toBe(true);
    await expect(shorts.probeSource("https://example.com/x.mp4")).rejects.toThrow(/Upload the clip first/);
  });

  it("estimates before anything is made: demo is free, a connected provider is priced per second", async () => {
    const demo = await (await estimateRoute.POST(json("POST", body({ source: { url: "/api/files/placeholder.mp4", duration: 12 } })))).json();
    expect(demo).toMatchObject({ demo: true, costUsd: 0, segments: 2, seconds: 12 });
    setSetting("falKey", "test-key");
    try {
      const est = await shorts.estimateShorts(body({ source: { url: clip, duration: 12 } }) as never);
      expect(est.demo).toBe(false);
      // Gemini Omni Flash at $0.03/s: two 6 s segments, plus the cuts, the join and the soundtrack (≈ free).
      expect(est.costUsd!).toBeGreaterThanOrEqual(0.36);
      expect(est.costUsd!).toBeLessThan(0.4);
      expect(est.perSegmentUsd!).toBeGreaterThanOrEqual(0.18);
      expect(est.perSegmentUsd!).toBeLessThan(0.2);
      expect(est.notes.join(" ")).toMatch(/keeps your clip's shape/);
    } finally {
      setSetting("falKey", "");
    }
    const bad = await estimateRoute.POST(json("POST", body({ range: { start: 0, end: 2 } })));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Select at least 4 seconds");
  });

  let sessionId = "";

  it("creates a cloud session: segments cut and restyled, stitched under the original sound", async () => {
    const res = await sessionsRoute.POST(json("POST", body()));
    expect(res.status).toBe(201);
    const s = await res.json();
    sessionId = s.id;
    expect(s).toMatchObject({ title: "Claymation · beach day", engine: "cloud", range: { start: 0, end: 12 }, settings: { aspectRatio: "9:16", modelId: "gemini-omni-flash", maxRefs: 0, resolution: "720p" } });
    expect(s.source).toMatchObject({ hasAudio: true });
    expect(s.segments).toHaveLength(2);
    expect(s.segments.map((g: { start: number; end: number }) => [g.start, g.end])).toEqual([
      [0, 6],
      [6, 12],
    ]);
    const [a, b] = s.segments;
    expect(a.primary).toBe(a.takes[0].look);
    expect(dependsOn(a.takes[0].look)).toEqual([a.takes[0].cut]);
    const look = gens.getGeneration(a.takes[0].look)!;
    expect(look).toMatchObject({ modelId: "gemini-omni-flash", op: "v2v", feature: "shorts" });
    expect(look.request.step?.label).toBe("Segment 1 of 2 · restyle");
    const stitch = s.stitches[0];
    const final = gens.getGeneration(stitch.final)!;
    expect(final).toMatchObject({ modelId: "merge-audio-video", op: "mux" });
    // The whole clip: the upload carries the sound; the join waits for both restyles.
    expect(final.request.inputs?.audio).toBe(clip);
    const join = stitch.ids.find((id: string) => gens.getGeneration(id)!.op === "concat");
    expect(dependsOn(join)).toEqual([a.takes[0].look, b.takes[0].look]);
    expect(dependsOn(stitch.final)).toEqual([join]);
    expect(await settle(stitch.final)).toMatchObject({ status: "succeeded" });
  });

  it("returns the session with its generations, and lists it in History", async () => {
    // (GET handlers call connection(), which needs a request scope: read through the server module.)
    const s = shorts.getSession(sessionId);
    expect(Object.keys(s.generations).length).toBe(6);
    expect(shorts.regenerateCost(s)).toBe(0);
    const list = shorts.listSessions();
    expect(list[0]).toMatchObject({ id: sessionId, lookName: "Claymation", segments: 2, seconds: 12, status: "ready" });
    expect(list[0].cover!.op).toBe("mux");
  });

  it("regenerates a segment, picks the new take and stitches again", async () => {
    const res = await regenRoute.POST(json("POST"), params({ id: sessionId, index: "1" }));
    expect(res.status).toBe(201);
    const s = await res.json();
    const seg = s.segments[1];
    expect(seg.takes).toHaveLength(2);
    // The first take is fine, so it stays the chosen one until the user picks.
    expect(seg.primary).toBe(seg.takes[0].look);
    const fresh = seg.takes[1].look;
    expect(gens.getGeneration(fresh)!.request.params?.seed).toEqual(expect.any(Number));
    await settle(fresh);
    const picked = await (await primaryRoute.POST(json("POST", { generationId: fresh }), params({ id: sessionId, index: "1" }))).json();
    expect(picked.segments[1].primary).toBe(fresh);
    const wrong = await primaryRoute.POST(json("POST", { generationId: "nope" }), params({ id: sessionId, index: "1" }));
    expect(wrong.status).toBe(400);
    const st = await (await stitchRoute.POST(json("POST"), params({ id: sessionId }))).json();
    expect(st.stitches).toHaveLength(2);
    const last = st.stitches[1];
    expect(last.clips).toEqual([st.segments[0].primary, fresh]);
    const join = gens.getGeneration(last.ids[0])!;
    // Finished takes are joined by file: nothing to wait for.
    expect(join.request.inputs?.videos).toHaveLength(2);
    expect(dependsOn(join.id)).toEqual([]);
    expect(await settle(last.final)).toMatchObject({ status: "succeeded", op: "mux" });
  });

  it("won't stitch while a segment is still rendering", async () => {
    const s = shorts.regenerateSegment(sessionId, 0);
    const take = s.segments[0].takes.at(-1)!.look;
    shorts.makePrimary(sessionId, 0, take);
    const res = await stitchRoute.POST(json("POST"), params({ id: sessionId }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Segment 1 is still rendering");
    await settle(take);
  });

  it("trims: the segments start at the selection and the sound is the source cut to it", async () => {
    const s = await shorts.createSession(body({ range: { start: 1.5, end: 9.5 } }) as never);
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toMatchObject({ start: 1.5, end: 9.5 });
    const final = gens.getGeneration(s.stitches[0].final)!;
    const deps = dependsOn(final.id).map((id) => gens.getGeneration(id)!);
    expect(deps.map((g) => g.op)).toEqual(["v2v", "trim"]);
    expect(deps[1].request.params).toMatchObject({ startTime: 1.5, endTime: 9.5 });
    // The mux takes the cut clip's soundtrack (an audio slot fed by a video).
    expect(await settle(final.id)).toMatchObject({ status: "succeeded" });
  });

  it("runs the open engine: segment (+ first frame) → Qwen first-frame restyle → Wan VACE → join → soundtrack", async () => {
    const s = await shorts.createSession(body({ engine: "open" }) as never);
    expect(s.settings.modelId).toBe("oss-wan22-vace-restyle");
    expect(s.segments.map((g) => g.frames)).toEqual([65, 65, 61]);
    const take = s.segments[2].takes[0];
    expect(gens.getGeneration(take.cut)).toMatchObject({ modelId: "oss-segment", op: "trim" });
    expect(gens.getGeneration(take.frame!)).toMatchObject({ modelId: "oss-qwen-edit", op: "edit" });
    expect(dependsOn(take.look)).toEqual([take.cut, take.frame]);
    const final = await settle(s.stitches[0].final);
    expect(final).toMatchObject({ status: "succeeded", modelId: "oss-mux" });
    // The first-frame restyle got the segment's first frame.
    const frame = gens.getGeneration(take.frame!)!;
    expect(frame.status).toBe("succeeded");
    expect(frame.request.inputs?.images?.[0]).toMatch(/^\/api\/files\//);
  });

  it("custom presets: references go to models that take them", async () => {
    const res = await presetsRoute.POST(json("POST", { description: "dusty desert film", references: [png, png] }));
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p).toMatchObject({ name: "Dusty desert film", references: [png] });
    expect(shorts.listCustomPresets().map((x) => x.id)).toContain(p.id);
    const kling = await shorts.createSession(body({ presetId: p.id, modelId: "kling-o3-4k-edit", range: { start: 0, end: 8 } }) as never);
    expect(kling.settings.maxRefs).toBe(4);
    const look = gens.getGeneration(kling.segments[0].takes[0].look)!;
    expect(look.request.inputs?.images).toEqual([png]);
    expect(look.request.prompt).toMatch(/^Restyle this video as the look of the reference images: dusty desert film\./);
    const est = await shorts.estimateShorts(body({ presetId: p.id }) as never);
    expect(est.refsSent).toBe(0);
    expect(est.notes[0]).toMatch(/restyles from words only/);
  });

  it("respects the engine mode", async () => {
    setSetting("engineMode", "open");
    try {
      const res = await sessionsRoute.POST(json("POST", body()));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/open-source models only/);
    } finally {
      setSetting("engineMode", "both");
    }
  });

  it("deletes a session and moves its videos to the Trash", async () => {
    const ids = shorts.sessionIds(shorts.getSession(sessionId));
    const res = await sessionRoute.DELETE(json("DELETE"), params({ id: sessionId }));
    expect((await res.json()).trashed).toBe(ids.length);
    expect(gens.getGeneration(ids[0])).toBeNull();
    expect(() => shorts.getSession(sessionId)).toThrow(/no longer exists/);
  });
});

describe("Mixed Media renders", () => {
  const mm = (over: Record<string, unknown> = {}) => ({
    engine: "open",
    presetId: "mixed-sketch",
    values: { ink: "#c1121f", intensity: "bold" },
    source: { url: clip, name: "skate.mp4" },
    range: { start: 2, end: 7 },
    fps: 24,
    resolution: "1K",
    ...over,
  });

  it("estimates frames as floor(seconds × fps) and caps the frame rate at the clip's", async () => {
    const est = await (await mixedEstimateRoute.POST(json("POST", mm({ source: { url: "/api/files/placeholder.mp4", duration: 12, fps: 16 } })))).json();
    expect(est).toMatchObject({ frames: 80, fps: 16, demo: true, costUsd: 0, previewUsd: 0 });
  });

  it("renders on the open engine in one per-frame job", async () => {
    const res = await mixedRoute.POST(json("POST", mm()));
    expect(res.status).toBe(201);
    const { final, items } = await res.json();
    expect(items).toHaveLength(1);
    expect(final).toMatchObject({ modelId: "oss-mixed-media", feature: "mixed-media", request: { title: "Sketch · skate" } });
    expect(final.request.params).toMatchObject({ startTime: 2, endTime: 7, fps: 16, extra: { denoise: 0.82 } });
    expect(final.request.prompt).toMatch(/deep red \(#C1121F\) ink/);
    expect(await settle(final.id)).toMatchObject({ status: "succeeded" });
  });

  it("renders on the cloud: cut → restyle anchored on the preview still → the cut's sound", async () => {
    const preview = await (await mixedPreviewRoute.POST(json("POST", mm({ engine: "cloud", frameUrl: png })))).json();
    expect(preview).toMatchObject({ modelId: "nano-banana-2", op: "edit", feature: "mixed-media-preview" });
    const still = await settle(preview.id);
    const anchor = still.outputs[0].url;
    const { final, items } = await mixed.createMixed(mm({ engine: "cloud", anchor }) as never);
    expect(items.map((g) => g.modelId)).toEqual(["trim-video", "ltx-2-3-restyle", "merge-audio-video"]);
    expect(items[1].request.inputs?.images).toEqual([anchor]);
    expect(items[1].request.params?.extra).toEqual({ preprocessor: "canny" });
    expect(dependsOn(final.id)).toEqual([items[1].id, items[0].id]);
    expect(await settle(final.id)).toMatchObject({ status: "succeeded", feature: "mixed-media" });
  });

  it("asks for a grabbed frame before a cloud preview", async () => {
    const res = await mixedPreviewRoute.POST(json("POST", mm({ engine: "cloud" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Couldn't grab a frame/);
  });
});
