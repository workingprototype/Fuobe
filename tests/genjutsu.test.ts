import { describe, expect, it } from "vitest";
import {
  chooseMaker,
  decodeSetup,
  encodeSetup,
  genjutsuProblem,
  getMaker,
  makerPrompt,
  makersFor,
  makerStepUsd,
  OPEN_LOOK_PROBLEM,
  planGenjutsu,
  planMakerPieces,
  qualityFor,
  resolutionWords,
  swapParts,
  swapTarget,
  type GenjutsuPlanInput,
  type Maker,
} from "@/lib/catalog/genjutsu";
import { planGeneration } from "@/lib/catalog/plan";
import { getModel, getPreset } from "@/lib/catalog";

const clip = { url: "/api/files/clip.mp4", duration: 20, fps: 30, width: 1280, height: 720, hasAudio: true };
const ref = "/api/files/hero.png";
const maker = (id: string) => getMaker(id)!;
const plan = (o: Partial<GenjutsuPlanInput> & { maker: Maker }) =>
  planGenjutsu({ engine: o.maker.engine, mode: "motion", title: "Genjutsu", source: clip, range: { start: 0, end: 20 }, quality: "720p", references: [ref], ...o });
const step = (p: ReturnType<typeof planGenjutsu>, key: string) => p.steps.find((s) => s.key === key)!;

describe("Genjutsu: which model runs", () => {
  it("Genjutsu Lite by default with a Higgsfield key, the full model as Quality: High", () => {
    expect(chooseMaker({ engine: "cloud", mode: "motion", higgsfield: true })).toEqual({ maker: maker("genjutsu-lite-motion-transfer") });
    expect(chooseMaker({ engine: "cloud", mode: "motion", higgsfield: true, tier: "high" })).toEqual({ maker: maker("genjutsu-motion-transfer") });
    expect(chooseMaker({ engine: "cloud", mode: "swap", target: "type", higgsfield: true })).toEqual({ maker: maker("genjutsu-lite-object-swap") });
    // A setup naming the full model is the same pick (the list shows Lite; the tier says High).
    expect(chooseMaker({ engine: "cloud", mode: "swap", higgsfield: true, modelId: "genjutsu-object-swap", tier: "high" })).toEqual({ maker: maker("genjutsu-object-swap") });
    expect(makersFor("cloud", "swap", "type").map((m) => m.id)).not.toContain("genjutsu-object-swap");
  });

  it("without a key: Kling Motion Control, Kling O3 edit, hosted VACE for marked areas, the Shorts models for looks", () => {
    expect("maker" in chooseMaker({ engine: "cloud", mode: "motion", higgsfield: false }) && chooseMaker({ engine: "cloud", mode: "motion", higgsfield: false })).toMatchObject({ maker: { id: "kling-motion-control" } });
    expect(chooseMaker({ engine: "cloud", mode: "swap", target: "type", higgsfield: false })).toMatchObject({ maker: { id: "kling-o3" } });
    expect(chooseMaker({ engine: "cloud", mode: "swap", target: "paint", higgsfield: true })).toMatchObject({ maker: { id: "wan-22-vace-inpaint" } });
    expect(chooseMaker({ engine: "cloud", mode: "insert", target: "type", higgsfield: false })).toMatchObject({ maker: { id: "kling-o3" } });
    expect(chooseMaker({ engine: "cloud", mode: "restyle", look: { kind: "preset", id: "shorts-claymation" }, higgsfield: true })).toMatchObject({ maker: { id: "gemini-omni-flash" } });
    expect(chooseMaker({ engine: "cloud", mode: "restyle", look: { kind: "custom", images: [ref] }, higgsfield: false })).toMatchObject({ maker: { id: "kling-o3-4k-edit" } });
    expect(chooseMaker({ engine: "cloud", mode: "restyle", look: { kind: "higgsfield", id: "abc" }, higgsfield: true })).toMatchObject({ maker: { id: "genjutsu-restyle" } });
    // P-Video Replace is there to pick for people.
    expect(makersFor("cloud", "swap", "type").map((m) => m.id)).toEqual(["genjutsu-lite-object-swap", "kling-o3", "p-video-replace"]);
  });

  it("open: Wan Animate 2, VACE swap by name, VACE insert by paint, the Fun VACE restyle; other ways are refused in words", () => {
    expect(chooseMaker({ engine: "open", mode: "motion", higgsfield: false })).toMatchObject({ maker: { id: "oss-wan22-animate" } });
    expect(chooseMaker({ engine: "open", mode: "swap", target: "type", higgsfield: false })).toMatchObject({ maker: { id: "oss-vace-swap" } });
    expect(chooseMaker({ engine: "open", mode: "insert", target: "paint", higgsfield: false })).toMatchObject({ maker: { id: "oss-vace-insert" } });
    expect(chooseMaker({ engine: "open", mode: "restyle", look: { kind: "preset", id: "shorts-watercolor" }, higgsfield: false })).toMatchObject({ maker: { id: "oss-wan22-vace-restyle" } });
    expect(chooseMaker({ engine: "open", mode: "swap", target: "paint", higgsfield: false })).toEqual({ problem: expect.stringMatching(/name what to swap/) });
    expect(chooseMaker({ engine: "open", mode: "insert", target: "type", higgsfield: false })).toEqual({ problem: expect.stringMatching(/paint where it goes/) });
    // Higgsfield's looks are cloud-only: said as such, not "nothing does that".
    expect(chooseMaker({ engine: "open", mode: "restyle", look: { kind: "higgsfield", id: "abc" }, higgsfield: true })).toEqual({ problem: OPEN_LOOK_PROBLEM });
  });

  it("every maker is a catalog model that does its mode's operation", () => {
    const ops = { motion: "motion-transfer", swap: "video-swap", insert: "video-insert", restyle: "v2v" } as const;
    for (const m of [...makersFor("cloud", "motion"), ...makersFor("open", "motion")]) expect(m.modes).toContain("motion");
    for (const id of ["genjutsu-lite-motion-transfer", "genjutsu-motion-transfer", "kling-motion-control", "genjutsu-lite-object-swap", "genjutsu-object-swap", "kling-o3", "p-video-replace", "wan-22-vace-inpaint", "genjutsu-restyle", "gemini-omni-flash", "kling-o3-4k-edit", "happy-horse-video-edit", "oss-wan22-animate", "oss-vace-swap", "oss-vace-insert", "oss-wan22-vace-restyle"]) {
      const m = maker(id);
      const model = getModel(id);
      expect(model, id).toBeDefined();
      expect(model!.engine).toBe(m.engine);
      for (const mode of m.modes) expect(model!.routes.some((r) => r.op === ops[mode]), `${id} ${mode}`).toBe(true);
    }
  });
});

