import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { detectCuts, finalKey, katanaStage, katanaSteps, nearestAspect, planSegments } from "@/lib/av/katana";
import { frameParams, frameRequest } from "@/lib/av/frames";

vi.setConfig({ testTimeout: 150_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-av-katana-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const katana = await import("@/server/katana");
const { getTool } = await import("@/server/assist/tools");
const { saveFile } = await import("@/server/storage");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function settle(id: string, ms = 140_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const file = (name: string, type: string) => saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples", name)), contentType: type, source: "upload" }).url;

describe("katana segment planning", () => {
  it("finds scene cuts as spikes over the clip's usual change", () => {
    const times = Array.from({ length: 21 }, (_, i) => i * 0.5);
    const diffs = times.slice(1).map((_, i) => (i === 5 || i === 13 ? 0.6 : i === 14 ? 0.5 : 0.02));
    // Spikes between 2.5–3.0 s and 6.5–7.0 s; the one right after (7.0–7.5) is within the minimum gap.
    expect(detectCuts(diffs, times)).toEqual([2.75, 6.75]);
    expect(detectCuts(diffs.map(() => 0.03), times)).toEqual([]);
  });

  it("cuts every N seconds, evenly, within the model's limits", () => {
    expect(planSegments({ duration: 12, mode: "fixed", length: 5, min: 3, max: 5 })).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
      { start: 8, end: 12 },
    ]);
    expect(planSegments({ duration: 4, mode: "fixed", length: 10, min: 3, max: 10 })).toEqual([{ start: 0, end: 4 }]);
    // References over 30 s are cut to the first 30 s.
    expect(planSegments({ duration: 45, mode: "fixed", length: 10, min: 3, max: 10 }).at(-1)!.end).toBe(30);
  });

  it("follows the scene cuts: short scenes join a neighbour, long ones are split", () => {
    expect(planSegments({ duration: 12, mode: "scenes", cuts: [0.5, 4, 4.8, 9], min: 1, max: 5 })).toEqual([
      { start: 0, end: 4.8 },
      { start: 4.8, end: 9 },
      { start: 9, end: 12 },
    ]);
    expect(planSegments({ duration: 14, mode: "scenes", cuts: [], min: 1, max: 5 })).toEqual([
      { start: 0, end: 4.67 },
      { start: 4.67, end: 9.33 },
      { start: 9.33, end: 14 },
    ]);
    expect(() => planSegments({ duration: 30, mode: "fixed", length: 1, min: 1, max: 1 })).toThrow(/up to 12/);
  });

  it("picks the nearest render shape", () => {
    expect(nearestAspect(1920, 1080)).toBe("16:9");
    expect(nearestAspect(1080, 1920)).toBe("9:16");
    expect(nearestAspect(1000, 1100)).toBe("1:1");
  });
});

describe("frame requests", () => {
  it("cloud: first/last frame; open: a decoded window", () => {
    expect(frameParams("cloud", "last")).toEqual({ extra: { frame_type: "last" } });
    expect(() => frameParams("cloud", { at: 2 })).toThrow(/trim the clip first/);
    expect(frameParams("open", "last")).toBeUndefined();
    expect(frameParams("open", { at: 2.5 })).toEqual({ startTime: 2.5, endTime: 3, extra: { frameIndex: 0 } });
    expect(frameRequest({ feature: "x", engine: "open", video: "/v.mp4", pick: "first" })).toMatchObject({ modelId: "oss-extract-frame", op: "frame", inputs: { video: "/v.mp4" }, params: { startTime: 0 } });
  });
});

describe("katana steps", () => {
  const segments = [
    { start: 0, end: 4 },
    { start: 4, end: 8 },
  ];
  const photos = ["/a.png", "/b.png", "/c.png"];

  it("open: cut → first frame → your subject → Wan Animate per segment, joined, original sound", () => {
    const steps = katanaSteps({ engine: "open", reference: "/ref.mp4", photos, segments, aspectRatio: "9:16", title: "My edit" });
    expect(steps.map((s) => [s.key, s.request.modelId, s.request.op])).toEqual([
      ["cut0", "oss-segment", "trim"],
      ["frame0", "oss-extract-frame", "frame"],
      ["key0", "oss-qwen-edit", "edit"],
      ["move0", "oss-wan22-animate", "motion-transfer"],
      ["cut1", "oss-segment", "trim"],
      ["frame1", "oss-extract-frame", "frame"],
      ["key1", "oss-qwen-edit", "edit"],
      ["move1", "oss-wan22-animate", "motion-transfer"],
      ["join", "oss-join-clips", "concat"],
      ["final", "oss-mux", "mux"],
    ]);
    expect(steps[0].request.params).toMatchObject({ startTime: 0, endTime: 4, aspectRatio: "9:16" });
    // Qwen-Image-Edit gets the frame first, then two photos.
    expect(steps[2]).toMatchObject({ after: "frame0", chain: [{ slot: "images", position: "first" }], request: { inputs: { images: ["/a.png", "/b.png"] } } });
    expect(steps[3]).toMatchObject({ after: ["key0", "cut0"], chain: [{ slot: "images", position: "first" }, { slot: "video" }] });
    expect(steps[8]).toMatchObject({ after: ["move0", "move1"], chain: [{ slot: "videos" }, { slot: "videos" }] });
    expect(steps[9]).toMatchObject({ after: "join", chain: [{ slot: "video" }], request: { inputs: { audio: "/ref.mp4" } } });
    expect(finalKey(steps)).toBe("final");
  });

  it("open joins fold 4 clips at a time", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ start: i * 4, end: i * 4 + 4 }));
    const steps = katanaSteps({ engine: "open", reference: "/r.mp4", photos, segments: six, keepAudio: false });
    const joins = steps.filter((s) => s.request.op === "concat");
    expect(joins.map((s) => [s.key, s.after])).toEqual([
      ["join0", ["move0", "move1", "move2", "move3"]],
      ["join", ["join0", "move4", "move5"]],
    ]);
    expect(finalKey(steps)).toBe("join");
  });

  it("cloud: trim → first frame → Nano Banana Pro → Kling O3 edit with the new keyframe first", () => {
    const steps = katanaSteps({ engine: "cloud", reference: "/ref.mp4", photos, segments });
    expect(steps.slice(0, 4).map((s) => [s.key, s.request.modelId])).toEqual([
      ["cut0", "trim-video"],
      ["frame0", "extract-frame"],
      ["key0", "nano-banana-pro"],
      ["move0", "kling-o3"],
    ]);
    expect(steps[1].request.params).toEqual({ extra: { frame_type: "first" } });
    expect(steps[3]).toMatchObject({ after: ["cut0", "key0"], chain: [{ slot: "video" }, { slot: "images", position: "first" }], request: { op: "v2v", inputs: { images: ["/a.png", "/b.png", "/c.png"] } } });
    expect(steps.at(-1)!.request.modelId).toBe("merge-audio-video");
  });

  it("refuses segments the motion model can't take", () => {
    expect(() => katanaSteps({ engine: "open", reference: "/r", photos, segments: [{ start: 0, end: 8 }] })).toThrow(/up to 5 s/);
    expect(() => katanaSteps({ engine: "cloud", reference: "/r", photos, segments: [{ start: 0, end: 2 }] })).toThrow(/at least 3 s/);
    expect(() => katanaSteps({ engine: "cloud", reference: "/r", photos: [], segments })).toThrow(/at least one photo/);
  });
});

