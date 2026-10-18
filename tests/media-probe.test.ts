import { describe, expect, it } from "vitest";
import { probeMedia } from "@/lib/media-probe";

const u32 = (...v: number[]) =>
  Buffer.concat(
    v.map((n) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(n >>> 0);
      return b;
    }),
  );
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4);
  return Buffer.concat([head, body]);
};

/** ISO-BMFF with a video trak (optionally rotated 90°) and an optional sound trak; moov after mdat like a camera file. */
function mp4({ w = 1920, h = 1080, rotate = false, audio = true, frames = 300, fps = 30 } = {}): Buffer {
  const scale = 600;
  const dur = Math.round((frames / fps) * scale);
  const mvhd = box("mvhd", u32(0, 0, 0, scale, dur + (audio ? 12 : 0)), Buffer.alloc(80));
  const matrix = rotate ? u32(0, 0x10000, 0, 0xffff0000, 0, 0, 0, 0, 0x40000000) : u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
  const tkhd = box("tkhd", u32(0, 0, 0, 1, 0, dur), Buffer.alloc(16), matrix, u32(w << 16, h << 16));
  const video = box(
    "trak",
    tkhd,
    box("mdia", box("mdhd", u32(0, 0, 0, fps * 1000, frames * 1000), Buffer.alloc(4)), box("hdlr", u32(0, 0), Buffer.from("vide"), Buffer.alloc(12)), box("minf", box("stbl", box("stts", u32(0, 2, frames - 1, 1000, 1, 1000))))),
  );
  const sound = box("trak", box("mdia", box("mdhd", u32(0, 0, 0, 48000, 48000 * 10), Buffer.alloc(4)), box("hdlr", u32(0, 0), Buffer.from("soun"), Buffer.alloc(12))));
  return Buffer.concat([box("ftyp", Buffer.from("mp42"), u32(0)), box("mdat", Buffer.alloc(64)), box("moov", mvhd, video, ...(audio ? [sound] : []))]);
}

function wav(seconds: number, rate = 22050, channels = 1): Buffer {
  const data = Buffer.alloc(Math.round(seconds * rate) * 2 * channels);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2 * channels, 28);
  h.writeUInt16LE(2 * channels, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("media probe", () => {
  it("reads an MP4's length, size, frame rate and tracks, with moov after the media data", () => {
    expect(probeMedia(mp4())).toEqual({ container: "mp4", hasVideo: true, hasAudio: true, duration: 10.02, videoDuration: 10, width: 1920, height: 1080, frames: 300, fps: 30 });
    expect(probeMedia(mp4({ audio: false, frames: 120, fps: 24 }))).toMatchObject({ hasAudio: false, duration: 5, videoDuration: 5, fps: 24, frames: 120 });
  });

  it("swaps width and height for a phone clip stored with a 90° rotation", () => {
    expect(probeMedia(mp4({ rotate: true }))).toMatchObject({ width: 1080, height: 1920 });
  });

  it("reads WAV, FLAC and MP3 lengths", () => {
    expect(probeMedia(wav(2.5))).toEqual({ container: "wav", duration: 2.5, hasVideo: false, hasAudio: true });
    expect(probeMedia(wav(1, 48000, 2))?.duration).toBe(1);
    // FLAC STREAMINFO: 44.1 kHz, 132300 samples = 3 s
    const flac = Buffer.alloc(42);
    flac.write("fLaC", 0);
    flac.writeUInt32BE(34, 4); // block header: STREAMINFO, 34 bytes
    const rate = 44100;
    const total = 132300;
    flac[18] = rate >> 12;
    flac[19] = (rate >> 4) & 0xff;
    flac[20] = ((rate & 0xf) << 4) | (1 << 1);
    flac[21] = 0xf0 | Math.floor(total / 2 ** 32);
    flac.writeUInt32BE(total >>> 0, 22);
    expect(probeMedia(flac)).toEqual({ container: "flac", duration: 3, hasVideo: false, hasAudio: true });
    // MP3 with a Xing header: MPEG-1 Layer III, 44.1 kHz stereo, 100 frames × 1152 samples
    const mp3 = Buffer.alloc(417 * 3);
    mp3.set([0xff, 0xfb, 0x90, 0x00], 0);
    mp3.write("Xing", 4 + 32);
    mp3.writeUInt32BE(1, 4 + 32 + 4);
    mp3.writeUInt32BE(100, 4 + 32 + 8);
    expect(probeMedia(mp3)?.duration).toBeCloseTo((100 * 1152) / 44100, 6);
    // CBR without a header: 128 kbps → bytes × 8 / bitrate
    const cbr = Buffer.alloc(16000);
    cbr.set([0xff, 0xfb, 0x90, 0x00], 0);
    expect(probeMedia(cbr)?.duration).toBeCloseTo(1, 6);
  });

  it("says nothing about containers it doesn't read", () => {
    expect(probeMedia(Buffer.from("\x1aE\xdf\xa3 webm header....."))).toBeNull();
    expect(probeMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBeNull();
    expect(probeMedia(Buffer.alloc(4))).toBeNull();
  });
});