describe("Genjutsu: checks", () => {
  const base = { mode: "motion" as const, maker: maker("genjutsu-lite-motion-transfer"), source: clip, range: { start: 0, end: 20 }, references: 1 };

  it("the source window is 4–30 s", () => {
    expect(genjutsuProblem({ ...base, range: { start: 0, end: 3 } })).toMatch(/between 4 and 30 seconds/);
    expect(genjutsuProblem({ ...base, source: { ...clip, duration: 40 }, range: { start: 0, end: 31 } })).toMatch(/up to 30 seconds/);
    expect(genjutsuProblem(base)).toBeNull();
  });

  it("references, words, clicks and paint are asked for per mode", () => {
    expect(genjutsuProblem({ ...base, references: 0 })).toBe("Add a picture of your character");
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("kling-o3"), target: "type" })).toMatch(/Say what to swap/);
    // Genjutsu and P-Video find it from the references.
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("genjutsu-lite-object-swap"), target: "type" })).toBeNull();
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("wan-22-vace-inpaint"), target: "click" })).toMatch(/Click what to swap/);
    expect(genjutsuProblem({ ...base, mode: "insert", maker: maker("oss-vace-insert"), target: "paint" })).toMatch(/Paint where it goes/);
    expect(genjutsuProblem({ ...base, mode: "insert", maker: maker("kling-o3"), target: "type" })).toMatch(/Say where it goes/);
    expect(genjutsuProblem({ ...base, mode: "restyle", maker: maker("gemini-omni-flash"), references: 0 })).toBe("Pick a look");
    expect(genjutsuProblem({ ...base, mode: "restyle", maker: maker("gemini-omni-flash"), references: 0, look: { kind: "custom", images: [ref] } })).toMatch(/restyles from words only/);
    expect(genjutsuProblem({ ...base, mode: "restyle", maker: maker("kling-o3-4k-edit"), references: 0, look: { kind: "custom", images: [ref] } })).toBeNull();
  });

  it("each model's own limits", () => {
    const small = { ...clip, width: 640, height: 360 };
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("genjutsu-object-swap"), source: small, target: "type" })).toMatch(/Genjutsu Lite takes it/);
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("kling-o3"), source: small, target: "type", subject: "the cup" })).toMatch(/at least 720 px/);
    // The hosted VACE is the only model for clicks and paint: the way out is words, not "another model".
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("wan-22-vace-inpaint"), source: { ...clip, fps: 60 }, target: "paint", mask: true })).toBe(
      "Wan 2.2 VACE (hosted) takes up to 30 fps (this clip is 60 fps) — switch to “Type it”, or save the clip at 30 fps and add it again",
    );
    expect(genjutsuProblem({ ...base, mode: "insert", maker: maker("wan-22-vace-inpaint"), source: { ...clip, fps: 60 }, target: "paint", mask: true })).toMatch(/switch to “Say where”/);
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("oss-vace-swap"), source: { ...clip, fps: undefined }, target: "type", subject: "the cup" })).toMatch(/frame rate/);
  });
});

