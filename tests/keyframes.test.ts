import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import {
  addFrameAt,
  chainGapProblem,
  frameRange,
  frameRole,
  frameSupport,
  framesBlocker,
  framesDuration,
  framesDurations,
  framesInputs,
  framesNote,
  frameTimes,
  keyframeChain,
  moveFrameAt,
  planKeyframeClips,
  positionsFrom,
  removeFrameAt,
  spread,
} from "@/lib/catalog/keyframes";
import { buildPayload } from "@/lib/catalog/payload";
import { inferOperation, planGeneration } from "@/lib/catalog/plan";
import { computeFrames } from "@/lib/comfy";

const m = (id: string) => getModel(id)!;
const plan = (r: Record<string, unknown>) => planGeneration({ feature: "video", prompt: "a fox runs through snow", ...r } as Parameters<typeof planGeneration>[0], getModel, getPreset);
const fails = (r: Record<string, unknown>) => {
  try {
    plan(r);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const imgs = (n: number) => Array.from({ length: n }, (_, i) => `/f${i}.png`);

describe("frame times", () => {
  it("spreads frames evenly and keeps doing so while they're untouched", () => {
    expect(spread(1)).toEqual([0]);
    expect(spread(3)).toEqual([0, 0.5, 1]);
    // Start, then end, then the middle.
    expect(addFrameAt([])).toEqual([0]);
    expect(addFrameAt([0])).toEqual([0, 1]);
    expect(addFrameAt([0, 1])).toEqual([0, 0.5, 1]);
    expect(addFrameAt(spread(4))).toEqual(spread(5));
    expect(removeFrameAt([0, 0.5, 1], 1)).toEqual([0, 1]);
  });

  it("keeps frames you placed where they are", () => {
    // The last frame isn't at the end: the new one goes there.
    expect(addFrameAt([0, 0.3])).toEqual([0, 0.3, 1]);
    // It is: it steps to halfway between its neighbour and the end.
    expect(addFrameAt([0, 0.2, 1])).toEqual([0, 0.2, 0.6, 1]);
    // Removing the start frame makes the next one the start.
    expect(removeFrameAt([0, 0.2, 0.7], 0)).toEqual([0, 0.7]);
    expect(removeFrameAt([0, 0.2, 0.7], 2)).toEqual([0, 0.2]);
  });

  it("turns positions into seconds snapped to 0.1 s, in order, inside the clip", () => {
    expect(frameTimes([0, 0.5, 1], 5)).toEqual([0, 2.5, 5]);
    expect(frameTimes(spread(4), 5)).toEqual([0, 1.7, 3.3, 5]);
    // Squeezed frames keep 0.1 s apart and step back from the end.
    expect(frameTimes([0, 0.99, 1, 1], 5)).toEqual([0, 4.8, 4.9, 5]);
    expect(frameTimes([0.4, 0.5], 4)).toEqual([0, 2]); // the first is always the start frame
    // A longer clip stretches them.
    expect(frameTimes([0, 0.5, 1], 8)).toEqual([0, 4, 8]);
  });

  it("names the frames as Kling 4.0 does", () => {
    expect([0, 1, 2].map((i) => frameRole(i, 3, [0, 0.5, 1][i]))).toEqual(["Start frame", "Middle frame", "End frame"]);
    // A last frame before the end is a middle frame too.
    expect(frameRole(1, 2, 0.6)).toBe("Middle frame");
  });

  it("drags a frame between its neighbours, snapped to 0.1 s; the start frame never moves", () => {
    const at = [0, 0.5, 1];
    expect(frameTimes(moveFrameAt(at, 1, 1.234, 5), 5)).toEqual([0, 1.2, 5]);
    expect(frameTimes(moveFrameAt(at, 1, 9, 5), 5)).toEqual([0, 4.9, 5]);
    expect(frameTimes(moveFrameAt(at, 1, -3, 5), 5)).toEqual([0, 0.1, 5]);
    expect(frameTimes(moveFrameAt(at, 2, 3.06, 5), 5)).toEqual([0, 2.5, 3.1]);
    expect(moveFrameAt(at, 0, 2, 5)).toBe(at);
    expect(frameRange([0, 2.5, 5], 1, 5)).toEqual([0.1, 4.9]);
    expect(frameRange([0, 2.5, 5], 2, 5)).toEqual([2.6, 5]);
    expect(frameRange([0, 2.5, 5], 0, 5)).toEqual([0, 0]);
    expect(positionsFrom([0, 2, 8], 8)).toEqual([0, 0.25, 1]);
  });
});

describe("what each model does with frames", () => {
  it("reads every frame, the ends only, or none", () => {
    expect(frameSupport(m("flux-3-max"))).toBe("all");
    expect(frameSupport(m("oss-wan22-14b-fast"))).toBe("all");
    expect(frameSupport(m("oss-wan22-14b"))).toBe("all");
    expect(frameSupport(m("kling-o3"))).toBe("ends");
    expect(frameSupport(m("seedance-2-5"))).toBe("ends");
    expect(frameSupport(m("oss-wan22-5b"))).toBe("start");
    expect(keyframeChain(m("oss-wan22-14b-fast"))?.endpoint).toBe("wan22-flf2v-14b");
    expect(keyframeChain(m("flux-3-max"))).toBeUndefined();
  });

  it("blocks models that can't follow frames, and asks for the start frame", () => {
    expect(framesBlocker(m("oss-wan22-5b"), 3)?.message).toBe("Wan 2.2 5B takes a start frame only — pick Wan 2.2 14B Lightning to follow your frames, or turn Frames off");
    const t2vOnly = { name: "Text Only", engine: "cloud" as const, routes: [{ op: "t2v" as const, provider: "fal" as const, endpoint: "x" }], options: {} };
    expect(framesBlocker(t2vOnly, 2)?.message).toBe("Text Only can't start from frames — pick FLUX 3 Max, or turn Frames off");
    expect(framesBlocker(m("flux-3-max"), 0)).toEqual({ message: "Add the start frame", slot: "frames" });
    expect(framesBlocker(m("flux-3-max"), 4)).toBeNull();
    expect(framesBlocker(m("kling-o3"), 4)).toBeNull();
  });

  it("says when a start + end frame model leaves frames out", () => {
    expect(framesNote(m("kling-o3"), 4)).toBe("Kling O3 Omni takes a start and an end frame, so it uses frames 1 and 4 and leaves out the 2 in between — FLUX 3 Max follows every frame.");
    expect(framesNote(m("kling-o3"), 3)).toMatch(/leaves out the middle one/);
    expect(framesNote(m("kling-o3"), 2, 0.6)).toBe("Kling O3 Omni puts the last frame at the end of the clip — FLUX 3 Max keeps it at its time.");
    expect(framesNote(m("kling-o3"), 2, 1)).toBeNull();
    expect(framesNote(m("flux-3-max"), 6)).toBeNull();
    expect(framesNote(m("oss-wan22-14b-fast"), 6)).toBeNull();
  });

  it("sends every frame with its time, or the first and last as start and end", () => {
    const refs = ["/a.png", "/b.png", "/c.png"];
    expect(framesInputs(refs, [0, 2, 5], "all")).toEqual({ images: refs, keyframeTimes: [0, 2, 5] });
    expect(framesInputs(refs, [0, 2, 5], "ends")).toEqual({ images: ["/a.png"], endImage: "/c.png" });
    expect(framesInputs(["/a.png"], [0], "all")).toEqual({ images: ["/a.png"] });
    expect(framesInputs([], [], "all")).toEqual({});
  });

  it("offers the model's lengths, or the open chain's longer films", () => {
    expect(framesDurations(m("flux-3-max"))).toEqual([5, 6, 8, 10, 12, 15, 20]);
    expect(framesDurations(m("oss-wan22-14b-fast"))).toEqual([3, 5, 8, 10, 15, 20, 30]);
    expect(framesDuration(m("flux-3-max"), 7)).toBe(6);
    expect(framesDuration(m("flux-3-max"), undefined)).toBe(5);
    expect(framesDuration(m("kling-o3"), 30)).toBe(15);
  });
});

describe("keyframes through the planner", () => {
  it("plans FLUX 3 Max keyframes and its payload at 24 fps", () => {
    const p = plan({ modelId: "flux-3-max", inputs: { images: imgs(4) }, params: { keyframeTimes: [0, 1.5, 3.2, 8], duration: 8 } });
    expect(p.op).toBe("keyframes");
    const route = getModel("flux-3-max")!.routes.find((r) => r.op === "keyframes")!;
    const body = buildPayload(route.map!, { prompt: p.prompt, images: imgs(4), keyframeTimes: [0, 1.5, 3.2, 8], duration: 8, aspectRatio: "16:9", resolution: "720p" });
    expect(body.keyframes).toEqual([
      { image_url: "/f0.png", frame_index: 0 },
      { image_url: "/f1.png", frame_index: 36 },
      { image_url: "/f2.png", frame_index: 77 },
      { image_url: "/f3.png", frame_index: 192 },
    ]);
    expect(body.duration).toBe(8);
    expect(body.image_url).toBeUndefined();
  });

  it("checks times and order on both engines", () => {
    expect(fails({ modelId: "flux-3-max", inputs: { images: imgs(3) }, params: { keyframeTimes: [0, 3, 2] } })).toBe("Keyframe times start at 0 or later and go up");
    expect(fails({ modelId: "oss-wan22-14b-fast", inputs: { images: imgs(3) }, params: { keyframeTimes: [0, 3] } })).toBe("Give each of the 3 keyframes a time");
    expect(fails({ modelId: "oss-wan22-14b-fast", op: "keyframes", inputs: { images: imgs(11) } })).toBe("Wan 2.2 14B Lightning takes up to 10 keyframes");
  });

  it("makes Frames mode a keyframes job on the open chain, and checks each gap against the model", () => {
    const wan = m("oss-wan22-14b-fast");
    expect(inferOperation(wan, { inputs: { images: imgs(3) }, params: { keyframeTimes: [0, 2, 5] } })).toBe("keyframes");
    expect(inferOperation(wan, { inputs: { images: ["/a.png"], endImage: "/b.png" } })).toBe("flf2v");
    expect(plan({ modelId: "oss-wan22-14b-fast", inputs: { images: imgs(3) }, params: { keyframeTimes: [0, 4, 8], duration: 8 } }).op).toBe("keyframes");
    expect(fails({ modelId: "oss-wan22-14b-fast", inputs: { images: imgs(3) }, params: { keyframeTimes: [0, 6, 8], duration: 8 } })).toBe(
      "Frames 1 and 2 are 6 s apart — Wan 2.2 14B Lightning makes up to 5 s between two frames. Move them closer or add a frame between them",
    );
    expect(fails({ modelId: "oss-wan22-14b-fast", inputs: { images: imgs(3) }, params: { keyframeTimes: [0, 2, 2.3], duration: 5 } })).toBe(
      "Frames 2 and 3 are only 0.3 s apart — keep at least 0.5 s between frames on Wan 2.2 14B Lightning",
    );
    expect(fails({ modelId: "oss-wan22-14b-fast", inputs: { images: imgs(2) }, params: { keyframeTimes: [0, 2], duration: 10 } })).toMatch(/^The clip runs 8 s past the last frame/);
    // Wan 2.2 14B (full quality) makes up to 7 s.
    expect(fails({ modelId: "oss-wan22-14b", inputs: { images: imgs(3) }, params: { keyframeTimes: [0, 6, 12], duration: 12 } })).toBeNull();
    // Without times (Assist, MCP, a canvas node) the frames are spread over the clip.
    expect(fails({ modelId: "oss-wan22-14b-fast", op: "keyframes", inputs: { images: imgs(3) }, params: { duration: 8 } })).toBeNull();
    expect(fails({ modelId: "oss-wan22-14b-fast", op: "keyframes", inputs: { images: imgs(3) }, params: { duration: 30 } })).toMatch(/15 s apart/);
  });
});

describe("the open per-pair plan", () => {
  const wan = { name: "Wan 2.2 14B Lightning", maxSeconds: 5, fps: 16, step: 4, maxFrames: 121 };

  it("makes one clip per gap, as long as the gap in Wan's 4n + 1 frame steps", () => {
    const clips = planKeyframeClips([0, 2.5, 5], 5, wan);
    expect(clips.map((c) => [c.from, c.to, c.frames])).toEqual([
      [0, 1, 41],
      [1, 2, 41],
    ]);
    expect(clips.map((c) => c.seconds)).toEqual([2.5, 2.5]);
    // The seconds asked for give the workflow exactly that frame count.
    for (const c of clips) expect(computeFrames(c.seconds, 16, 4, 121)).toBe(c.frames);
    expect(planKeyframeClips([0, 5], 5, wan).map((c) => c.frames)).toEqual([81]);
  });

  it("keeps every frame on its time within half a frame step, however many clips", () => {
    const times = [0, 1.3, 2.9, 3.4, 5.6, 7.7, 9.1, 12.4, 15, 19.8];
    const clips = planKeyframeClips(times, 20, wan);
    // Nine gaps; the 0.2 s after the last frame is under the minimum, so the film ends on it.
    expect(clips).toHaveLength(9);
    let total = 0;
    clips.forEach((c, i) => {
      expect((c.frames - 1) % 4).toBe(0);
      total += c.frames;
      if (c.to !== null) expect(Math.abs((total - 1) / 16 - times[i + 1])).toBeLessThanOrEqual(2 / 16 + 1e-9);
    });
  });

  it("adds the stretch after the last frame from that frame alone, unless it's too short", () => {
    const clips = planKeyframeClips([0, 2, 4], 6, wan);
    expect(clips.map((c) => [c.from, c.to])).toEqual([
      [0, 1],
      [1, 2],
      [2, null],
    ]);
    expect(clips[2].frames).toBe(33);
    expect(planKeyframeClips([0, 2, 4.8], 5, wan).map((c) => c.to)).toEqual([1, 2]);
  });

  it("refuses gaps the model can't make", () => {
    expect(() => planKeyframeClips([0, 5.5], 6, wan)).toThrow(/5.5 s apart/);
    expect(() => planKeyframeClips([0], 5, wan)).toThrow(/at least two frames/);
    expect(chainGapProblem([0, 2, 5], 5, wan)).toBeNull();
  });
});
