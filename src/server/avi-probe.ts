/**
 * The header of an AVI file (RIFF 'AVI '): length, frame size, frame rate and whether it has a sound stream. Character
 * Swap Studio takes AVI clips (Akatz Labs' tool does), so the server reads their length and size like an MP4's
 * before anything runs. Only the 'hdrl' list at the start is read: the main header (avih) and each stream's header
 * (strh). Pure.
 */
export interface AviInfo {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

const tag = (b: Buffer, at: number) => b.toString("latin1", at, at + 4);

/** The AVI header facts, or null when the bytes aren't an AVI. */
export function probeAvi(buf: Buffer): AviInfo | null {
  if (buf.length < 12 || tag(buf, 0) !== "RIFF" || !/^AVI[ X]$/.test(tag(buf, 8))) return null;
  const info: AviInfo = { hasAudio: false, hasVideo: false };
  let frameUs = 0;
  let totalFrames = 0;
  let videoRate: { scale: number; rate: number; length: number } | null = null;
  // Walk the chunks inside one list (or the file), descending into LIST hdrl / strl.
  const walk = (start: number, end: number) => {
    let at = start;
    while (at + 8 <= end) {
      const id = tag(buf, at);
      const size = buf.readUInt32LE(at + 4);
      const body = at + 8;
      const next = body + size + (size & 1);
      if (size > end - body) break;
      if (id === "LIST") {
        const kind = tag(buf, body);
        if (kind === "hdrl" || kind === "strl") walk(body + 4, body + size);
        if (kind === "movi") return;
      } else if (id === "avih" && size >= 40) {
        frameUs = buf.readUInt32LE(body);
        totalFrames = buf.readUInt32LE(body + 16);
        info.width = buf.readUInt32LE(body + 32) || undefined;
        info.height = buf.readUInt32LE(body + 36) || undefined;
      } else if (id === "strh" && size >= 36) {
        const type = tag(buf, body);
        if (type === "auds") info.hasAudio = true;
        if (type === "vids") {
          info.hasVideo = true;
          if (!videoRate) videoRate = { scale: buf.readUInt32LE(body + 20), rate: buf.readUInt32LE(body + 24), length: buf.readUInt32LE(body + 32) };
        }
      }
      at = next;
    }
  };
  walk(12, buf.length);
  const v = videoRate as { scale: number; rate: number; length: number } | null;
  // The video stream's own rate and length are exact; the main header's microseconds per frame are rounded.
  if (v && v.scale > 0 && v.rate > 0) {
    info.fps = Math.round((v.rate / v.scale) * 1000) / 1000;
    const frames = v.length || totalFrames;
    if (frames) info.duration = Math.round(((frames * v.scale) / v.rate) * 1000) / 1000;
  } else if (frameUs > 0) {
    info.fps = Math.round((1e6 / frameUs) * 1000) / 1000;
    if (totalFrames) info.duration = Math.round(((totalFrames * frameUs) / 1e6) * 1000) / 1000;
  }
  return info;
}
