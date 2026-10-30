import { describe, expect, it } from "vitest";
import {
  currentSegments,
  DEFAULT_SETTINGS,
  dependencies,
  freezeTake,
  jobState,
  newSegment,
  newShot,
  planQueue,
  segmentPrompt,
  settingSignature,
  type GenSummary,
  type SwapClip,
  type SwapProject,
  type SwapTake,
} from "@/lib/catalog/swap-studio";
import { applyEdit, cleanSettings, EditError, shotBusy, type SwapEdit } from "@/lib/catalog/swap-studio-edit";
import { frozenTakePlan, planMask } from "@/lib/catalog/swap-studio-plan";

// Character Swap Studio's edits (Akatz Labs' rules) and a queued take's frozen plan: pure, no server.

let tick = 0;
const rand = () => (((tick++ * 0.6180339887) % 1) + 1) % 1;

function clipOf(over: Partial<SwapClip> = {}): SwapClip {
  return {
    id: "clip-1",
    name: "walk",
    source: { url: "/api/files/uploads/x/walk.mp4", name: "walk.mp4", duration: 20, fps: 30, width: 1920, height: 1080, hasAudio: true },
    normalized: { url: "/api/files/outputs/x/walk24.mp4", genId: "g-norm" },
    frames: 480,
    cuts: [],
    detected: null,
    cutsReviewed: false,
    shots: [{ ...newShot(0, 480, DEFAULT_SETTINGS, true, rand), id: "shot-a" }],
    transcript: { genId: "g-words", cues: [{ start: 0.5, end: 2, text: "Where were you", speaker: "s1" }], voices: {} },
    review: "pending",
    reviewNotes: "",
    assembly: null,
    ...over,
  };
}

function projectOf(clips: SwapClip[] = [clipOf()], engine: SwapProject["engine"] = "open"): SwapProject {
  return { id: "p1", name: "Demo", engine, character: { image: "/api/files/uploads/x/hero.png", description: "a woman in a yellow raincoat" }, defaults: { ...DEFAULT_SETTINGS }, clips, createdAt: 0, updatedAt: 0, revision: 1 };
}

const take = (id: string, over: Partial<SwapTake> = {}): SwapTake => ({ id, createdAt: 1, engine: "open", state: "launched", genId: `g-${id}`, signature: "", dependencies: [], prompt: "", seed: 1, favourite: false, decision: "pending", notes: "", ...over });
const edit = (p: SwapProject, e: SwapEdit, active: (id: string) => boolean = () => false) => applyEdit(p, e, { active, rand });
const shotOf = (p: SwapProject, i = 0) => p.clips[0].shots[i];
const refused = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return { message: (e as Error).message, status: (e as EditError).status };
  }
  throw new Error("expected the edit to be refused");
};

