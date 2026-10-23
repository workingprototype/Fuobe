/**
 * Crossfades for audio loops and joins (docs/research/comfyui-oss-4.md §e). Core ComfyUI has no gain-ramp
 * node, so the provider writes the fade as a tiny WAV that the audio-loop-crossfade and audio-join-crossfade
 * graphs multiply the music with: stereo, exactly `crossfade` seconds long, left channel = the fade-in, right
 * channel = the fade-out, at 8 kHz (AudioMerge resamples the curve up to the music's rate, never the music
 * down). The length math mirrors the graphs, so a planner knows what a job will make before it runs.
 *
 * The cloud has no crossfade: fal's merge-audios plays whole copies one after another (2–5 per call), so a
 * long loop runs as a chain of calls (cloudLoopPasses) and comes out a little longer than asked.
 */

export const CURVE_RATE = 8000;

/** Equal power keeps unrelated material at one loudness through a seam; linear avoids the +3 dB bump on near-identical material. */
export type CurveShape = "equal-power" | "linear";

/** The fade-in and fade-out gains at t (0 = the seam starts, 1 = it ends). */
export function fadeGains(t: number, shape: CurveShape = "equal-power"): [fadeIn: number, fadeOut: number] {
  const x = Math.max(0, Math.min(1, t));
  return shape === "linear" ? [x, 1 - x] : [Math.sin((Math.PI / 2) * x), Math.cos((Math.PI / 2) * x)];
}

/**
 * The crossfade curve as a 16-bit stereo PCM WAV, exactly `seconds` long: left = the fade-in from 0 to 1,
 * right = the fade-out from 1 to 0. The first and last samples are exact, so the music around a seam joins it
 * at full level.
 */
export function fadeCurveWav(seconds: number, shape: CurveShape = "equal-power", rate = CURVE_RATE): Uint8Array {
  if (!(seconds > 0)) throw new Error("A crossfade needs a length above 0 s");
  const n = Math.max(2, Math.round(seconds * rate));
  const bytes = new Uint8Array(44 + n * 4);
  const v = new DataView(bytes.buffer);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 4, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    const [fadeIn, fadeOut] = fadeGains(i / (n - 1), shape);
    v.setInt16(44 + i * 4, Math.round(fadeIn * 32767), true);
    v.setInt16(46 + i * 4, Math.round(fadeOut * 32767), true);
  }
  return bytes;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** How many times the loop graph appends the clip's body and seam: ceil((duration − X) / (clip − X)), at least 1. */
export function loopRepeats(clip: number, duration: number, crossfade: number): number {
  return Math.max(1, Math.ceil((duration - crossfade) / (clip - crossfade)));
}

/** Where the seams of a crossfaded loop start (each is `crossfade` seconds long), up to the bed's length. */
export function loopSeams(clip: number, duration: number, crossfade: number): number[] {
  const step = clip - crossfade;
  const out: number[] = [];
  for (let t = step; t < duration - crossfade; t += step) out.push(round3(t));
  return out;
}

/** Clips joined with a crossfade at each seam: every seam overlaps the two clips by `crossfade` seconds. */
export const joinedLength = (lengths: number[], crossfade: number): number => round3(lengths.reduce((a, b) => a + b, 0) - Math.max(0, lengths.length - 1) * crossfade);

/** What stops a crossfade on these clips (null when it can run): a loop needs a clip longer than two crossfades; a join, middle clips that long and end clips longer than one. */
export function crossfadeProblem(lengths: number[], crossfade: number, mode: "loop" | "join"): string | null {
  if (!(crossfade > 0)) return "The crossfade needs to be longer than 0 s";
  const s = (n: number) => `${round3(n)} s`;
  if (mode === "loop") {
    const [clip] = lengths;
    return clip !== undefined && clip <= 2 * crossfade ? `A ${s(crossfade)} crossfade needs a clip longer than ${s(2 * crossfade)} (this one is ${s(clip)}) — shorten the crossfade` : null;
  }
  const i = lengths.findIndex((l, k) => l <= (k === 0 || k === lengths.length - 1 ? crossfade : 2 * crossfade));
  if (i < 0) return null;
  const need = i === 0 || i === lengths.length - 1 ? crossfade : 2 * crossfade;
  return `Clip ${i + 1} is ${s(lengths[i])}, too short for a ${s(crossfade)} crossfade (it needs more than ${s(need)}) — shorten the crossfade`;
}

/**
 * Whole plays for a cloud loop (fal merge-audios lists the clip 2–`maxPlays` times per call; each call's
 * result is the next one's clip): the fewest plays that reach `duration`, made of passes of at most
 * `maxPlays`, then the fewest passes. 60 plays → [5, 4, 3]; 7 plays (prime) → [4, 2] = 8. Empty when one play
 * is already long enough.
 */
export function cloudLoopPasses(clip: number, duration: number, maxPlays = 5): number[] {
  if (!(clip > 0) || duration <= clip) return [];
  const need = Math.ceil(duration / clip - 1e-9);
  // Plays per pass multiply: the smallest product ≥ need, made of factors 2..maxPlays (largest first).
  const best = { plays: [] as number[], product: Infinity };
  const walk = (left: number, product: number, picked: number[]) => {
    if (product >= need) {
      if (product < best.product || (product === best.product && picked.length < best.plays.length)) Object.assign(best, { plays: [...picked], product });
      return;
    }
    if (!left || product * maxPlays ** left < need) return;
    for (let f = maxPlays; f >= 2; f--) if (!picked.length || f <= picked[picked.length - 1]) walk(left - 1, product * f, [...picked, f]);
  };
  for (let passes = 1; passes <= 8 && !best.plays.length; passes++) walk(passes, 1, []);
  // One pass more can cut the overshoot (101 plays: 5 × 5 × 5 = 125 at three passes, 4 × 3 × 3 × 3 = 108 at four).
  if (best.plays.length) walk(best.plays.length + 1, 1, []);
  return best.plays;
}

/** How long a chain of cloud loop passes comes out: the clip times every pass's plays. */
export const cloudLoopLength = (clip: number, passes: number[]): number => round3(passes.reduce((n, p) => n * p, clip));
