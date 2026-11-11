import { MOTION_H3, OPENJUTSU_LIMITS } from "@/lib/catalog/genjutsu";
import type { GenerationRequest } from "@/lib/catalog/types";
import { h3MotionPlan } from "@/lib/h3-references";

/** The video model whose reference runs can ask for a motion copy. */
const H3_REFERENCES = "oss-minimax-h3";

/**
 * A Video studio run on MiniMax H3 with references that asks for the person in a picture to perform the movement of the clip
 * ("the woman in image 1 dancing like the woman in clip 1") as Genjutsu's Motion transfer on H3: the picture is the look,
 * the clip's surface normals the motion, the clip's sound kept. Reference-to-video copies a reference clip as footage, so
 * this run goes to the tool made for it. The person's words stay the run's prompt; the graph writes its own words.
 * `clipSeconds`: the clip's length, when known (the motion is taken from its start). Null for every other run.
 */
export function motionCopyRequest<T extends GenerationRequest>(req: T, clipSeconds?: number): T | null {
  if (req.modelId !== H3_REFERENCES || req.op !== "ref2v" || req.engine === "cloud" || !req.prompt) return null;
  const images = req.inputs?.images ?? [];
  const videos = req.inputs?.videos ?? [];
  const audios = req.inputs?.audios ?? [];
  const plan = h3MotionPlan(req.prompt, { images: images.length, videos: videos.length, audios: audios.length });
  if (!plan) return null;
  const { minSeconds, maxSeconds } = OPENJUTSU_LIMITS;
  const asked = Number(req.params?.duration) > 0 ? Number(req.params?.duration) : 5;
  const room = clipSeconds && clipSeconds > 0 ? clipSeconds : maxSeconds;
  const seconds = Math.round(Math.max(minSeconds, Math.min(asked, room, maxSeconds)) * 1000) / 1000;
  const quality = /^(?:1080|768|720)p$/.test(String(req.params?.resolution ?? "720p")) ? "720p" : "480p";
  const seed = typeof req.params?.seed === "number" ? { seed: req.params.seed } : {};
  return {
    ...req,
    modelId: MOTION_H3,
    op: "motion-transfer",
    inputs: { video: videos[0], images: [images[plan.picture - 1]] },
    params: { ...seed, resolution: quality, extra: { openjutsu: { seconds, quality, motion: 0, scene: "", ...seed } } },
  };
}
