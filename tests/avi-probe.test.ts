import { describe, expect, it } from "vitest";
import { probeAvi } from "@/server/avi-probe";
import { mediaFacts } from "@/server/media-facts";

// AVI headers (Character Swap Studio imports AVI clips): built here chunk by chunk, as FFmpeg writes them.
const chunk = (id: string, body: Buffer) => {
  const head = Buffer.alloc(8);
  head.write(id, 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
};
const list = (kind: string, ...items: Buffer[]) => chunk("LIST", Buffer.concat([Buffer.from(kind, "latin1"), ...items]));
function avih(o: { us: number; frames: number; width: number; height: number }) {
  const b = Buffer.alloc(56);
  b.writeUInt32LE(o.us, 0);
  b.writeUInt32LE(o.frames, 16);
  b.writeUInt32LE(o.width, 32);
  b.writeUInt32LE(o.height, 36);
  return chunk("avih", b);
}
function strh(type: "vids" | "auds", scale: number, rate: number, length: number) {
  const b = Buffer.alloc(56);
  b.write(type, 0, "latin1");
  b.writeUInt32LE(scale, 20);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(length, 32);
  return chunk("strh", b);
}
const riff = (...items: Buffer[]) => {
  const body = Buffer.concat([Buffer.from("AVI ", "latin1"), ...items]);
  return chunk("RIFF", body);
};

describe("AVI headers", () => {
  it("read the length, size, frame rate and sound from the stream headers", () => {
    const file = riff(list("hdrl", avih({ us: 33367, frames: 120, width: 1280, height: 720 }), list("strl", strh("vids", 1001, 30000, 120)), list("strl", strh("auds", 1, 48000, 192000))), list("movi", Buffer.alloc(16)));
    expect(probeAvi(file)).toEqual({ hasVideo: true, hasAudio: true, width: 1280, height: 720, fps: 29.97, duration: 4.004 });
    expect(mediaFacts(file)).toEqual({ duration: 4.004, width: 1280, height: 720, fps: 29.97, hasAudio: true });
  });

  it("fall back to the main header, and say a silent clip has no sound", () => {
    const file = riff(list("hdrl", avih({ us: 40000, frames: 250, width: 640, height: 480 }), list("strl", strh("vids", 0, 0, 0))));
    expect(probeAvi(file)).toEqual({ hasVideo: true, hasAudio: false, width: 640, height: 480, fps: 25, duration: 10 });
  });

  it("isn't fooled by other RIFF files or short bytes", () => {
    const wav = chunk("RIFF", Buffer.concat([Buffer.from("WAVE", "latin1"), chunk("fmt ", Buffer.alloc(16))]));
    expect(probeAvi(wav)).toBeNull();
    expect(probeAvi(Buffer.from("RIFF"))).toBeNull();
    // A truncated header reads what is there.
    const cut = riff(list("hdrl", avih({ us: 41667, frames: 24, width: 320, height: 180 }))).subarray(0, 40);
    expect(probeAvi(cut)).toMatchObject({ hasVideo: false });
  });
});
