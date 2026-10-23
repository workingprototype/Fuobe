import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-chains-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { createStoryboard, createStoryboardFilm } = await import("@/server/storyboard");
const { db } = await import("@/server/db");
const { getModel } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { getPreset } = await import("@/lib/catalog");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const dependsOn = (id: string) => {
  const v = (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null }).depends_on;
  return !v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v];
};

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("chain inputs", () => {
  it("puts each dependency's output in its slot, keeping dependency order in lists", () => {
    const req = {
      feature: "x",
      modelId: "m",
      inputs: { images: ["own.png"], videos: ["orig.mp4"] },
      chain: [{ slot: "images" as const, position: "first" as const }, { slot: "images" as const, position: "first" as const }, { slot: "endImage" as const }, { slot: "videos" as const }],
    };
    expect(gens.withChainInputs(req, ["a.png", "b.png", "end.png", "new.mp4"]).inputs).toEqual({
      images: ["a.png", "b.png", "own.png"],
      videos: ["orig.mp4", "new.mp4"],
      endImage: "end.png",
    });
    // The single-dependency form storyboards use.
    expect(gens.withChainInputs({ feature: "x", modelId: "m", chainFrom: "first", inputs: { images: ["ref.png"] } }, ["prev.png"]).inputs?.images).toEqual(["prev.png", "ref.png"]);
  });
});

describe("open multi-shot", () => {
  it("validates each shot against the model, not the total", () => {
    const shots = [
      { prompt: "wide", duration: 5 },
      { prompt: "close", duration: 5 },
      { prompt: "end", duration: 5 },
    ];
    expect(() => planGeneration({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "x", params: { shots } }, getModel, getPreset)).not.toThrow();
    expect(() => planGeneration({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "x", params: { shots: [{ prompt: "a", duration: 9 }] } }, getModel, getPreset)).toThrow(/per shot/);
  });

  it("renders each shot, then joins them into one film", async () => {
    const { saveFile } = await import("@/server/storage");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e2b6a40000000049454e44ae426082", "hex");
    const start = saveFile({ data: png, contentType: "image/png", source: "upload" }).url;
    const items = gens.createGenerations({
      feature: "video",
      modelId: "oss-wan22-14b-fast",
      prompt: "A fox in the snow",
      inputs: { images: [start] },
      params: { aspectRatio: "16:9", shots: [{ prompt: "wide shot", duration: 3 }, { prompt: "close-up", duration: 5 }] },
    });
    const [film, ...shots] = items;
    expect(film.op).toBe("concat");
    expect(film.modelId).toBe("oss-join-clips");
    expect(shots.map((s) => s.request.step?.label)).toEqual(["Shot 1 of 2", "Shot 2 of 2"]);
    expect(shots.map((s) => s.op)).toEqual(["i2v", "t2v"]);
    expect(shots[1].request.prompt).toBe("A fox in the snow. close-up");
    expect(shots[1].request.params?.duration).toBe(5);
    expect(dependsOn(film.id)).toEqual(shots.map((s) => s.id));
    expect(new Set(items.map((g) => g.batchId)).size).toBe(1);
    const done = await settle(film.id);
    expect(done.status).toBe("succeeded");
    expect(done.request.inputs?.videos).toHaveLength(2);
  }, 45_000);

  it("refuses more shots than the model takes", () => {
    const shots = Array.from({ length: 5 }, (_, i) => ({ prompt: `s${i}`, duration: 3 }));
    expect(() => gens.createGenerations({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "x", params: { shots } })).toThrow(/up to 4 shots/);
  });
});

describe("Kling extend", () => {
  it("chains last frame → Kling image-to-video → join with the original", () => {
    const model = getModel("kling-3")!;
    expect(model.routes.some((r) => r.op === "extend")).toBe(true);
    const [film, clip, frame] = gens.createGenerations({ feature: "extend", modelId: "kling-3", op: "extend", prompt: "she keeps running", inputs: { video: "/api/files/placeholder.mp4" } });
    expect(frame).toMatchObject({ modelId: "extract-frame", op: "frame" });
    expect(clip).toMatchObject({ modelId: "kling-3", op: "i2v" });
    expect(film).toMatchObject({ modelId: "join-clips", op: "concat" });
    expect(dependsOn(clip.id)).toEqual([frame.id]);
    expect(dependsOn(film.id)).toEqual([clip.id]);
    expect(film.request.inputs?.videos).toEqual(["/api/files/placeholder.mp4"]);
    expect(film.request.chain).toEqual([{ slot: "videos" }]);
  });
});

