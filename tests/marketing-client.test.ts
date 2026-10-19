import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, uniqueNames, zipFiles } from "@/components/ads/zip";
import { clampClip, initialClip, MULTIPLIER } from "@/lib/catalog/marketing";

/** Read a stored zip back: every entry's name and bytes, from the central directory. */
function readZip(zip: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.byteLength - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let at = v.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extra = v.getUint16(at + 30, true);
    const comment = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint16(local + 8, true)).toBe(0); // stored
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.push({ name, data: zip.subarray(start, start + size), crc });
    at += 46 + nameLen + extra + comment;
  }
  return out;
}

describe("Download all (browser zip)", () => {
  it("computes the standard CRC-32", () => {
    const data = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    expect(crc32(data)).toBe(0x414fa339);
    expect(crc32(data)).toBe(zlib.crc32(data));
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("keeps names unique without losing the extension", () => {
    expect(uniqueNames(["ad.png", "AD.png", "ad.png", "readme"])).toEqual(["ad.png", "AD (2).png", "ad (3).png", "readme"]);
  });

  it("writes a zip any unzip tool reads back byte for byte", () => {
    const a = new Uint8Array(5000).map((_, i) => i % 251);
    const b = new TextEncoder().encode("second ad");
    const zip = zipFiles([
      { name: "ember-oat-granola-4x5-1.png", data: a },
      { name: "ember-oat-granola-4x5-1.png", data: b },
    ]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(["ember-oat-granola-4x5-1.png", "ember-oat-granola-4x5-1 (2).png"]);
    expect([...files[0].data]).toEqual([...a]);
    expect(new TextDecoder().decode(files[1].data)).toBe("second ad");
    expect(files[0].crc).toBe(zlib.crc32(a));
    expect(zipFiles([]).byteLength).toBe(22);
  });
});

describe("Ad Multiplier in/out points", () => {
  it("starts with the whole clip, or its first 30 s", () => {
    expect(initialClip(12.34)).toEqual({ start: 0, end: 12.3 });
    expect(initialClip(95)).toEqual({ start: 0, end: MULTIPLIER.maxSeconds });
  });

  it("keeps the range 4–30 s inside the clip, moving the other point", () => {
    // Out point dragged far: the in point follows to keep 30 s.
    expect(clampClip({ start: 0, end: 50 }, 60, "end")).toEqual({ start: 20, end: 50 });
    // In point dragged past the out point: the out point moves to keep 4 s.
    expect(clampClip({ start: 20, end: 21 }, 60, "start")).toEqual({ start: 20, end: 24 });
    // Near the end of the clip the in point gives way instead.
    expect(clampClip({ start: 58, end: 60 }, 60, "start")).toEqual({ start: 56, end: 60 });
    // Out of bounds values are pulled back in.
    expect(clampClip({ start: -3, end: 70 }, 60, "start")).toEqual({ start: 0, end: 30 });
    // A clip under 4 s can't be fixed by trimming; it stays whole (the form says why).
    expect(clampClip({ start: 0, end: 3 }, 3, "end")).toEqual({ start: 0, end: 3 });
  });
});
