"use client";

/**
 * Frames of a video, read in the browser: seek a detached <video> to each time and draw it small onto
 * a canvas. Used for trimmer filmstrips, Katana's cut detection and the Virality hook analysis. The
 * video must be same-origin (our /api/files URLs are) or CORS-enabled, or the canvas can't be read.
 */

export interface SampledFrame {
  t: number;
  data: ImageData;
  /** A JPEG data URL, when asked for (filmstrips). */
  url?: string;
}

function once<K extends keyof HTMLMediaElementEventMap>(el: HTMLMediaElement, ev: K, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clear();
      resolve();
    };
    const fail = () => {
      clear();
      reject(new Error("This video can't be read in the browser — try MP4 (H.264) or WebM"));
    };
    const timer = setTimeout(fail, ms);
    const clear = () => {
      clearTimeout(timer);
      el.removeEventListener(ev, done);
      el.removeEventListener("error", fail);
    };
    el.addEventListener(ev, done, { once: true });
    el.addEventListener("error", fail, { once: true });
  });
}

const known = (d: number) => Number.isFinite(d) && d > 0;

/**
 * A clip's real length. MediaRecorder WebM (screen and turntable recordings) has no duration in its
 * header, so the element reports Infinity: seeking far past the end makes the browser scan for the
 * last frame and report the real length, then the clip is rewound. Null when it never tells.
 */
export function realDuration(v: HTMLMediaElement, ms = 8000): Promise<number | null> {
  if (known(v.duration)) return Promise.resolve(v.duration);
  return new Promise((resolve) => {
    const check = () => known(v.duration) && finish(v.duration);
    const finish = (d: number | null) => {
      clearTimeout(timer);
      for (const ev of ["durationchange", "timeupdate", "seeked"] as const) v.removeEventListener(ev, check);
      try {
        v.currentTime = 0;
      } catch {}
      resolve(d);
    };
    const timer = setTimeout(() => finish(null), ms);
    for (const ev of ["durationchange", "timeupdate", "seeked"] as const) v.addEventListener(ev, check);
    try {
      v.currentTime = 1e101;
    } catch {
      finish(null);
    }
  });
}

/** Load a video's metadata in a detached element: its duration (found when the header has none) and size. */
export async function openVideo(src: string): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.src = src;
  if (v.readyState < 1) await once(v, "loadedmetadata");
  if (!known(v.duration) && !(await realDuration(v))) {
    releaseVideo(v);
    throw new Error("This video doesn't say how long it is — try an MP4, or re-save the recording");
  }
  return v;
}

export function releaseVideo(v: HTMLVideoElement) {
  v.removeAttribute("src");
  v.load();
}

/**
 * Sample frames at `times` (seconds), `width` px wide. Stops early when `signal` aborts. Calls
 * `onProgress` with the share done.
 */
export async function sampleFrames(
  src: string | HTMLVideoElement,
  times: number[],
  o: { width?: number; jpeg?: boolean; signal?: AbortSignal; onProgress?: (done: number) => void } = {},
): Promise<SampledFrame[]> {
  const v = typeof src === "string" ? await openVideo(src) : src;
  const width = o.width ?? 64;
  const height = Math.max(1, Math.round((width * (v.videoHeight || 9)) / (v.videoWidth || 16)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const out: SampledFrame[] = [];
  try {
    for (let i = 0; i < times.length; i++) {
      if (o.signal?.aborted) break;
      const t = Math.min(Math.max(0, times[i]), Math.max(0, (v.duration || 0) - 0.05));
      if (Math.abs(v.currentTime - t) > 0.001 || v.readyState < 2) {
        v.currentTime = t;
        await once(v, "seeked");
      }
      ctx.drawImage(v, 0, 0, width, height);
      out.push({ t, data: ctx.getImageData(0, 0, width, height), ...(o.jpeg && { url: canvas.toDataURL("image/jpeg", 0.7) }) });
      o.onProgress?.((i + 1) / times.length);
    }
  } finally {
    if (typeof src === "string") releaseVideo(v);
  }
  return out;
}

/** Evenly spaced times across a clip (centre of each slice). */
export const spacedTimes = (duration: number, count: number) => Array.from({ length: Math.max(1, count) }, (_, i) => ((i + 0.5) * duration) / Math.max(1, count));

/** Mean absolute luma difference between two same-size frames, 0–1. */
export function frameDiff(a: ImageData, b: ImageData): number {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  for (let i = 0; i < n; i += 4) {
    const la = a.data[i] * 0.299 + a.data[i + 1] * 0.587 + a.data[i + 2] * 0.114;
    const lb = b.data[i] * 0.299 + b.data[i + 1] * 0.587 + b.data[i + 2] * 0.114;
    sum += Math.abs(la - lb);
  }
  return sum / (n / 4) / 255;
}
