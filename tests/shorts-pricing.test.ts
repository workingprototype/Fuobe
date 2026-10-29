import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { getMaker, planGenjutsu } from "@/lib/catalog/genjutsu";
import { MIXED_MODELS, MIXED_PRESETS, defaultValues, mixedFrames, planMixed, type MixedPlanInput } from "@/lib/catalog/mixed-media";
import { estimateCost, routesFor } from "@/lib/catalog/plan";
import { clipLengthProblem, lookFromPreset, planCloudSegments, planShorts, SHORTS_MODELS, SHORTS_PRESETS, type ShortsPlanInput } from "@/lib/catalog/shorts";
import { modelInfos, sourceSeconds, unitPrice } from "@/lib/catalog/shorts-models";

const shorts = (over: Partial<ShortsPlanInput> = {}): ShortsPlanInput => ({
  engine: "cloud",
  title: "Claymation · beach",
  source: { url: "/api/files/uploads/beach.mp4", duration: 47, hasAudio: true },
  range: { start: 0, end: 47 },
  look: lookFromPreset(SHORTS_PRESETS[0]),
  aspectRatio: "9:16",
  language: "auto",
  modelId: "gemini-omni-flash",
  maxRefs: 0,
  ...over,
});

describe("restyle prices", () => {
  it("prices Gemini Omni Flash by resolution: 720p (what Shorts asks for) is $0.10/s, not the 360p rate", () => {
    const gemini = getModel("gemini-omni-flash")!;
    expect(estimateCost(gemini, { resolution: "720p", duration: 10 })).toBeCloseTo(1.0);
    expect(estimateCost(gemini, { resolution: "360p", duration: 10 })).toBeCloseTo(0.3);
    expect(estimateCost(gemini, { resolution: "1080p", duration: 10 })).toBeCloseTo(1.5);
    expect(estimateCost(gemini, { resolution: "4k", duration: 10 })).toBeCloseTo(3.0);
    // No resolution asked: the model's default (720p).
    expect(estimateCost(gemini, { duration: 10 })).toBeCloseTo(1.0);
    expect(unitPrice(gemini)).toBeCloseTo(0.1);
    expect(modelInfos(["gemini-omni-flash"])[0].price).toBe("$0.10 / s");
  });

  it("prices Happy Horse video edit at $0.28 a second of clip at 720p: fal's $0.14 per input second plus $0.14 per output second, not twice that", () => {
    const hh = getModel("happy-horse-video-edit")!;
    expect(estimateCost(hh, { resolution: "720p", duration: 10 })).toBeCloseTo(2.8);
    expect(estimateCost(hh, { resolution: "1080p", duration: 10 })).toBeCloseTo(5.6);
    expect(unitPrice(hh)).toBeCloseTo(0.28);
    expect(modelInfos(["happy-horse-video-edit"])[0].price).toBe("$0.28 / s");
    // It reads up to 60 s but returns at most the first 15 s: a longer cut is refused before it's paid for.
    expect(sourceSeconds("happy-horse-video-edit")).toEqual({ min: 3, max: 15 });
    // Every studio that restyles on it pays $0.28 for each second of the selection at 720p (what they ask for).
    const shortsPlan = planShorts(shorts({ modelId: "happy-horse-video-edit", maxRefs: 4, resolution: "720p" }));
    const looks = shortsPlan.steps.filter((s) => s.request.modelId === "happy-horse-video-edit");
    expect(looks).toHaveLength(5);
    expect(looks.reduce((n, s) => n + estimateCost(hh, s.request.params!, 1, s.request.op)!, 0)).toBeCloseTo(0.28 * 47, 2);
    const fast = planMixed({
      engine: "cloud",
      title: "Sketch · skate",
      preset: MIXED_PRESETS[0],
      values: defaultValues(MIXED_PRESETS[0]),
      source: { url: "/api/files/skate.mp4", duration: 12, hasAudio: true },
      range: { start: 1, end: 9 },
      fps: 8,
      resolution: "1K",
      modelId: "happy-horse-video-edit",
      mode: "fast",
    }).steps.find((s) => s.request.modelId === "happy-horse-video-edit")!;
    expect(estimateCost(hh, fast.request.params!, 1, fast.request.op)).toBeCloseTo(0.28 * 8, 2);
    const genjutsu = planGenjutsu({
      engine: "cloud",
      mode: "restyle",
      maker: getMaker("happy-horse-video-edit", "cloud")!,
      title: "Genjutsu",
      source: { url: "/api/files/clip.mp4", duration: 20, fps: 30, width: 1280, height: 720, hasAudio: true },
      range: { start: 0, end: 20 },
      quality: "720p",
      references: [],
      look: { kind: "preset", id: "shorts-claymation" },
    }).steps.filter((s) => s.request.modelId === "happy-horse-video-edit");
    expect(genjutsu.length).toBeGreaterThan(0);
    expect(genjutsu.reduce((n, s) => n + estimateCost(hh, s.request.params!, 1, s.request.op)!, 0)).toBeCloseTo(0.28 * 20, 2);
  });

  it("never tells a restyle model a length: each keeps its clip's (Wan's 5 s default would cut segments short)", () => {
    for (const id of new Set([...SHORTS_MODELS.cloud, ...MIXED_MODELS.cloud])) {
      for (const r of routesFor(getModel(id)!, "v2v")) expect(r.map?.duration, `${id} ${r.endpoint}`).toBeUndefined();
    }
  });
});

