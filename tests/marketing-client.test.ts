import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, uniqueNames, zipFiles } from "@/components/ads/zip";
import { initialClip, MULTIPLIER } from "@/lib/catalog/marketing";
import { clampRange, setEdge } from "@/lib/trim-range";

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

  it("keeps the selection 4–30 s inside the clip (the shared trimmer with the multiplier's limits)", () => {
    const L = { duration: 60, min: MULTIPLIER.minSeconds, max: MULTIPLIER.maxSeconds };
    const r = (startTime: number, endTime: number) => ({ startTime, endTime });
    // The out point dragged far: it stops 30 s after the in point.
    expect(clampRange(r(0, 50), L, "end")).toEqual(r(0, 30));
    // A typed out time past the limit keeps the in point too; the window slides to pick another part.
    expect(setEdge(r(12, 16), "end", 20, L)).toEqual(r(12, 20));
    expect(clampRange(r(20, 21), L, "start")).toEqual(r(17, 21));
    // Out of bounds values are pulled back in.
    expect(clampRange(r(-3, 70), L, "move")).toEqual(r(0, 30));
    // A clip under 4 s can't be fixed by trimming: it stays whole (the form says why).
    expect(clampRange(r(0, 3), { ...L, duration: 3 }, "end")).toEqual(r(0, 3));
  });
});