describe("katana runs (demo mode)", () => {
  it("runs every step and finishes with the edit", async () => {
    const reference = file("demo-portrait.mp4", "video/mp4");
    const photo = file("grade-sample.jpg", "image/jpeg");
    const preview = katana.previewKatana({ engine: "open", reference, photos: [photo], duration: 8, length: 4 });
    expect(preview.segments).toHaveLength(2);
    expect(preview.steps).toBe(10);
    const job = katana.createKatana({ engine: "open", reference, photos: [photo], duration: 8, length: 4, instructions: "keep the red jacket", title: "Dance" });
    expect(Object.keys(job.steps)).toHaveLength(10);
    expect(job.generations[job.steps.key0].request.prompt).toContain("keep the red jacket");
    const final = await settle(job.steps[job.final]);
    expect(final.status).toBe("succeeded");
    expect(katanaStage(katana.getKatana(job.id)!)).toBe("done");
    expect(katana.listKatana().map((j) => j.id)).toContain(job.id);
  });

  it("is an Assist tool with a priced plan", () => {
    const reference = file("demo-landscape.mp4", "video/mp4");
    const photo = file("grade-sample.jpg", "image/jpeg");
    const tool = getTool("katana")!;
    expect(tool.gated).toBe(true);
    const [job] = tool.plan!({ reference, photos: [photo], segment_seconds: 4 }, { engine: "open" });
    expect(job).toMatchObject({ tool: "katana", kind: "video", modelId: "oss-wan22-animate" });
    expect(job.error).toBeUndefined();
    expect(tool.plan!({ reference: "nope", photos: [] }, { engine: "cloud" })[0].error).toBeTruthy();
  });
});