describe("restyled segments stay in sync with the original sound", () => {
  it("asks for (and prices) every segment at its exact length, so they add up to the selection", () => {
    for (const [start, end] of [
      [0, 47],
      [1.5, 9.3],
      [3.2, 120],
      [0, 10.1],
    ]) {
      for (const modelId of SHORTS_MODELS.cloud) {
        const plan = planShorts(shorts({ modelId, range: { start, end }, source: { url: "/api/files/x.mp4", duration: 130, hasAudio: true } }));
        const looks = plan.steps.filter((s) => s.request.op === "v2v");
        // Fuobe Shorts is billed on frames ÷ 16 (duration); its segments' own lengths are sourceDuration.
        const sum = looks.reduce((n, s) => n + ((s.request.params!.sourceDuration ?? s.request.params!.duration) as number), 0);
        expect(sum).toBeCloseTo(end - start, 2);
      }
    }
    // 47 s → five 9.4 s segments (not 9 s each: 45 s of picture under 47 s of sound).
    expect(planCloudSegments({ start: 0, end: 47 }).map((s) => Math.round((s.end - s.start) * 10) / 10)).toEqual([9.4, 9.4, 9.4, 9.4, 9.4]);
    const wan = planShorts(shorts({ modelId: "wan-2-7" }));
    expect(wan.steps.find((s) => s.key === "look0")!.request.params!.duration).toBe(9.4);
  });

  it("Mixed Media: the cloud render is asked for the cut's exact length; the open render for floor(s × fps) frames", () => {
    const sketch = MIXED_PRESETS.find((p) => p.id === "mixed-sketch")!;
    const mm = (over: Partial<MixedPlanInput>): MixedPlanInput => ({
      engine: "cloud",
      title: "Sketch · skate",
      preset: sketch,
      values: defaultValues(sketch),
      source: { url: "/api/files/skate.mp4", duration: 12, hasAudio: true },
      range: { start: 1.3, end: 2.7 },
      fps: 8,
      resolution: "1K",
      modelId: "wan-2-7",
      ...over,
    });
    const cloud = planMixed(mm({ mode: "fast" }));
    expect(cloud.steps.find((s) => s.key === "render")!.request.params!.duration).toBe(1.4);
    const open = planMixed(mm({ engine: "open", modelId: "oss-mixed-media", range: { start: 0, end: 10 } }));
    expect(open.steps[0].request.params!.extra).toMatchObject({ frames: 80 });
    expect(mixedFrames(10, 8)).toBe(80);
    const open24 = planMixed(mm({ engine: "open", modelId: "oss-mixed-media", range: { start: 0, end: 10 }, fps: 24 }));
    expect(open24.steps[0].request.params!.extra).toMatchObject({ frames: 240 });
  });
});

describe("clip lengths each restyle model takes", () => {
  it("knows the research windows and words the problem", () => {
    expect(sourceSeconds("kling-o3-4k-edit")).toEqual({ min: 3, max: 15 });
    expect(sourceSeconds("wan-2-7")).toEqual({ min: 2, max: 10 });
    expect(sourceSeconds("ltx-2-3-restyle")).toEqual({});
    const [kling] = modelInfos(["kling-o3-4k-edit"]);
    expect(kling).toMatchObject({ minSeconds: 3, maxSeconds: 15 });
    expect(clipLengthProblem(kling, 1.4)).toBe("Kling O3 4K Edit needs at least 3 s");
    expect(clipLengthProblem(kling, 3)).toBeNull();
    expect(clipLengthProblem(kling, 16)).toBe("Kling O3 4K Edit takes up to 15 s");
    expect(clipLengthProblem(modelInfos(["ltx-2-3-restyle"])[0], 1)).toBeNull();
  });
});