describe("Genjutsu: plans", () => {
  it("cloud motion on Genjutsu Lite: 15 s calls, joined, the sound put back; whole seconds priced per quality", () => {
    const p = plan({ maker: maker("genjutsu-lite-motion-transfer"), prompt: "a knight in silver armour", quality: "1080p" });
    expect(p.pieces).toBe(2);
    expect(step(p, "cut0").request.params).toMatchObject({ startTime: 0, endTime: 10 });
    const make = step(p, "make1").request;
    expect(make).toMatchObject({ modelId: "genjutsu-lite-motion-transfer", op: "motion-transfer", feature: "genjutsu-step", inputs: { images: [ref] }, prompt: "A knight in silver armour." });
    expect(make.params).toMatchObject({ resolution: "1080p", duration: 10 });
    expect(p.final).toBe("final");
    expect(step(p, "final").request).toMatchObject({ op: "mux", feature: "genjutsu", inputs: { audio: clip.url } });
    expect(step(p, "join").after).toEqual(["make0", "make1"]);
    // Lite at 1080p: $0.20 a second; Genjutsu rounds up to whole seconds.
    expect(makerStepUsd("genjutsu-lite-motion-transfer", { duration: 9.2, resolution: "1080p" })).toBeCloseTo(2, 6);
    expect(makerStepUsd("genjutsu-motion-transfer", { duration: 4, resolution: "480p" })).toBeCloseTo(1.272, 6);
    expect(makerStepUsd("kling-o3", { duration: 10 })).toBeCloseTo(1.68, 6);
    expect(makerStepUsd("wan-22-vace-inpaint", { duration: 5 })).toBeNull();
  });

  it("one call that keeps the sound is the result itself", () => {
    const p = plan({ maker: maker("genjutsu-motion-transfer") });
    expect(p.steps.map((s) => s.key)).toEqual(["make0"]);
    expect(p.final).toBe("make0");
    expect(step(p, "make0").request).toMatchObject({ feature: "genjutsu", title: "Genjutsu", inputs: { video: clip.url, images: [ref] } });
  });

  it("Kling Motion Control takes one image and 10 s pieces; Kling O3 swap names the references as @Image", () => {
    const k = plan({ maker: maker("kling-motion-control"), references: [ref, "/api/files/b.png"] });
    expect(k.pieces).toBe(2);
    expect(step(k, "make0").request.inputs?.images).toEqual([ref]);
    const s = plan({ mode: "swap", maker: maker("kling-o3"), target: "type", subject: "the red car", prompt: "a white horse trotting", references: [ref, "/api/files/b.png"], range: { start: 2, end: 12 } });
    expect(step(s, "make0").request.prompt).toBe("Replace the red car in @Video1 with @Image1, @Image2. A white horse trotting. Keep everything else the same: the motion, camera, framing and light.");
    expect(step(s, "cut0").request.params).toMatchObject({ startTime: 2, endTime: 12 });
    // Kling O3 keeps the sound of its one piece.
    expect(s.final).toBe("make0");
    const ins = plan({ mode: "insert", maker: maker("kling-o3"), target: "type", prompt: "on the table next to the cup", range: { start: 0, end: 8 } });
    expect(step(ins, "make0").request.prompt).toMatch(/^Add @Image1 to @Video1: on the table next to the cup\./);
  });

  it("hosted VACE swap by paint over several pieces: the paint for the first, SAM 3.1's track for the rest", () => {
    const p = plan({ mode: "swap", maker: maker("wan-22-vace-inpaint"), target: "paint", mask: "/api/files/mask.png", points: [{ x: 600, y: 300, label: "positive" }], quality: "1080p" });
    expect(p.tracked).toBe(true);
    // 20 s at 30 fps = 600 frames → 3 windows of 4n+1 ≤ 241.
    expect(p.pieces).toBe(3);
    expect(step(p, "track").request).toMatchObject({ modelId: "sam-3-1-video-mask", params: { points: [{ x: 600, y: 300, label: "positive" }] } });
    expect(step(p, "make0").request.inputs?.mask).toBe("/api/files/mask.png");
    expect(step(p, "make1").after).toEqual(["cut1", "mframe1"]);
    expect(step(p, "make1").chain).toEqual([{ slot: "video" }, { slot: "mask" }]);
    expect(step(p, "mframe1").request).toMatchObject({ modelId: "extract-frame", op: "frame", params: { extra: { frame_type: "first" } } });
    expect(step(p, "mframe1").after).toEqual(["mcut1"]);
    // 1080p isn't one of its sizes: the largest below.
    expect(step(p, "make0").request.params).toMatchObject({ resolution: "720p", aspectRatio: "auto" });
    // Billed as frames ÷ 16.
    const frames = planMakerPieces(maker("wan-22-vace-inpaint"), clip, { start: 0, end: 20 })[0].frames!;
    expect(step(p, "make0").request.params?.duration).toBeCloseTo(frames / 16, 5);
    // VACE doesn't keep the sound: put back.
    expect(p.final).toBe("final");
  });

  it("hosted VACE insert holds the painted spot in every piece (no tracking)", () => {
    const p = plan({ mode: "insert", maker: maker("wan-22-vace-inpaint"), target: "paint", mask: "/api/files/spot.png" });
    expect(p.tracked).toBe(false);
    expect(p.steps.some((s) => s.key === "track")).toBe(false);
    for (let i = 0; i < p.pieces; i++) expect(step(p, `make${i}`).request.inputs?.mask).toBe("/api/files/spot.png");
  });

  it("open VACE swap: windows straight from the upload, SAM 3.1's words, the first reference only", () => {
    const p = plan({ mode: "swap", maker: maker("oss-vace-swap"), target: "type", subject: "Replace the coffee cup with a red apple", references: [ref, "/api/files/b.png"], quality: "720p" });
    // 600 frames at 30 fps → 8 windows of ≤81.
    expect(p.pieces).toBe(8);
    const w = step(p, "make1").request;
    expect(w).toMatchObject({ modelId: "oss-vace-swap", op: "video-swap", inputs: { video: clip.url, images: [ref] } });
    expect(w.params?.extra).toEqual({ maskPrompt: "the coffee cup" });
    expect(w.params).toMatchObject({ aspectRatio: "auto", resolution: "720p" });
    expect(w.params?.startTime).toBeGreaterThan(2.5);
    expect(w.prompt).toBe("A red apple in place of the coffee cup, matching the light, perspective and motion of the shot.");
    // Joined (4 at a time on ComfyUI) under the clip's own sound.
    expect(p.steps.filter((s) => s.request.op === "concat").length).toBe(3);
    expect(step(p, "final").request).toMatchObject({ modelId: "oss-mux", feature: "genjutsu" });
  });

  it("open VACE insert: the painted spot for every window; Wan Animate 2: one job for the selection", () => {
    const ins = plan({ mode: "insert", maker: maker("oss-vace-insert"), target: "paint", mask: "/api/files/spot.png", range: { start: 0, end: 5 } });
    expect(ins.pieces).toBe(2);
    expect(step(ins, "make0").request.inputs?.mask).toBe("/api/files/spot.png");
    expect(step(ins, "make1").request.inputs?.mask).toBe("/api/files/spot.png");
    const anim = plan({ maker: maker("oss-wan22-animate"), range: { start: 4, end: 14 } });
    expect(anim.steps.map((s) => s.key)).toEqual(["cut0", "make0"]);
    expect(step(anim, "cut0").request).toMatchObject({ modelId: "oss-trim", params: { startTime: 4, endTime: 14 } });
    expect(step(anim, "make0").request).toMatchObject({ op: "motion-transfer", feature: "genjutsu", params: { aspectRatio: "auto", resolution: "720p" } });
    expect(anim.final).toBe("make0");
  });

  it("Restyle on a Higgsfield look: Genjutsu Restyle with its preset_id and the character references", () => {
    const p = plan({ mode: "restyle", maker: maker("genjutsu-restyle"), look: { kind: "higgsfield", id: "9b1c", name: "Anime" }, references: [ref] });
    expect(step(p, "make0").request).toMatchObject({ op: "v2v", params: { extra: { preset_id: "9b1c" }, resolution: "720p" }, inputs: { images: [ref] } });
    expect(step(p, "make0").request.prompt).toBeTruthy();
  });

  it("Restyle on a Fuobe look: the Shorts chain in the clip's own shape, under Genjutsu's features", () => {
    const p = plan({ mode: "restyle", maker: maker("gemini-omni-flash"), look: { kind: "preset", id: "shorts-claymation" }, references: [] });
    expect(p.pieces).toBe(2);
    expect(p.steps.every((s) => s.request.feature === (s.key === p.final ? "genjutsu" : "genjutsu-step"))).toBe(true);
    // No crop to 9:16 / 16:9, no ratio asked of the cloud model.
    expect(p.steps.some((s) => s.request.op === "reframe")).toBe(false);
    const look = p.steps.find((s) => s.request.modelId === "gemini-omni-flash")!.request;
    expect(look.params?.aspectRatio).toBeUndefined();
    expect(look.prompt).toMatch(/claymation/i);
    const open = plan({ mode: "restyle", maker: maker("oss-wan22-vace-restyle"), look: { kind: "custom", images: [ref, "/api/files/b.png", "/api/files/c.png"] }, references: [] });
    const cut = open.steps.find((s) => s.request.modelId === "oss-segment")!.request;
    expect(cut.params?.aspectRatio).toBe("auto");
    expect(open.steps.find((s) => s.request.modelId === "oss-qwen-edit")!.request.inputs?.images).toEqual([ref, "/api/files/b.png"]);
  });

  it("the steps plan as catalog generations (requests the catalog accepts)", () => {
    const plans = [
      plan({ maker: maker("genjutsu-lite-motion-transfer") }),
      plan({ maker: maker("kling-motion-control") }),
      plan({ mode: "swap", maker: maker("genjutsu-lite-object-swap"), target: "type" }),
      plan({ mode: "swap", maker: maker("p-video-replace"), target: "type", quality: "480p" }),
      plan({ mode: "swap", maker: maker("kling-o3"), target: "type", subject: "the cup", range: { start: 0, end: 10 } }),
      plan({ mode: "insert", maker: maker("wan-22-vace-inpaint"), target: "paint", mask: "/api/files/m.png", range: { start: 0, end: 6 } }),
      plan({ mode: "swap", maker: maker("oss-vace-swap"), target: "type", subject: "the cup", range: { start: 0, end: 6 } }),
      plan({ mode: "insert", maker: maker("oss-vace-insert"), target: "paint", mask: "/api/files/m.png", range: { start: 0, end: 6 } }),
      plan({ mode: "restyle", maker: maker("genjutsu-restyle"), look: { kind: "higgsfield", id: "x" }, references: [] }),
    ];
    for (const p of plans) {
      for (const s of p.steps) {
        // Chained inputs arrive at run time: stand-ins for what an earlier step makes.
        const chained = Object.fromEntries((s.chain ?? []).map((c) => [c.slot === "videos" ? "videos" : c.slot, c.slot === "videos" ? ["/api/files/x.mp4", "/api/files/y.mp4"] : "/api/files/x.mp4"]));
        const req = { ...s.request, inputs: { ...s.request.inputs, ...chained } };
        expect(() => planGeneration(req, getModel, getPreset), `${s.request.modelId} ${s.key}`).not.toThrow();
      }
    }
  });
});