describe("storyboard film", () => {
  it("animates each frame toward the next, then joins the clips", async () => {
    const board = await createStoryboard({ engine: "open", scenes: ["a lighthouse at dusk", "the keeper climbs the stairs", "the lamp turns on"] });
    const { items } = createStoryboardFilm(board.batchId);
    const [film, ...clips] = items;
    expect(clips).toHaveLength(3);
    expect(clips[0].modelId).toBe("oss-wan22-14b-fast");
    // Start and end frame for every shot but the last.
    expect(dependsOn(clips[0].id)).toEqual([board.items[0].id, board.items[1].id]);
    expect(clips[0].request.chain).toEqual([{ slot: "images", position: "first" }, { slot: "endImage" }]);
    expect(dependsOn(clips[2].id)).toEqual([board.items[2].id]);
    expect(dependsOn(film.id)).toEqual(clips.map((c) => c.id));
    expect(film.batchId).toBe(`${board.batchId}-film`);
    const done = await settle(film.id, 60_000);
    expect(done.status).toBe("succeeded");
    const first = gens.getGeneration(clips[0].id)!;
    expect(first.op).toBe("flf2v");
    expect(first.request.inputs?.endImage).toBe(gens.getGeneration(board.items[1].id)!.outputs[0].url);
  }, 70_000);

  it("joins long films in rounds of four on ComfyUI", async () => {
    const board = await createStoryboard({ engine: "open", scenes: ["1", "2", "3", "4", "5", "6"] });
    const { batchId, items } = createStoryboardFilm(board.batchId);
    const joins = gens.listGenerations({ batchId }).filter((g) => g.op === "concat");
    expect(joins).toHaveLength(2);
    // Clips 1–4 are joined first; the final join takes that plus clips 5 and 6.
    const clips = items.filter((g) => g.op !== "concat").map((g) => g.id);
    const final = items[0];
    const firstRound = joins.find((j) => j.id !== final.id)!;
    expect(dependsOn(firstRound.id)).toEqual(clips.slice(0, 4));
    expect(dependsOn(final.id)).toEqual([firstRound.id, ...clips.slice(4)]);
  });
});

describe("keyframe film (Frames mode on the open engine)", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e2b6a40000000049454e44ae426082", "hex");
  const frames = async (n: number) => {
    const { saveFile } = await import("@/server/storage");
    return Array.from({ length: n }, () => saveFile({ data: png, contentType: "image/png", source: "upload" }).url);
  };

  it("renders one Wan 2.2 start/end-frame clip per pair of frames, as long as each gap, then joins them", async () => {
    const images = await frames(4);
    const items = gens.createGenerations({
      feature: "video",
      modelId: "oss-wan22-14b-fast",
      op: "keyframes",
      prompt: "A paper boat drifts down the gutter",
      inputs: { images },
      params: { aspectRatio: "16:9", resolution: "480p", duration: 8, keyframeTimes: [0, 2.5, 4, 6.5] },
    });
    const [film, ...clips] = items;
    expect(film).toMatchObject({ modelId: "oss-join-clips", op: "concat" });
    expect(film.request.step?.label).toBe("Film · 4 frames");
    // Three pairs, then the 1.5 s after the last frame from that frame alone.
    expect(clips.map((c) => c.op)).toEqual(["flf2v", "flf2v", "flf2v", "i2v"]);
    expect(clips.map((c) => c.request.step?.label)).toEqual(["Frames 1 → 2", "Frames 2 → 3", "Frames 3 → 4", "After frame 4"]);
    expect(clips.map((c) => [c.request.inputs?.images, c.request.inputs?.endImage])).toEqual([
      [[images[0]], images[1]],
      [[images[1]], images[2]],
      [[images[2]], images[3]],
      [[images[3]], undefined],
    ]);
    // Seconds in Wan's 4n + 1 frame steps at 16 fps: 41, 25, 41 and 21 frames (128 in all, 8 s).
    expect(clips.map((c) => c.request.params?.duration)).toEqual([2.5, 1.5, 2.5, 1.25]);
    expect(clips.every((c) => c.request.params?.keyframeTimes === undefined && c.batchId === film.batchId)).toBe(true);
    expect(dependsOn(film.id)).toEqual(clips.map((c) => c.id));
    expect(film.costUsd).toBe(0);
    expect((await settle(film.id, 60_000)).status).toBe("succeeded");
  }, 70_000);

  it("makes one clip and no join for a start and an end frame", async () => {
    const images = await frames(2);
    const items = gens.createGenerations({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "dawn breaks", inputs: { images }, params: { duration: 5, keyframeTimes: [0, 5] } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ op: "flf2v", modelId: "oss-wan22-14b-fast" });
    expect(items[0].request.inputs).toEqual({ images: [images[0]], endImage: images[1] });
    expect(items[0].request.step).toBeUndefined();
  });

  it("checks the whole film before any clip starts", async () => {
    const images = await frames(3);
    const before = gens.listGenerations({ limit: 500 }).length;
    expect(() =>
      gens.createGenerations({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "x", inputs: { images }, params: { duration: 10, keyframeTimes: [0, 2, 9] } }),
    ).toThrow(/Frames 2 and 3 are 7 s apart/);
    expect(() => gens.createGenerations({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "", inputs: { images }, params: { duration: 5, keyframeTimes: [0, 2, 5] } })).toThrow(/prompt/);
    expect(gens.listGenerations({ limit: 500 }).length).toBe(before);
  });

  it("refuses to wait for another step's images", () => {
    expect(() =>
      gens.createGenerations({ feature: "canvas", modelId: "oss-wan22-14b-fast", op: "keyframes", prompt: "x", chain: [{ slot: "images" }, { slot: "images" }] }, { dependsOn: ["a", "b"] }),
    ).toThrow(/uploaded images, not another step's output/);
  });
});
