import "server-only";
import { probeMedia } from "@/lib/media-probe";
import { probeAvi } from "./avi-probe";
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
 * The header facts of a clip in memory: MP4 / MOV first, then WebM / Matroska, then AVI. A file no reader
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
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const webm = probeWebm(buf);
    if (webm) return { duration: webm.duration, width: webm.width, height: webm.height, fps: webm.fps, hasAudio: webm.hasAudio };
    const avi = probeAvi(buf);
    return avi ? { duration: avi.duration, width: avi.width, height: avi.height, fps: avi.fps, hasAudio: avi.hasAudio } : {};
  }
  return { duration: info.videoDuration ?? info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio };
}