describe("Genjutsu: words and qualities", () => {
  it("swapTarget takes what goes out of a sentence", () => {
    expect(swapTarget("Replace the red car with a horse")).toBe("the red car");
    expect(swapTarget("swap the mug for a can of soda")).toBe("the mug");
    expect(swapTarget("her jacket")).toBe("her jacket");
    expect(swapParts("Replace the red car with a white horse.")).toEqual({ what: "the red car", into: "a white horse" });
    // Kling O3 is told both.
    expect(makerPrompt({ mode: "swap", maker: maker("kling-o3"), subject: "swap the mug for a can of soda", refs: 1 })).toBe(
      "Replace the mug in @Video1 with @Image1 (a can of soda). Keep everything else the same: the motion, camera, framing and light.",
    );
  });

  it("Genjutsu's optional words stay optional", () => {
    expect(makerPrompt({ mode: "swap", maker: maker("genjutsu-lite-object-swap"), refs: 2 })).toBeUndefined();
    expect(makerPrompt({ mode: "swap", maker: maker("genjutsu-lite-object-swap"), subject: "the jacket", refs: 2 })).toBe("Replace the jacket with the references.");
    expect(makerPrompt({ mode: "motion", maker: maker("kling-motion-control"), refs: 1 })).toBeUndefined();
  });

  it("qualities go to the nearest a model renders", () => {
    expect(qualityFor(maker("p-video-replace"), "480p")).toBe("720p");
    expect(qualityFor(maker("oss-vace-swap"), "1080p")).toBe("720p");
    expect(qualityFor(maker("kling-o3"), "1080p")).toBeUndefined();
  });

  it("says what comes out when it isn't the quality picked", () => {
    // Above the pick is the model's lowest, below it the most it renders.
    expect(resolutionWords(maker("p-video-replace"), "480p")).toBe("renders 720p (its lowest)");
    expect(resolutionWords(maker("gemini-omni-flash"), "480p")).toBe("renders 720p (its lowest)");
    expect(resolutionWords(maker("wan-22-vace-inpaint"), "1080p")).toBe("renders up to 720p");
    expect(resolutionWords(maker("genjutsu-lite-motion-transfer"), "1080p")).toBeUndefined();
    // No setting: each model's own words.
    expect(resolutionWords(maker("kling-o3"), "720p")).toBe("keeps your clip's size");
    expect(resolutionWords(maker("kling-o3-4k-edit"), "720p")).toBe("renders 4K");
    expect(resolutionWords(maker("oss-wan22-vace-restyle"), "1080p")).toBe("renders 480p at 16 fps");
    expect(resolutionWords(maker("kling-motion-control"), "720p")).toBe("picks its own size");
  });
});

