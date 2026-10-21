/**
 * Just enough of the common media containers to know a file's shape before a job runs: duration, displayed
 * size, frame rate / count and which tracks it has. Reads MP4 / MOV / M4A (ISO-BMFF), WAV, FLAC and MP3 from
 * the bytes in memory; anything else (WebM, MKV, Ogg…) is "unknown" (null) and callers fall back to safe defaults.
 */
export interface MediaInfo {
  container: "mp4" | "wav" | "flac" | "mp3";
  /** Seconds (the longest track). */
  duration?: number;
  /** Seconds of picture (the video track alone). */
  videoDuration?: number;
  /** Displayed size (a 90° rotation matrix swaps the stored width and height). */
  width?: number;
  height?: number;
  fps?: number;
  frames?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export function probeMedia(data: Uint8Array): MediaInfo | null {
  try {
    if (data.length < 12) return null;
    if (fourcc(data, 0) === "RIFF" && fourcc(data, 8) === "WAVE") return probeWav(data);
    if (fourcc(data, 0) === "fLaC") return probeFlac(data);
    if (fourcc(data, 4) === "ftyp" || ["moov", "mdat", "free", "wide", "skip"].includes(fourcc(data, 4))) return probeIsoBmff(data);
    return probeMp3(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ISO-BMFF (mp4, mov, m4a)

interface Box {
  type: string;
  start: number; // payload start
  end: number;
}

function* boxes(d: DataView, start: number, end: number): Generator<Box> {
  let o = start;
  while (o + 8 <= end) {
    let size = d.getUint32(o);
    const type = String.fromCharCode(d.getUint8(o + 4), d.getUint8(o + 5), d.getUint8(o + 6), d.getUint8(o + 7));
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) return;
      size = Number(d.getBigUint64(o + 8));
      header = 16;
    } else if (size === 0) size = end - o;
    if (size < header) return;
    yield { type, start: o + header, end: Math.min(end, o + size) };
    o += size;
  }
}

const child = (d: DataView, parent: Box, type: string) => {
  for (const b of boxes(d, parent.start, parent.end)) if (b.type === type) return b;
  return undefined;
};

/** [timescale, duration] of an mvhd / mdhd box (same layout). */
function timing(d: DataView, b: Box): [number, number] {
  if (d.getUint8(b.start) === 1) return [d.getUint32(b.start + 20), Number(d.getBigUint64(b.start + 24))];
  return [d.getUint32(b.start + 12), d.getUint32(b.start + 16)];
}

function probeIsoBmff(data: Uint8Array): MediaInfo | null {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let moov: Box | undefined;
  for (const b of boxes(d, 0, data.length)) if (b.type === "moov") moov = b;
  if (!moov) return null;
  const info: MediaInfo = { container: "mp4", hasVideo: false, hasAudio: false };
  const mvhd = child(d, moov, "mvhd");
  if (mvhd) {
    const [scale, dur] = timing(d, mvhd);
    if (scale && dur) info.duration = dur / scale;
  }
  for (const trak of boxes(d, moov.start, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(d, trak, "mdia");
    const hdlr = mdia && child(d, mdia, "hdlr");
    const handler = hdlr ? fourcc(data, hdlr.start + 8) : "";
    if (handler === "soun") info.hasAudio = true;
    if (handler !== "vide" || info.hasVideo) continue;
    info.hasVideo = true;
    const tkhd = child(d, trak, "tkhd");
    if (tkhd) {
      const v = d.getUint8(tkhd.start);
      const m = tkhd.start + (v === 1 ? 52 : 40); // the matrix
      const a = d.getInt32(m);
      const dd = d.getInt32(m + 16);
      let w = d.getUint32(m + 36) / 65536;
      let h = d.getUint32(m + 40) / 65536;
      if (a === 0 && dd === 0) [w, h] = [h, w]; // rotated 90° / 270°
      if (w && h) Object.assign(info, { width: Math.round(w), height: Math.round(h) });
    }
    const mdhd = mdia && child(d, mdia, "mdhd");
    const stbl = mdia && child(d, mdia, "minf") && child(d, child(d, mdia, "minf")!, "stbl");
    const stts = stbl && child(d, stbl, "stts");
    if (stts) {
      const n = d.getUint32(stts.start + 4);
      let frames = 0;
      for (let i = 0; i < n && stts.start + 8 + i * 8 + 8 <= stts.end; i++) frames += d.getUint32(stts.start + 8 + i * 8);
      if (frames) info.frames = frames;
    }
    if (mdhd) {
      const [scale, dur] = timing(d, mdhd);
      if (scale && dur) {
        info.videoDuration = dur / scale;
        info.duration ??= dur / scale;
        if (info.frames) info.fps = Math.round((info.frames / (dur / scale)) * 1000) / 1000;
      }
    }
  }
  return info;
}

// ---------------------------------------------------------------------------
// WAV, FLAC, MP3

function probeWav(data: Uint8Array): MediaInfo | null {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let byteRate = 0;
  for (let o = 12; o + 8 <= data.length; ) {
    const id = fourcc(data, o);
    let size = d.getUint32(o + 4, true);
    if (id === "fmt ") byteRate = d.getUint32(o + 16, true);
    if (id === "data") {
      if (!size || size === 0xffffffff || o + 8 + size > data.length) size = data.length - o - 8; // streamed header
      return byteRate ? { container: "wav", duration: size / byteRate, hasVideo: false, hasAudio: true } : null;
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

function probeFlac(data: Uint8Array): MediaInfo | null {
  // STREAMINFO is always the first metadata block: 20-bit sample rate, 36-bit total samples.
  const o = 8 + 10;
  const rate = (data[o] << 12) | (data[o + 1] << 4) | (data[o + 2] >> 4);
  const total = (data[o + 3] & 0x0f) * 2 ** 32 + ((data[o + 4] << 24) >>> 0) + (data[o + 5] << 16) + (data[o + 6] << 8) + data[o + 7];
  if (!rate) return null;
  return { container: "flac", ...(total ? { duration: total / rate } : {}), hasVideo: false, hasAudio: true };
}

const MP3_BITRATES: Record<string, number[]> = {
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function probeMp3(data: Uint8Array): MediaInfo | null {
  let o = 0;
  if (fourcc(data, 0).startsWith("ID3")) o = 10 + ((data[6] & 0x7f) << 21) + ((data[7] & 0x7f) << 14) + ((data[8] & 0x7f) << 7) + (data[9] & 0x7f);
  // The first frame header within a few KB of the tag.
  for (const limit = Math.min(data.length - 4, o + 8192); o < limit; o++) if (data[o] === 0xff && (data[o + 1] & 0xe0) === 0xe0) break;
  if (o + 4 > data.length || data[o] !== 0xff) return null;
  const version = (data[o + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (data[o + 1] >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrate = (MP3_BITRATES[version === 3 ? "1-3" : "2-3"][data[o + 2] >> 4] ?? 0) * 1000;
  const rate = MP3_RATES[version]?.[(data[o + 2] >> 2) & 3];
  if (!rate) return null;
  const mono = data[o + 3] >> 6 === 3;
  const samplesPerFrame = version === 3 ? 1152 : 576;
  const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const x = o + 4 + side;
  const tag = fourcc(data, x);
  if ((tag === "Xing" || tag === "Info") && data[x + 7] & 1) {
    const frames = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(x + 8);
    return { container: "mp3", duration: (frames * samplesPerFrame) / rate, hasVideo: false, hasAudio: true };
  }
  if (!bitrate) return null;
  return { container: "mp3", duration: ((data.length - o) * 8) / bitrate, hasVideo: false, hasAudio: true };
}
