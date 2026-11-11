import { describe, expect, it } from "vitest";
import { MOTION_H3, OPENJUTSU_LIMITS } from "@/lib/catalog/genjutsu";
import { getModel } from "@/lib/catalog";
import type { GenerationRequest } from "@/lib/catalog/types";
import { h3MotionPlan } from "@/lib/h3-references";
import { motionCopyRequest } from "@/lib/motion-copy";

const ONE = { images: 1, videos: 1, audios: 0 };
const ASK = "create a video of the woman in image 1 dancing like the woman in clip 1";
const IMG = "/api/files/uploads/2026-11-11/pic.png";
const CLIP = "/api/files/uploads/2026-11-11/clip.mp4";

const videoRun = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  feature: "video",
  modelId: "oss-minimax-h3",
  op: "ref2v",
  prompt: ASK,
  inputs: { images: [IMG], videos: [CLIP] },
  params: { aspectRatio: "auto", resolution: "768p", duration: 5 },
  engine: "open",
  ...over,
});

describe("h3MotionPlan", () => {
  it("finds a picture's person asked to move like the clip", () => {
    expect(h3MotionPlan(ASK, ONE)).toEqual({ picture: 1 });
    expect(h3MotionPlan("Make the man in image 2 do the same moves as clip 1", { images: 2, videos: 1, audios: 0 })).toEqual({ picture: 2 });
    expect(h3MotionPlan("image 1 copies the choreography of the clip", ONE)).toEqual({ picture: 1 });
  });

  it("leaves other reference runs alone", () => {
    expect(h3MotionPlan("the woman in image 1 walks along the beach at sunset", ONE)).toBeNull();
    expect(h3MotionPlan("the woman in image 1 walks into the scene of clip 1", ONE)).toBeNull();
    expect(h3MotionPlan(ASK, { images: 0, videos: 1, audios: 0 })).toBeNull();
    expect(h3MotionPlan(ASK, { images: 1, videos: 2, audios: 0 })).toBeNull();
    expect(h3MotionPlan(ASK, { images: 1, videos: 1, audios: 1 })).toBeNull();
    expect(h3MotionPlan(`integrated_multimodal_description: [Shot 1] ${ASK}`, ONE)).toBeNull();
    expect(h3MotionPlan("the woman in image 3 dances like clip 1", ONE)).toBeNull();
  });
});

describe("motionCopyRequest", () => {
  it("sends the run to Motion transfer on H3 with the picture and the clip", () => {
    const out = motionCopyRequest(videoRun({ account: "acc1", place: "pool" } as Partial<GenerationRequest>), 12.3)!;
    expect(out.modelId).toBe(MOTION_H3);
    expect(out.op).toBe("motion-transfer");
    expect(getModel(MOTION_H3)!.routes.some((r) => r.op === "motion-transfer" && r.provider === "comfyui")).toBe(true);
    expect(out.inputs).toEqual({ video: CLIP, images: [IMG] });
    expect(out.params).toEqual({ resolution: "720p", extra: { openjutsu: { seconds: 5, quality: "720p", motion: 0, scene: "" } } });
    // The person's words and the run's place and account stay as they were.
    expect(out.prompt).toBe(ASK);
    expect(out.feature).toBe("video");
    expect((out as GenerationRequest & { account?: string; place?: string }).account).toBe("acc1");
    expect((out as GenerationRequest & { place?: string }).place).toBe("pool");
  });

  it("takes the picture the words name, and the run's seed", () => {
    const out = motionCopyRequest(videoRun({ prompt: "the man in image 2 dances like clip 1", inputs: { images: ["/a.png", "/b.png"], videos: [CLIP] }, params: { resolution: "480p", duration: 5, seed: 42 } }))!;
    expect(out.inputs?.images).toEqual(["/b.png"]);
    expect(out.params).toEqual({ seed: 42, resolution: "480p", extra: { openjutsu: { seconds: 5, quality: "480p", motion: 0, scene: "", seed: 42 } } });
  });

  it("fits the length inside the clip and Motion transfer's limits", () => {
    const secs = (duration: number, clip?: number) => (motionCopyRequest(videoRun({ params: { resolution: "768p", duration } }), clip)!.params!.extra!.openjutsu as { seconds: number }).seconds;
    expect(secs(10, 4.2)).toBe(4.2);
    expect(secs(10)).toBe(10);
    expect(secs(30)).toBe(OPENJUTSU_LIMITS.maxSeconds);
    expect(secs(1, 12)).toBe(OPENJUTSU_LIMITS.minSeconds);
  });

  it("leaves every other run as it is", () => {
    expect(motionCopyRequest(videoRun({ prompt: "the woman in image 1 walks along the beach" }))).toBeNull();
    expect(motionCopyRequest(videoRun({ op: "i2v" }))).toBeNull();
    expect(motionCopyRequest(videoRun({ modelId: "minimax-h3" }))).toBeNull();
    expect(motionCopyRequest(videoRun({ engine: "cloud" }))).toBeNull();
    expect(motionCopyRequest(videoRun({ prompt: "" }))).toBeNull();
    expect(motionCopyRequest(videoRun({ inputs: { images: [IMG], videos: [CLIP], audios: ["/v.wav"] } }))).toBeNull();
  });
});
