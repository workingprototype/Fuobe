/**
 * A minimal WebM writer for one video track of already-encoded frames (WebCodecs VP8 / VP9 chunks): the browser's path
 * render (build plan N7-5) needs every frame it drew, in order, at an exact frame rate, which MediaRecorder doesn't
 * promise (it drops frames it can't keep up with). Matroska / WebM layout as the format specification gives it: an EBML
 * header, then one Segment with Info, Tracks and Clusters of SimpleBlocks (millisecond timecodes). Pure: no DOM.
 */

export interface EncodedFrame {
  data: Uint8Array;
  /** A keyframe (the decoder can start here). */
  key: boolean;
}

export interface WebMTrack {
  /** Matroska codec id: "V_VP8" or "V_VP9". */
  codec: "V_VP8" | "V_VP9";
  width: number;
  height: number;
  fps: number;
}

const enc = new TextEncoder();

/** An EBML variable-length size: the shortest form that holds n (never the all-ones "unknown" value). */
function vsize(n: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 0x80 >> (len - 1);
      return out;
    }
  }
  throw new Error("Element too large for EBML");
}

/** An unsigned integer in as few bytes as it needs (at least one). */
function uint(n: number): Uint8Array {
  const bytes: number[] = [];
  let v = Math.max(0, Math.round(n));
  do {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return Uint8Array.from(bytes);
}

function float64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** An element: its id (as written, class bits included), its size and its body. */
function el(id: number, ...body: Uint8Array[]): Uint8Array {
  const data = concat(body);
  return concat([uint(id), vsize(data.length), data]);
}

const u = (id: number, n: number) => el(id, uint(n));
const s = (id: number, text: string) => el(id, enc.encode(text));

/** Frames that start a new cluster: every keyframe, and at least every 30 s (SimpleBlock times are 16-bit offsets). */
const CLUSTER_MS = 30_000;

/**
 * One WebM file of `frames` in order at `track.fps`: frame i is shown at i / fps seconds (rounded to the millisecond)
 * and lasts 1 / fps (the track's DefaultDuration, in nanoseconds), so a reader counts exactly frames.length frames.
 */
export function muxWebM(track: WebMTrack, frames: readonly EncodedFrame[]): Uint8Array {
  const fps = Math.max(1, track.fps);
  const msOf = (i: number) => Math.round((i * 1000) / fps);
  const header = el(0x1a45dfa3, u(0x4286, 1), u(0x42f7, 1), u(0x42f2, 4), u(0x42f3, 8), s(0x4282, "webm"), u(0x4287, 4), u(0x4285, 2));
  const info = el(0x1549a966, u(0x2ad7b1, 1_000_000), s(0x4d80, "Fuobe"), s(0x5741, "Fuobe"), el(0x4489, float64((frames.length * 1000) / fps)));
  const tracks = el(
    0x1654ae6b,
    el(0xae, u(0xd7, 1), u(0x73c5, 1), u(0x83, 1), u(0x9c, 0), s(0x86, track.codec), u(0x23e383, Math.round(1e9 / fps)), el(0xe0, u(0xb0, track.width), u(0xba, track.height))),
  );
  const clusters: Uint8Array[] = [];
  let blocks: Uint8Array[] = [];
  let start = 0;
  const close = () => {
    if (blocks.length) clusters.push(el(0x1f43b675, u(0xe7, start), ...blocks));
    blocks = [];
  };
  frames.forEach((f, i) => {
    const t = msOf(i);
    if (!blocks.length || (f.key && i > 0) || t - start >= CLUSTER_MS) {
      close();
      start = t;
    }
    const rel = t - start;
    const head = new Uint8Array([0x81, (rel >> 8) & 0xff, rel & 0xff, f.key ? 0x80 : 0x00]);
    blocks.push(el(0xa3, head, f.data));
  });
  close();
  const segment = el(0x18538067, info, tracks, ...clusters);
  return concat([header, segment]);
}