describe("Genjutsu: setup codes", () => {
  it("round-trips a setup through a short code", () => {
    const setup = {
      mode: "swap" as const,
      engine: "cloud" as const,
      model: "genjutsu-lite-object-swap",
      tier: "high" as const,
      quality: "1080p" as const,
      target: "type" as const,
      subject: "the red jacket — ünïcode",
      prompt: "a yellow raincoat",
      references: [ref, "/api/files/b.png"],
    };
    const code = encodeSetup(setup);
    expect(code).toMatch(/^gj1\.[A-Za-z0-9_-]+$/);
    expect(decodeSetup(code)).toEqual(setup);
    // Pasted as a link, or with spaces around.
    expect(decodeSetup(` http://localhost:3000/genjutsu?setup=${code} `)).toEqual(setup);
  });

  it("keeps looks and drops what isn't valid", () => {
    expect(decodeSetup(encodeSetup({ mode: "restyle", look: { kind: "custom", images: [ref, "https://evil.example/x.png"], words: "neon" } }))).toEqual({ mode: "restyle", look: { kind: "custom", images: [ref], words: "neon" } });
    expect(decodeSetup(encodeSetup({ mode: "restyle", look: { kind: "preset", id: "shorts-claymation" } }))?.look).toEqual({ kind: "preset", id: "shorts-claymation" });
    expect(decodeSetup(encodeSetup({ mode: "restyle", look: { kind: "preset", id: "nope" } }))?.look).toBeUndefined();
    expect(decodeSetup(encodeSetup({ mode: "motion", target: "paint", model: "not-a-model" }))).toEqual({ mode: "motion" });
    expect(decodeSetup("gj1.!!!")).toBeNull();
    // A link with a broken %-escape is no code (it doesn't throw).
    expect(decodeSetup("https://x/genjutsu?setup=%E0%A4%A")).toBeNull();
    expect(decodeSetup("hello")).toBeNull();
    expect(decodeSetup(`gj1.${btoa(JSON.stringify({ m: "fly" }))}`)).toBeNull();
  });
});
