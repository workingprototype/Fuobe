import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import {
  clampFps,
  cleanValues,
  colorName,
  defaultValues,
  denoiseFor,
  fpsChoices,
  framesCost,
  getMixedPreset,
  MIXED,
  MIXED_MODELS,
  MIXED_PRESETS,
  MIXED_TOOLS,
  mixedFrames,
  mixedLook,
  mixedPrompts,
  mixedRangeProblem,
  nearestResolution,
  planMixed,
  planMixedPreview,
  settingWords,
  type MixedPlanInput,
} from "@/lib/catalog/mixed-media";
import { FX } from "@/lib/preset-cards";

const sketch = getMixedPreset("mixed-sketch")!;
const windows = getMixedPreset("mixed-windows")!;

const input = (over: Partial<MixedPlanInput> = {}): MixedPlanInput => ({
  engine: "open",
  title: "Sketch · skate",
  preset: sketch,
  values: defaultValues(sketch),
  source: { url: "/api/files/uploads/skate.mp4", duration: 12, hasAudio: true },
  range: { start: 2, end: 7 },
  fps: 8,
  resolution: "1K",
  modelId: "oss-mixed-media",
  ...over,
});

describe("Mixed Media presets", () => {
  it("has Higgsfield's 33 presets, each with its own settings and an intensity", () => {
    expect(MIXED_PRESETS).toHaveLength(33);
    expect(new Set(MIXED_PRESETS.map((p) => p.id)).size).toBe(33);
    for (const p of MIXED_PRESETS) {
      expect(p.description.length).toBeGreaterThan(8);
      expect(FX).toContain(p.fx);
      expect(p.settings.at(-1)!.key).toBe("intensity");
      expect(new Set(p.settings.map((s) => s.key)).size).toBe(p.settings.length);
      // Every placeholder has a setting and every setting but intensity is used.
      const used = [...p.look.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(used.sort()).toEqual(p.settings.filter((s) => s.key !== "intensity").map((s) => s.key).sort());
      expect(mixedLook(p, defaultValues(p))).not.toMatch(/[{}]/);
    }
  });

  it("uses real models", () => {
    for (const id of [...MIXED_MODELS.cloud, ...MIXED_MODELS.open, ...Object.values(MIXED_TOOLS.cloud), ...Object.values(MIXED_TOOLS.open)]) expect(getModel(id), id).toBeDefined();
  });

  it("cleans saved settings: bad colours and unknown options go back to the default, words are kept", () => {
    const v = cleanValues(sketch, { ink: "#ABCDEF", paper: "nope", intensity: "bold", stray: "x" });
    expect(v).toEqual({ ink: "#abcdef", paper: "white-paper", intensity: "bold" });
    expect(cleanValues(sketch, { ink: "text:the blue of old ballpoint pens", paper: "text:a page torn from a diary" })).toMatchObject({
      ink: "text:the blue of old ballpoint pens",
      paper: "text:a page torn from a diary",
    });
    expect(cleanValues(sketch, { ink: "red" }).ink).toBe("#1d1d1f");
    expect(cleanValues(windows, { title: "  a very long window title that goes on and on and on  " }).title).toHaveLength(40);
  });

  it("names colours in words for the prompt", () => {
    expect(colorName("#ff0000")).toBe("bright red");
    expect(colorName("#1d1d1f")).toBe("black");
    expect(colorName("#ffffff")).toBe("white");
    expect(colorName("#2a6f97")).toBe("deep sky blue");
    expect(colorName("#7cff00")).toBe("bright lime");
    expect(colorName("#8b4513")).toBe("brown");
    expect(colorName("#ffc0cb")).toBe("pale pink");
    expect(settingWords(sketch.settings[0], "#00e5ff")).toBe("bright cyan (#00E5FF)");
  });

  it("fills the look with the settings", () => {
    expect(mixedLook(sketch, { ink: "#c1121f", paper: "notebook-grid", intensity: "balanced" })).toBe(
      "hand-drawn textured linework in deep red (#C1121F) ink on a squared notebook page, cross-hatching and loose construction lines",
    );
    expect(mixedLook(windows, { title: "dream.exe", color: "text:sunset orange", intensity: "bold" })).toMatch(/title bars reading “dream\.exe”.*accents in sunset orange, pushed all the way, fully stylised$/);
    const p = mixedPrompts(sketch, defaultValues(sketch));
    expect(p.video).toMatch(/^Restyle this video as hand-drawn textured linework.*change only the look\.$/);
    expect(p.frame).toMatch(/^Hand-drawn textured linework/);
    expect(p.still).toMatch(/^Redraw this image as/);
    expect(denoiseFor({ intensity: "subtle" })).toBe(0.55);
    expect(denoiseFor({})).toBe(0.7);
  });
});

describe("Mixed Media frames and cost", () => {
  it("counts output frames as floor(seconds × fps)", () => {
    expect(mixedFrames(10, 8)).toBe(80);
    expect(mixedFrames(10, 24)).toBe(240);
    expect(mixedFrames(3.33, 12)).toBe(39);
    expect(mixedFrames(0.3, 4)).toBe(1);
  });

  it("prices per frame, double at 4K", () => {
    expect(framesCost(160, 0.02)).toBe(3.2);
    expect(framesCost(160, 0.02, "4K")).toBe(6.4);
    expect(framesCost(80, 0)).toBe(0);
  });

  it("never samples faster than the clip", () => {
    expect(fpsChoices(10).map((c) => [c.fps, c.disabled])).toEqual([
      [4, false],
      [8, false],
      [10, false],
      [12, true],
      [24, true],
    ]);
    expect(fpsChoices(undefined).every((c) => !c.disabled)).toBe(true);
    expect(clampFps(24, 10)).toBe(10);
    expect(clampFps(24, 29.97)).toBe(24);
    expect(clampFps(30)).toBe(24);
    expect(clampFps(2)).toBe(4);
    expect(clampFps(15.4, 30)).toBe(15);
    expect(MIXED.defaultFps).toBe(8);
  });

  it("checks the selection", () => {
    expect(mixedRangeProblem({ start: 0, end: 0.5 })).toBe("Select at least 1 second");
    expect(mixedRangeProblem({ start: 0, end: 11 })).toBe("Select up to 10 seconds");
    expect(mixedRangeProblem({ start: 0, end: 5 }, 12, 3)).toBe("Video must be at least 4 FPS");
    expect(mixedRangeProblem({ start: 2, end: 12 }, 12, 30)).toBe(null);
  });

  it("asks cloud models for their closest resolution", () => {
    expect(nearestResolution(["720p", "1080p"], "4K")).toBe("1080p");
    expect(nearestResolution(["360p", "720p", "1080p", "4k"], "4K")).toBe("4k");
    expect(nearestResolution(["360p", "720p", "1080p", "4k"], "1K")).toBe("720p");
    expect(nearestResolution(["auto", "480p", "720p"], "2K")).toBe("720p");
    expect(nearestResolution(undefined, "2K")).toBeUndefined();
  });
});

describe("Mixed Media pipeline shape", () => {
  it("open: one per-frame job on the selection at the chosen frame rate", () => {
    const plan = planMixed(input({ values: { ...defaultValues(sketch), intensity: "bold" } }));
    expect(plan.final).toBe("render");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].request).toMatchObject({
      feature: "mixed-media",
      title: "Sketch · skate",
      modelId: "oss-mixed-media",
      op: "v2v",
      inputs: { video: "/api/files/uploads/skate.mp4" },
      params: { startTime: 2, endTime: 7, fps: 8, aspectRatio: "auto", resolution: "1K", extra: { denoise: 0.82 } },
    });
  });

  it("cloud: cut → restyle (anchored on the preview) → the cut's own sound", () => {
    const plan = planMixed(input({ engine: "cloud", modelId: "ltx-2-3-restyle", anchor: "/api/files/outputs/still.png", extra: { preprocessor: "canny" } }));
    const by = Object.fromEntries(plan.steps.map((s) => [s.key, s]));
    expect(Object.keys(by)).toEqual(["cut", "render", "final"]);
    expect(by.cut.request).toMatchObject({ feature: "mixed-media-step", modelId: "trim-video", op: "trim", params: { startTime: 2, endTime: 7 } });
    expect(by.render).toMatchObject({
      after: ["cut"],
      chain: [{ slot: "video" }],
      request: { feature: "mixed-media-step", modelId: "ltx-2-3-restyle", inputs: { images: ["/api/files/outputs/still.png"] }, params: { generateAudio: false, extra: { preprocessor: "canny" } } },
    });
    expect(by.final).toMatchObject({ after: ["render", "cut"], chain: [{ slot: "video" }, { slot: "audio" }], request: { feature: "mixed-media", modelId: "merge-audio-video", op: "mux" } });
    const silent = planMixed(input({ engine: "cloud", modelId: "lucy-edit-pro", source: { url: "/api/files/x.mp4", hasAudio: false } }));
    expect(silent.final).toBe("render");
    expect(silent.steps[1].request).toMatchObject({ feature: "mixed-media", title: "Sketch · skate" });
    expect(silent.steps[1].request.inputs).toBeUndefined();
  });

  it("preview: one frame (open: the per-frame model; cloud: an edit of the grabbed frame)", () => {
    const open = planMixedPreview(input());
    expect(open.request).toMatchObject({ feature: "mixed-media-preview", modelId: "oss-mixed-media", params: { startTime: 2, fps: 8, extra: { frames: 1 } } });
    const cloud = planMixedPreview({ ...input({ engine: "cloud", modelId: "ltx-2-3-restyle" }), frameUrl: "/api/files/uploads/frame.png" });
    expect(cloud.request).toMatchObject({ modelId: "nano-banana-2", op: "edit", inputs: { images: ["/api/files/uploads/frame.png"] } });
    expect(cloud.request.prompt).toMatch(/^Redraw this image as hand-drawn/);
  });
});
