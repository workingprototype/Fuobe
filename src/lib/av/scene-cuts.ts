/**
 * Finding the edits in a clip the way FFmpeg's scene filter does (`select='gt(scene,0.32)'`, the threshold Akatz Labs'
 * H3 Character Swap tool uses: docs/research/openjutsu-6.md §4.2). FFmpeg scores each frame against the one before:
 * the mean absolute frame difference (MAFD, 0–255 a sample) and how much it jumped from the previous pair's MAFD; the
 * score is the smaller of the two over 100, clipped to 0–1 (libavfilter/f_select.c, get_scene_score). A steady pan
 * has a high MAFD but no jump; a cut has both. Re-implemented here from that description — no FFmpeg code.
 *
 * The browser can't afford to read all 3,592 frames of a 150 s clip, so the studio looks twice: a coarse pass a few
 * frames a second finds the stretches where a cut can be (`coarseWindows`), and a fine pass reads every 24 fps frame
 * of those stretches and keeps the frames whose score is over the threshold (`sceneCuts`). Pure: the sampling lives
 * in src/components/swap-studio, the tests run these on synthetic frames.
 */

/** FFmpeg's scene-change threshold in Akatz Labs' tool. */
export const SCENE_THRESHOLD = 0.32;
/** The coarse pass keeps more than it needs: the fine pass decides at the real threshold. */
export const COARSE_THRESHOLD = 0.18;
/** The studio's frame rate: every clip is worked on at 24 fps (H3's rate). */
export const STUDIO_FPS = 24;

/** RGBA pixels (a canvas's ImageData.data) or any array of 8-bit samples in RGBA order. */
export type Pixels = ArrayLike<number>;

/** Mean absolute difference per colour sample (R, G and B; alpha ignored), 0–255. */
export function mafd(a: Pixels, b: Pixels): number {
  const n = Math.min(a.length, b.length) - (Math.min(a.length, b.length) % 4);
  if (n <= 0) return 0;
  let sad = 0;
  for (let i = 0; i < n; i += 4) sad += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sad / ((n / 4) * 3);
}

/**
 * The scene score of each frame in order, as FFmpeg's select filter computes it: the first frame scores 0, and every
 * other frame min(MAFD, |MAFD − previous MAFD|) / 100, clipped to 0–1 (the previous MAFD starts at 0).
 */
export function sceneScores(frames: Pixels[]): number[] {
  const out: number[] = [];
  let prev = 0;
  frames.forEach((f, i) => {
    if (!i) {
      out.push(0);
      return;
    }
    const m = mafd(frames[i - 1], f);
    const diff = Math.abs(m - prev);
    prev = m;
    out.push(Math.max(0, Math.min(1, Math.min(m, diff) / 100)));
  });
  return out;
}

/**
 * The cut frames among scored frames: each frame whose score is over the threshold starts a new shot. `frames` are the
 * 24 fps frame numbers of the scored frames (FFmpeg's round(pts × 24)); cuts at frame 0 or at/after the clip's end
 * aren't cuts. Sorted, without duplicates.
 */
export function sceneCuts(scores: number[], frames: number[], total: number, threshold = SCENE_THRESHOLD): number[] {
  const out = new Set<number>();
  scores.forEach((s, i) => {
    const f = frames[i];
    if (s > threshold && Number.isInteger(f) && f > 0 && f < total) out.add(f);
  });
  return [...out].sort((a, b) => a - b);
}

/** A clip's frame count at the studio's 24 fps (the normaliser keeps round(seconds × 24) frames). */
export const studioFrames = (seconds: number) => Math.max(1, Math.round(seconds * STUDIO_FPS));

/** The time of a 24 fps frame, in seconds (to the millisecond). */
export const frameTime = (frame: number) => Math.round((frame / STUDIO_FPS) * 1000) / 1000;

/** A time → its 24 fps frame (FFmpeg's round(pts × 24)). */
export const timeFrame = (seconds: number) => Math.round(seconds * STUDIO_FPS);

/** Coarse sample times: about `perSecond` a second, at most `max` over the clip, the first at 0. */
export function coarseTimes(duration: number, perSecond = 6, max = 600): number[] {
  if (!(duration > 0)) return [];
  const rate = Math.min(perSecond, max / duration);
  const n = Math.max(2, Math.floor(duration * rate) + 1);
  return Array.from({ length: n }, (_, i) => Math.min(duration, Math.round(((i * duration) / (n - 1)) * 1000) / 1000));
}

/**
 * The stretches the fine pass has to read: each pair of coarse samples whose score passes the coarse threshold, as
 * 24 fps frame ranges [from, to] that include the frame before (FFmpeg compares each frame with the previous one, and
 * the jump needs the pair before that). Overlapping stretches merge.
 */
export function coarseWindows(times: number[], scores: number[], total: number, threshold = COARSE_THRESHOLD): { from: number; to: number }[] {
  const raw: { from: number; to: number }[] = [];
  scores.forEach((s, i) => {
    if (!i || s <= threshold) return;
    const from = Math.max(0, timeFrame(times[i - 1]) - 2);
    const to = Math.min(total - 1, timeFrame(times[i]) + 1);
    if (to > from) raw.push({ from, to });
  });
  raw.sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  for (const w of raw) {
    const last = out.at(-1);
    if (last && w.from <= last.to + 1) last.to = Math.max(last.to, w.to);
    else out.push({ ...w });
  }
  return out;
}

/** The 24 fps frames a stretch reads, in order. */
export const windowFrames = (w: { from: number; to: number }) => Array.from({ length: w.to - w.from + 1 }, (_, i) => w.from + i);

/**
 * The cuts in one stretch read frame by frame. Its first two scores aren't FFmpeg's: the first frame has nothing
 * before it, and the second has no previous MAFD to jump from (FFmpeg's would be the real pair before). So a stretch
 * starts two frames early (coarseWindows) and only frames from its third on can be cuts — except at the clip's start,
 * where FFmpeg's own history is just as empty.
 */
export function windowCuts(frames: number[], pixels: Pixels[], total: number, threshold = SCENE_THRESHOLD): number[] {
  const scores = sceneScores(pixels);
  const skip = frames[0] === 0 ? 0 : 2;
  return sceneCuts(scores.slice(skip), frames.slice(skip), total, threshold);
}
