import type { Engine, GenerationRequest } from "@/lib/catalog/types";

/**
 * Extract-frame requests for both engines. The cloud model (fal's FFmpeg extract-frame) knows the
 * first, middle or last frame; the open one (ComfyUI frame-extract) decodes a short Trim Video window
 * and takes its first or last frame, so it also does "the frame at 3.2 s".
 */
export type FramePick = "first" | "last" | { at: number };

export const FRAME_MODEL: Record<Engine, string> = { cloud: "extract-frame", open: "oss-extract-frame" };

/** How long a window the open workflow decodes around the moment asked for (seconds). */
const WINDOW = 0.5;

export function frameParams(engine: Engine, pick: FramePick): GenerationRequest["params"] {
  if (engine === "cloud") {
    if (typeof pick === "object") throw new Error("The cloud frame tool takes the first, middle or last frame — trim the clip first for a frame in between");
    return { extra: { frame_type: pick } };
  }
  if (pick === "last") return undefined; // the workflow's defaults: the last second, its last frame
  const at = pick === "first" ? 0 : Math.max(0, pick.at);
  return { startTime: at, endTime: at + WINDOW, extra: { frameIndex: 0 } };
}

/** A request for one frame of `video` (a URL or an upload). */
export function frameRequest(o: { feature: string; engine: Engine; video?: string; pick: FramePick; step?: GenerationRequest["step"] }): GenerationRequest {
  const params = frameParams(o.engine, o.pick);
  return {
    feature: o.feature,
    modelId: FRAME_MODEL[o.engine],
    op: "frame",
    ...(o.video && { inputs: { video: o.video } }),
    ...(params && { params }),
    ...(o.step && { step: o.step }),
  };
}
