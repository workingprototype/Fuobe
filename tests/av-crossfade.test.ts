import { describe, expect, it } from "vitest";
import { cloudLoopLength, cloudLoopPasses, crossfadeProblem, CURVE_RATE, fadeCurveWav, fadeGains, joinedLength, loopRepeats, loopSeams } from "@/lib/av/crossfade";
import { probeMedia } from "@/lib/media-probe";

/** The samples of a 16-bit stereo WAV as [left, right] pairs in −1…1. */
function samples(wav: Uint8Array): [number, number][] {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const n = v.getUint32(40, true) / 4;
  return Array.from({ length: n }, (_, i) => [v.getInt16(44 + i * 4, true) / 32767, v.getInt16(46 + i * 4, true) / 32767]);
}

describe("the crossfade curve the provider writes", () => {
  it("is a stereo 16-bit 8 kHz WAV exactly the crossfade long: left fades in, right fades out", () => {
    const wav = fadeCurveWav(1.5);
    const info = probeMedia(wav)!;
    expect(info).toMatchObject({ container: "wav", hasAudio: true });
    expect(info.duration).toBeCloseTo(1.5, 6);
    const v = new DataView(wav.buffer);
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([2, CURVE_RATE, 16]);
    const s = samples(wav);
    expect(s).toHaveLength(12_000);
    expect(s[0]).toEqual([0, 1]);
    expect(s[s.length - 1][0]).toBe(1);
    expect(s[s.length - 1][1]).toBeCloseTo(0, 4);
    // Equal power: sin² + cos² = 1 all the way through, and the fade-in only ever rises.
    for (const [a, b] of s) expect(a * a + b * b).toBeCloseTo(1, 3);
    expect(s.every((x, i) => i === 0 || x[0] >= s[i - 1][0])).toBe(true);
    const mid = s[Math.round((s.length - 1) / 2)];
    expect(mid[0]).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it("writes a linear curve for near-identical material, and refuses a zero-length fade", () => {
    const s = samples(fadeCurveWav(0.5, "linear"));
    expect(s).toHaveLength(4000);
    for (const [a, b] of s) expect(a + b).toBeCloseTo(1, 3);
    expect(fadeGains(0.25, "linear")).toEqual([0.25, 0.75]);
    expect(() => fadeCurveWav(0)).toThrow(/above 0 s/);
  });
});

describe("loop and join lengths (the graphs' own math)", () => {
  it("repeats the body as audio-loop-crossfade does, with seams every clip − crossfade", () => {
    // The research run: a 6 s clip with a 1 s crossfade became a 20 s bed with seams at 5, 10 and 15 s.
    expect(loopRepeats(6, 20, 1)).toBe(4);
    expect(loopSeams(6, 20, 1)).toEqual([5, 10, 15]);
    // ACE-Step's 240 s bed looped to a 301 s episode: one seam, 3 s long.
    expect(loopRepeats(240, 301, 3)).toBe(2);
    expect(loopSeams(240, 301, 3)).toEqual([237]);
    expect(loopRepeats(240, 200, 3)).toBe(1);
  });

  it("overlaps every join by the crossfade, and says which clip is too short for it", () => {
    expect(joinedLength([3, 2], 0.5)).toBe(4.5); // the research run: 3 s + 2 s → 4.5 s
    expect(joinedLength([10, 8, 12, 6], 1)).toBe(33);
    expect(joinedLength([7], 1)).toBe(7);
    expect(crossfadeProblem([10, 8, 12], 1, "join")).toBeNull();
    expect(crossfadeProblem([10, 1.5, 12], 1, "join")).toMatch(/^Clip 2 is 1.5 s, too short for a 1 s crossfade \(it needs more than 2 s\)/);
    expect(crossfadeProblem([0.8, 5], 1, "join")).toMatch(/^Clip 1 is 0.8 s/);
    expect(crossfadeProblem([3], 2, "loop")).toMatch(/needs a clip longer than 4 s \(this one is 3 s\)/);
    expect(crossfadeProblem([30], 2, "loop")).toBeNull();
    expect(crossfadeProblem([30], 0, "loop")).toMatch(/longer than 0 s/);
  });

  it("plans cloud loops as whole plays, 2–5 per call, with the least overshoot", () => {
    expect(cloudLoopPasses(30, 100)).toEqual([4]);
    expect(cloudLoopLength(30, [4])).toBe(120);
    expect(cloudLoopPasses(600, 601)).toEqual([2]);
    expect(cloudLoopPasses(10, 600)).toEqual([5, 4, 3]); // exactly 600 s in three calls
    expect(cloudLoopPasses(10, 70)).toEqual([4, 2]); // 7 plays can't be made of 2–5: 8
    expect(cloudLoopPasses(10, 1010)).toEqual([4, 3, 3, 3]); // 108 plays beat 5 × 5 × 5 = 125
    expect(cloudLoopPasses(60, 60)).toEqual([]);
    expect(cloudLoopPasses(60, 61)).toEqual([2]);
    for (const [clip, want] of [[7, 95], [13, 600], [45, 480], [2, 600]] as const) {
      const passes = cloudLoopPasses(clip, want);
      expect(passes.every((p) => p >= 2 && p <= 5), `${clip} → ${want}`).toBe(true);
      expect(cloudLoopLength(clip, passes)).toBeGreaterThanOrEqual(want);
    }
  });
});
