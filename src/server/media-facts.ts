import "server-only";
import fs from "node:fs/promises";
import { probeMedia, probeMediaRanges, type MediaInfo } from "@/lib/media-probe";
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

/** How much of the start of a WebM / Matroska or AVI file is read for its header (the tracks come before the media). */
const HEADER_BYTES = 1024 * 1024;

/**
 * The header facts of a stored file, read in ranges and never whole (a 2 GB upscale is a few small reads): an MP4 /
 * MOV's moov box, a WAV / FLAC / MP3 header, else the first megabyte for a WebM / Matroska or AVI header. Null when no
 * reader knows the file; throws when it can't be opened.
 */
export async function fileInfo(abs: string): Promise<MediaInfo | null> {
  const fh = await fs.open(abs, "r");
  try {
    const size = (await fh.stat()).size;
    const read = async (start: number, end: number) => {
      const buf = Buffer.alloc(Math.max(0, Math.min(end, size) - start));
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    };
    const info = await probeMediaRanges(read, size);
    if (info) return info;
    const head = Buffer.from(await read(0, Math.min(size, HEADER_BYTES)));
    const webm = probeWebm(head);
    if (webm) return { container: "webm", duration: webm.duration, width: webm.width, height: webm.height, fps: webm.fps, hasVideo: webm.hasVideo, hasAudio: webm.hasAudio, ...(webm.channels && { channels: webm.channels }) };
    const avi = probeAvi(head);
    return avi ? { container: "avi", duration: avi.duration, width: avi.width, height: avi.height, fps: avi.fps, hasVideo: avi.hasVideo, hasAudio: avi.hasAudio } : null;
  } finally {
    await fh.close();
  }
}
