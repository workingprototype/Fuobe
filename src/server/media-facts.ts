import "server-only";
import { probeMedia } from "@/lib/media-probe";
import { probeWebm } from "./webm-probe";

/** What a clip's header says: length, displayed size, frame rate and whether it has sound. */
export interface SourceInfo {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
}

/**
 * The header facts of a clip in memory: MP4 / MOV first, then WebM / Matroska. A file neither reader
 * knows comes back empty (callers fall back to the browser's numbers or safe defaults).
 */
export function mediaFacts(data: Uint8Array): SourceInfo {
  let info: ReturnType<typeof probeMedia> = null;
  try {
    info = probeMedia(data);
  } catch {
    info = null;
  }
  if (!info) {
    const webm = probeWebm(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return webm ? { duration: webm.duration, width: webm.width, height: webm.height, fps: webm.fps, hasAudio: webm.hasAudio } : {};
  }
  return { duration: info.videoDuration ?? info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio };
}