describe("project edits", () => {
  it("rename, defaults and engine keep to known values", () => {
    const p = projectOf();
    expect(edit(p, { type: "rename", name: "  Rain scene  " }).name).toBe("Rain scene");
    expect(refused(() => edit(p, { type: "rename", name: "   " })).message).toMatch(/name/);
    expect(edit(p, { type: "defaults", settings: { renderMp: 0.5, lora: "v1" } }).defaults).toMatchObject({ renderMp: 0.5, lora: "v1" });
    expect(refused(() => cleanSettings({ windowFrames: 100 })).message).toMatch(/17n \+ 5/);
    expect(refused(() => cleanSettings({ expansion: 300 })).message).toMatch(/0–256/);
    expect(refused(() => cleanSettings({ renderMp: 0.7 as 0.5 })).message).toMatch(/0\.5 MP/);
    expect(refused(() => cleanSettings({ windowFrames: 22, historyFrames: 35 })).message).toMatch(/shorter than the window/);
    expect(edit(p, { type: "engine", engine: "cloud" }).engine).toBe("cloud");
  });

  it("a new character picture un-approves the anchors made with the old one; a new description doesn't", () => {
    const p = projectOf([clipOf({ shots: [{ ...shotOf(projectOf()), anchors: [{ id: "a1", createdAt: 1, source: "generated", url: "/api/files/a1.png" }], approvedAnchor: "a1" }] })]);
    expect(shotOf(edit(p, { type: "character", description: "a man in a grey suit" })).approvedAnchor).toBe("a1");
    const after = edit(p, { type: "character", image: "/api/files/uploads/x/other.png" });
    expect(after.character.image).toBe("/api/files/uploads/x/other.png");
    expect(shotOf(after).approvedAnchor).toBeNull();
    // The anchors themselves stay, to approve again.
    expect(shotOf(after).anchors).toHaveLength(1);
  });

  it("a new character picture also un-picks the segments' own references (made or imported with the old one)", () => {
    const base = shotOf(projectOf());
    const segs = currentSegments(base).map((g, i) => (i ? g : { ...g, anchorMode: "custom" as const, anchors: [{ id: "r1", createdAt: 1, source: "generated" as const, url: "/api/files/r1.png" }], anchor: "r1" }));
    const p = projectOf([clipOf({ shots: [{ ...base, segments: segs }] })]);
    expect(shotOf(edit(p, { type: "character", description: "someone else" })).segments![0].anchor).toBe("r1");
    const after = shotOf(edit(p, { type: "character", image: "/api/files/uploads/x/other.png" }));
    expect(after.segments![0]).toMatchObject({ anchor: null, anchors: [{ id: "r1" }] });
    // Queueing it now asks for a reference made with the new picture.
    const q = planQueue({ ...p, character: { ...p.character, image: "/api/files/uploads/x/other.png" } }, p.clips[0], after, after.segments![0].id, "segment", { active: () => false });
    expect("problem" in q && q.problem).toMatch(/pick its reference image/);
  });

  it("detected edits are kept apart until confirmed; confirmed cuts make shots, with Replace or Keep for each", () => {
    let p = edit(projectOf(), { type: "detected", clipId: "clip-1", cuts: [120, 0, 600, 120, 300] });
    expect(p.clips[0].detected).toEqual([120, 300]);
    expect(p.clips[0].shots).toHaveLength(1);
    // Dismissed: nothing waits; "no edits found" is an empty list.
    expect(edit(p, { type: "detected", clipId: "clip-1", cuts: [], dismiss: true }).clips[0].detected).toBeNull();
    expect(edit(p, { type: "detected", clipId: "clip-1", cuts: [] }).clips[0].detected).toEqual([]);
    p = edit(p, { type: "cuts", clipId: "clip-1", cuts: [300, 120], modes: ["generate", "preserve", "generate"] });
    expect(p.clips[0]).toMatchObject({ cuts: [120, 300], detected: null, cutsReviewed: true });
    expect(p.clips[0].shots.map((s) => [s.start, s.end, s.mode])).toEqual([
      [0, 120, "generate"],
      [120, 300, "preserve"],
      [300, 480, "generate"],
    ]);
    expect(refused(() => edit(p, { type: "cuts", clipId: "clip-1", cuts: [480] })).message).toMatch(/inside the clip/);
    expect(refused(() => edit(p, { type: "cuts", clipId: "clip-1", cuts: [100], modes: ["generate"] })).message).toMatch(/each shot/);
    expect(refused(() => edit(p, { type: "cuts", clipId: "nope", cuts: [] })).status).toBe(404);
  });

  it("a shot's cuts can't change under a take that is still being made", () => {
    const p = projectOf();
    const s = shotOf(p);
    const busy = projectOf([clipOf({ shots: [{ ...s, segments: currentSegments(s).map((g, i) => (i ? g : { ...g, takes: [take("t1", { genId: "g-run" })] })) }] })]);
    expect(shotBusy(shotOf(busy), (id) => id === "g-run")).toBe(true);
    expect(refused(() => edit(busy, { type: "cuts", clipId: "clip-1", cuts: [100] }, (id) => id === "g-run")).status).toBe(409);
    expect(refused(() => edit(busy, { type: "layout", clipId: "clip-1", shotId: s.id, op: { op: "split", frame: 50 } }, (id) => id === "g-run")).status).toBe(409);
    expect(refused(() => edit(busy, { type: "remove-clip", clipId: "clip-1" }, (id) => id === "g-run")).status).toBe(409);
    // Finished: all three go through.
    expect(edit(busy, { type: "cuts", clipId: "clip-1", cuts: [100] }).clips[0].shots).toHaveLength(2);
    expect(edit(busy, { type: "remove-clip", clipId: "clip-1" }).clips).toHaveLength(0);
  });

  it("who to swap, approvals and settings on a shot", () => {
    const base = projectOf();
    const s = { ...shotOf(base), anchors: [{ id: "a1", createdAt: 1, source: "generated" as const, genId: "g-a1" }], masks: [{ id: "m1", createdAt: 1, kind: "track" as const, engine: "open" as const, frame: 0, points: [], who: base.clips[0].shots[0].who, pieces: [{ from: 0, frames: 480, genId: "g-m1" }] }] };
    const p = projectOf([clipOf({ shots: [s] })]);
    const after = edit(p, { type: "shot", clipId: "clip-1", shotId: s.id, patch: { who: { selection: "index", index: 2, words: "the man in the hat" }, settings: { expansion: 24, useMask: false } } });
    expect(shotOf(after).who).toEqual({ selection: "index", index: 2, words: "the man in the hat" });
    expect(shotOf(after).settings).toMatchObject({ expansion: 24, useMask: false });
    // Not made yet: can't be approved.
    expect(refused(() => edit(p, { type: "shot", clipId: "clip-1", shotId: s.id, patch: { approvedAnchor: "a1" } })).message).toMatch(/isn't ready/);
    expect(refused(() => edit(p, { type: "shot", clipId: "clip-1", shotId: s.id, patch: { approvedMask: "m1" } })).message).toMatch(/isn't ready/);
    const made = projectOf([clipOf({ shots: [{ ...s, anchors: [{ ...s.anchors[0], url: "/api/files/a1.png" }], masks: [{ ...s.masks[0], pieces: [{ ...s.masks[0].pieces[0], url: "/api/files/m1.mp4" }] }] }] })]);
    const approved = edit(made, { type: "shot", clipId: "clip-1", shotId: s.id, patch: { approvedAnchor: "a1", approvedMask: "m1" } });
    expect(shotOf(approved)).toMatchObject({ approvedAnchor: "a1", approvedMask: "m1" });
    // Removing the approved mask or anchor takes the approval with it.
    expect(shotOf(edit(approved, { type: "remove-mask", clipId: "clip-1", shotId: s.id, maskId: "m1" })).approvedMask).toBeNull();
    expect(shotOf(edit(approved, { type: "remove-anchor", clipId: "clip-1", shotId: s.id, anchorId: "a1" })).approvedAnchor).toBeNull();
    // A mask still being made can't be removed.
    expect(refused(() => edit(p, { type: "remove-mask", clipId: "clip-1", shotId: s.id, maskId: "m1" }, (id) => id === "g-m1")).message).toMatch(/still being made/);
    // A mask made on the other engine can't be approved here; an approval can be taken back.
    const cloud = { ...made, engine: "cloud" as const };
    expect(refused(() => edit(cloud, { type: "shot", clipId: "clip-1", shotId: s.id, patch: { approvedMask: "m1" } })).message).toMatch(/other engine/);
    expect(shotOf(edit(approved, { type: "shot", clipId: "clip-1", shotId: s.id, patch: { approvedMask: null } })).approvedMask).toBeNull();
  });

  it("Build shot prompts writes each swapped shot's prompt from its speaker and words", () => {
    const p = edit(projectOf(), { type: "cuts", clipId: "clip-1", cuts: [240], modes: ["generate", "preserve"] });
    const built = edit(p, { type: "build-prompts", clipId: "clip-1" });
    expect(shotOf(built).prompt).toContain('Current shot dialogue: "Where were you".');
    expect(shotOf(built).prompt).toContain("The selected character is speaking.");
    expect(shotOf(built, 1).prompt).toBeNull();
    // Marking the voice as someone else's changes what the next build says.
    const other = edit(edit(built, { type: "voices", clipId: "clip-1", voices: { s1: "other" } }), { type: "build-prompts", clipId: "clip-1" });
    expect(shotOf(other).prompt).toContain("Another person is speaking");
  });
});

describe("segment edits", () => {
  const p = projectOf();
  const s = shotOf(p);
  const [first] = currentSegments(s);

  it("editing a segment's words or speaker keeps its prompt as it reads now; Update prompt rebuilds it", () => {
    const before = segmentPrompt(p, p.clips[0], s, first);
    const after = edit(p, { type: "segment", clipId: "clip-1", shotId: s.id, segmentId: first.id, patch: { dialogue: "Nowhere, I was here", speaker: "offscreen" } });
    const seg = shotOf(after).segments![0];
    expect(seg).toMatchObject({ dialogue: "Nowhere, I was here", speaker: "offscreen", performancePrompt: before });
    const rebuilt = edit(after, { type: "update-prompt", clipId: "clip-1", shotId: s.id, segmentId: first.id });
    const prompt = shotOf(rebuilt).segments![0].performancePrompt!;
    expect(prompt).toContain('Current segment dialogue: "Nowhere, I was here".');
    expect(prompt).toContain("Speech is offscreen");
  });

  it("refuses a first segment that continues, a seed out of range and a reference that isn't made", () => {
    expect(refused(() => edit(p, { type: "segment", clipId: "clip-1", shotId: s.id, segmentId: first.id, patch: { connection: "continue" } })).message).toMatch(/first segment starts fresh/);
    expect(refused(() => edit(p, { type: "segment", clipId: "clip-1", shotId: s.id, segmentId: first.id, patch: { seed: -1 } })).message).toMatch(/whole-number seed/);
    expect(refused(() => edit(p, { type: "segment", clipId: "clip-1", shotId: s.id, segmentId: first.id, patch: { anchor: "nope" } })).message).toMatch(/isn't ready/);
    expect(refused(() => edit(p, { type: "segment", clipId: "clip-1", shotId: s.id, segmentId: "gone", patch: { seed: 2 } })).status).toBe(404);
  });

  it("layouts: 5 s segments, split at the playhead, merge back", () => {
    const five = edit(p, { type: "layout", clipId: "clip-1", shotId: s.id, op: { op: "partition", frames: 120 } });
    expect(shotOf(five).segments!.map((g) => [g.start, g.end, g.connection])).toEqual([
      [0, 120, "start"],
      [120, 240, "continue"],
      [240, 360, "continue"],
      [360, 480, "continue"],
    ]);
    const split = edit(five, { type: "layout", clipId: "clip-1", shotId: s.id, op: { op: "split", frame: 60 } });
    expect(shotOf(split).segments!.map((g) => g.end)).toEqual([60, 120, 240, 360, 480]);
    const merged = edit(split, { type: "layout", clipId: "clip-1", shotId: s.id, op: { op: "merge", index: 1 } });
    expect(shotOf(merged).segments!.map((g) => g.end)).toEqual([120, 240, 360, 480]);
    expect(refused(() => edit(p, { type: "layout", clipId: "clip-1", shotId: s.id, op: { op: "partition", frames: 400 } })).message).toMatch(/15 seconds/);
  });

  it("imported references: one per segment picked by default, at most 12", () => {
    const one = edit(p, { type: "anchor-import", clipId: "clip-1", shotId: s.id, segmentId: first.id, url: "/api/files/uploads/x/ref.png", id: "r1", at: 5 });
    expect(shotOf(one).segments![0]).toMatchObject({ anchor: "r1", anchors: [{ id: "r1", source: "imported", url: "/api/files/uploads/x/ref.png" }] });
    expect(refused(() => edit(p, { type: "anchor-import", clipId: "clip-1", shotId: s.id, url: "https://example.com/x.png", id: "r2", at: 5 })).message).toMatch(/Upload/);
    let full = p;
    for (let i = 0; i < 12; i++) full = edit(full, { type: "anchor-import", clipId: "clip-1", shotId: s.id, url: `/api/files/a${i}.png`, id: `a${i}`, at: i });
    expect(refused(() => edit(full, { type: "anchor-import", clipId: "clip-1", shotId: s.id, url: "/api/files/a12.png", id: "a12", at: 12 })).message).toMatch(/at most 12/);
  });

  it("takes: choose a finished one, favourite, decide, note, remove; a running one can't be removed", () => {
    const withTakes = projectOf([clipOf({ shots: [{ ...s, segments: currentSegments(s).map((g, i) => (i ? g : { ...g, takes: [take("t1"), take("t2"), take("w", { state: "waiting" })] })) }] })]);
    const ref = { type: "take" as const, clipId: "clip-1", shotId: s.id, segmentId: first.id };
    let q = edit(withTakes, { ...ref, takeId: "t2", select: true, favourite: true, decision: "keep", notes: "best eyes" });
    expect(shotOf(q).segments![0].selectedTake).toBe("t2");
    expect(shotOf(q).segments![0].takes[1]).toMatchObject({ favourite: true, decision: "keep", notes: "best eyes" });
    expect(refused(() => edit(withTakes, { ...ref, takeId: "w", select: true })).message).toMatch(/didn't run/);
    expect(refused(() => edit(withTakes, { ...ref, takeId: "w", remove: true })).message).toMatch(/Stop the take/);
    q = edit(q, { ...ref, takeId: "t2", remove: true });
    expect(shotOf(q).segments![0]).toMatchObject({ selectedTake: null });
    expect(shotOf(q).segments![0].takes.map((t) => t.id)).toEqual(["t1", "w"]);
  });

  it("clip review: a decision and notes", () => {
    const q = edit(p, { type: "clip", clipId: "clip-1", review: "maybe", reviewNotes: "lips drift in shot 2" });
    expect(q.clips[0]).toMatchObject({ review: "maybe", reviewNotes: "lips drift in shot 2" });
  });
});

describe("queued takes", () => {
  it("your GPU continues from the segment right before only (its master holds that segment's frames)", () => {
    const p = projectOf();
    const s = { ...shotOf(p), approvedAnchor: null, settings: { ...DEFAULT_SETTINGS, useAnchor: false } };
    const at = (bounds: number[], history: number[]) => bounds.slice(0, -1).map((b, i) => ({ ...newSegment(s, b, bounds[i + 1], i, rand), history: history[i], anchorMode: "none" as const }));
    // Segment 2 is 20 frames long and segment 3 wants 35 frames of history: that reaches into segment 1.
    const gpu = { ...s, segments: at([0, 100, 120, 480], [0, 18, 35]) };
    const clip = { ...p.clips[0], shots: [gpu] };
    const q = planQueue({ ...p, clips: [clip] }, clip, gpu, gpu.segments[0].id, "all", { active: () => false, hasMaster: () => true });
    expect("problem" in q && q.problem).toMatch(/Segment 3: its 35 frames of history reach back past segment 2/);
    // Within segment 2: fine.
    const ok = { ...s, segments: at([0, 100, 140, 480], [0, 18, 35]) };
    const okClip = { ...p.clips[0], shots: [ok] };
    expect("entries" in planQueue({ ...p, clips: [okClip] }, okClip, ok, ok.segments[0].id, "all", { active: () => false, hasMaster: () => true })).toBe(true);
    // The cloud carries only the last frame across.
    const cloud = { ...s, segments: at([0, 100, 150, 480], [0, 18, 52]) };
    const cloudClip = { ...p.clips[0], shots: [cloud] };
    expect("entries" in planQueue({ ...p, engine: "cloud", clips: [cloudClip] }, cloudClip, cloud, cloud.segments[0].id, "all", { active: () => false })).toBe(true);
  });

  it("a frozen take runs with what it was queued with, not later edits", () => {
    const p = projectOf();
    const s = { ...shotOf(p), settings: { ...DEFAULT_SETTINGS, useAnchor: false } };
    const items = currentSegments(s).map((g) => ({ ...g, anchorMode: "none" as const }));
    const shot = { ...s, segments: items };
    const clip = { ...p.clips[0], shots: [shot] };
    const proj = { ...p, clips: [clip] };
    const seg = items[1];
    const t: SwapTake = { ...take("q1", { state: "waiting", genId: undefined }), prompt: segmentPrompt(proj, clip, shot, seg), seed: seg.seed, signature: settingSignature(proj, clip, shot, seg), dependencies: dependencies(items, 1), frozen: freezeTake(proj, shot, seg) };
    expect(t.frozen).toMatchObject({ reference: "/api/files/uploads/x/hero.png", shotStart: 0, start: seg.start, end: seg.end, history: seg.history, anchor: null, mask: null });
    // Edited after queueing: another character, LoRA and who to swap.
    const edited = { ...proj, character: { ...proj.character, image: "/api/files/other.png" } };
    const later = { ...shot, settings: { ...shot.settings, lora: "none" as const, renderMp: 0.5 as const }, who: { selection: "leftmost" as const, index: 0, words: "the child" } };
    const plan = frozenTakePlan(edited, clip, later, seg, t, { shot: 1, segment: 2, take: 1 }, { master: "/api/files/master.mkv", frames: items[0].end - items[0].start });
    const r = plan.steps[0].request;
    expect(r.inputs?.images).toEqual(["/api/files/uploads/x/hero.png"]);
    expect(r.params?.resolution).toBe("768p");
    expect(r.params?.extra).toMatchObject({ selection: "largest", maskPrompt: "person", historyVideo: "/api/files/master.mkv", historyStart: items[0].end - items[0].start - seg.history, historyLength: seg.history });
    expect(r.params?.extra).not.toHaveProperty("lora");
    expect(() => frozenTakePlan(edited, clip, later, seg, { ...t, frozen: undefined }, { shot: 1, segment: 2, take: 1 }, null)).toThrow(/queue the segment again/);
  });
});

describe("cloud mask updates", () => {
  it("Update frame cuts half a second from the frame (past the shot's end if need be); its piece is that one frame", () => {
    const p = projectOf([clipOf()], "cloud");
    const shot = { ...shotOf(p), start: 24, end: 120 };
    const [cut, mask] = planMask({ engine: "cloud", clip: p.clips[0], shot, kind: "frame", frame: 90, points: [{ x: 5, y: 5 }], who: shot.who, base: null });
    // Frame 114 of the clip, six frames before the shot ends: still half a second of clip to trim and track.
    expect(cut.request.params).toEqual({ startTime: 114 / 24, endTime: 126 / 24 });
    expect(mask.request.params).toMatchObject({ duration: 12 / 24, points: [{ x: 5, y: 5 }] });
    const [mid] = planMask({ engine: "cloud", clip: p.clips[0], shot, kind: "frame", frame: 10, points: [{ x: 5, y: 5 }], who: shot.who, base: null });
    expect(mid.request.params).toEqual({ startTime: 34 / 24, endTime: 46 / 24 });
  });
});

describe("job state", () => {
  const g = (status: GenSummary["status"], over: Partial<GenSummary> = {}): GenSummary => ({ status, progress: null, message: null, error: null, costUsd: 0, demo: true, ...over });

  it("a job is its final generation, unless a step before it failed (that error is the reason)", () => {
    expect(jobState(undefined, undefined, {})).toEqual({ status: "missing", progress: null, message: null });
    expect(jobState("f", ["a", "f"], { a: g("succeeded"), f: g("succeeded") })).toEqual({ status: "succeeded", progress: 1, message: null });
    expect(jobState("f", ["a", "b", "f"], { a: g("succeeded"), b: g("running", { progress: 0.5, message: "Tracking" }), f: g("queued") })).toEqual({ status: "running", progress: 0.5, message: "Tracking" });
    expect(jobState("f", ["a", "f"], { a: g("failed", { error: "fal: 422 video too long" }), f: g("failed", { error: "An earlier step didn't finish" }) })).toEqual({ status: "failed", progress: null, message: "fal: 422 video too long" });
    expect(jobState("f", ["f"], { f: g("canceled", { message: "Canceled" }) }).status).toBe("canceled");
  });
});
