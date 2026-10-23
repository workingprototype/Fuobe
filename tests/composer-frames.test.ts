import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { frameSupport, framesBlocker, framesDuration, keyframeChain } from "@/lib/catalog/keyframes";
import { planGeneration } from "@/lib/catalog/plan";
import { addFrame, blockerFor, enterFrames, framesRequest, framesShape, leaveFrames, removeFrame, replaceAttachment, settingsShape, type Attachment, type FrameAttachment } from "@/lib/composer";
import { VIDEO_STUDIO } from "@/lib/studios";
import { studioCatalog } from "@/lib/studio-catalog";

const still = (name: string, extra: Partial<Attachment> = {}): Attachment => ({ id: name, ref: `/api/files/${name}.png`, preview: `/api/files/${name}.png`, kind: "image", ...extra });
const ctxFor = (id: string, duration?: number) => {
  const m = getModel(id)!;
  return { support: frameSupport(m), duration: framesDuration(m, duration), chained: !!keyframeChain(m) };
};
const framesOf = (...names: string[]) => names.reduce<FrameAttachment[]>((fs, n) => addFrame(fs, still(n)), []);

describe("Frames mode in the Video studio composer", () => {
  it("is offered in the Video studio, whose list has the models that take every frame", () => {
    expect(VIDEO_STUDIO.frames).toBe(true);
    const ids = studioCatalog(VIDEO_STUDIO).models.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["flux-3-max", "oss-wan22-14b-fast", "oss-wan22-14b", "kling-o3"]));
    // The client copy keeps the chained route's marker (the field maps stay on the server).
    const wan = studioCatalog(VIDEO_STUDIO).models.find((m) => m.id === "oss-wan22-14b-fast")!;
    expect(wan.routes.find((r) => r.op === "keyframes")).toMatchObject({ chained: true });
    expect(wan.routes.every((r) => !r.map)).toBe(true);
  });

  it("takes the start and end frames in when it opens, and gives the first and last back when it closes", () => {
    const start = still("start");
    const end = still("end");
    const on = enterFrames({ image: start, endImage: end, sketch: still("drawing") });
    expect(on.frames).toEqual([
      { value: start, at: 0 },
      { value: end, at: 1 },
    ]);
    expect(on.slots).toEqual({ image: null, endImage: null, mask: null, sketch: null });
    expect(enterFrames({}).frames).toEqual([]);
    const four = framesOf("a", "b", "c", "d");
    expect(leaveFrames(four, {})).toEqual({ slots: { image: four[0].value, endImage: four[3].value, mask: null, sketch: null }, dropped: 2 });
    expect(leaveFrames(framesOf("a"), {}).slots).toMatchObject({ image: four[0].value, endImage: null });
  });

  it("spaces new frames evenly, and a finished upload keeps its frame's place", () => {
    const fs = framesOf("a", "b", "c");
    expect(fs.map((f) => f.at)).toEqual([0, 0.5, 1]);
    const uploading = addFrame(fs, still("d", { ref: "", uploading: true }));
    expect(uploading.map((f) => f.at)).toEqual([0, 1 / 3, 2 / 3, 1]);
    const done = replaceAttachment({ slots: {}, refs: [], frames: uploading }, "d", still("d2"));
    expect(done?.frames?.[3]).toEqual({ value: { ...still("d2"), id: "d" }, at: 1 });
    // A failed upload leaves the strip; evenly spaced frames close up.
    expect(replaceAttachment({ slots: {}, refs: [], frames: uploading }, "d", null)?.frames?.map((f) => f.at)).toEqual([0, 0.5, 1]);
    expect(removeFrame(fs, 0).map((f) => f.value.id)).toEqual(["b", "c"]);
  });

  it("sends FLUX 3 Max every frame at its time, snapped to 0.1 s, at the strip's length", () => {
    const fs = framesOf("a", "b", "c", "d");
    const sent = framesRequest(fs, ctxFor("flux-3-max", 8));
    expect(sent.images).toEqual(fs.map((f) => f.value.ref));
    expect(sent.endImage).toBeUndefined();
    expect(sent.params).toMatchObject({ duration: 8, keyframeTimes: [0, 2.7, 5.3, 8] });
    expect(sent.params.numOutputs).toBeUndefined();
    const plan = planGeneration({ feature: "video", modelId: "flux-3-max", prompt: "a paper boat", inputs: { images: sent.images }, params: sent.params }, getModel, getPreset);
    expect(plan.op).toBe("keyframes");
  });

  it("keeps only the first and last for a start + end frame model, and the start alone for one frame", () => {
    const fs = framesOf("a", "b", "c");
    const sent = framesRequest(fs, ctxFor("kling-o3", 5));
    expect(sent).toMatchObject({ images: [fs[0].value.ref], endImage: fs[2].value.ref, params: { duration: 5, keyframeTimes: undefined } });
    const plan = planGeneration({ feature: "video", modelId: "kling-o3", prompt: "x", inputs: { images: sent.images, endImage: sent.endImage }, params: sent.params }, getModel, getPreset);
    expect(plan.op).toBe("flf2v");
    expect(framesRequest(framesOf("a"), ctxFor("flux-3-max"))).toMatchObject({ images: ["/api/files/a.png"], params: { keyframeTimes: undefined } });
  });

  it("makes one film on the open chain, and leaves frames still uploading out", () => {
    const fs = addFrame(framesOf("a", "b"), still("c", { ref: "", uploading: true }));
    const sent = framesRequest(fs, ctxFor("oss-wan22-14b-fast", 8));
    expect(sent.images).toEqual(["/api/files/a.png", "/api/files/b.png"]);
    expect(sent.params).toMatchObject({ duration: 8, keyframeTimes: [0, 4], numOutputs: 1 });
  });

  it("asks for the start frame first and says which models can't follow frames", () => {
    const base = { model: true, uploading: false, promptMissing: true };
    expect(blockerFor({ ...base, frames: framesBlocker(getModel("flux-3-max")!, 0) })).toEqual({ message: "Add the start frame", slot: "frames" });
    expect(blockerFor({ ...base, frames: framesBlocker(getModel("oss-ltx25")!, 2) })?.message).toBe("LTX-2.5 takes a start frame only — pick Wan 2.2 14B to follow your frames, or turn Frames off");
    // A model that takes every frame (or the ends) falls through to the usual checks.
    expect(blockerFor({ ...base, frames: framesBlocker(getModel("kling-o3")!, 3) })?.message).toBe("Write a prompt first");
    expect(blockerFor({ ...base, loading: "Loading models…", frames: framesBlocker(getModel("flux-3-max")!, 0) })?.message).toBe("Loading models…");
  });

  it("hides the settings the strip owns", () => {
    const shape = settingsShape(getModel("oss-wan22-14b-fast"), "keyframes", "video", true, {}, VIDEO_STUDIO.ops);
    expect(shape.duration).not.toBeNull();
    expect(framesShape(shape, true)).toMatchObject({ duration: null, multiShot: false, count: false });
    expect(framesShape(settingsShape(getModel("flux-3-max"), "keyframes", "video", true, {}, VIDEO_STUDIO.ops), false)).toMatchObject({ duration: null, count: true });
  });
});
