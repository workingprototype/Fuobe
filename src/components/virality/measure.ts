"use client";

import { frameDiff, openVideo, releaseVideo, sampleFrames } from "@/components/av/frame-sampler";
import { probeMedia } from "@/lib/media-probe";
import { HOOK_SECONDS, hookTimes, LOUDNESS_STEP, loudnessSeries, lumaStats, MAX_AUDIO_BYTES, type AudioMeasure, type HookInput } from "@/lib/av/virality";

/**
 * Measure a video's hook in the browser: frames across the first 3 seconds (movement, the opening
 * frame's contrast), faces and text where the browser has a detector (Chrome's Shape Detection API),
 * and loudness from the decoded audio track. Nothing leaves the browser.
 */
export interface HookMeasure {
  input: HookInput;
  /** Small frames across the hook, for the timeline. */
  strip: { t: number; url: string }[];
  /** The first frame at up to 1280 px, for the Hook Frame app. */
  opening: string | null;
}

type Detector = { detect(src: ImageData): Promise<unknown[]> };

function detector(name: "FaceDetector" | "TextDetector"): Detector | null {
  const C = (globalThis as unknown as Record<string, (new (o?: object) => Detector) | undefined>)[name];
  if (typeof C !== "function") return null;
  try {
    return new C(name === "FaceDetector" ? { fastMode: true, maxDetectedFaces: 5 } : undefined);
  } catch {
    return null;
  }
}

/** Run a detector on each frame; null when the browser has none or it refuses to run here. */
async function detectAll<T>(d: Detector | null, frames: { t: number; data: ImageData }[], read: (found: unknown[]) => T): Promise<({ t: number } & T)[] | null> {
  if (!d) return null;
  const out: ({ t: number } & T)[] = [];
  for (const f of frames) {
    try {
      out.push({ t: f.t, ...read(await d.detect(f.data)) });
    } catch {
      // Some platforms expose the class but can't run it (NotSupportedError): not measured.
      return null;
    }
  }
  return out;
}

function mono(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buffer.numberOfChannels;
  }
  return out;
}

async function measureLoudness(src: string, signal?: AbortSignal): Promise<AudioMeasure> {
  try {
    const res = await fetch(src, { signal });
    if (!res.ok) return { error: "unreadable" };
    if (Number(res.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) {
      void res.body?.cancel();
      return { error: "too-large" };
    }
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_AUDIO_BYTES) return { error: "too-large" };
    // MP4/MOV say whether they carry sound; WebM and others are only known by trying to decode.
    const info = probeMedia(new Uint8Array(bytes));
    if (info?.hasVideo && !info.hasAudio) return { error: "no-audio" };
    const ctx = new OfflineAudioContext(1, 1, 16000);
    const audio = await ctx.decodeAudioData(bytes);
    return { step: LOUDNESS_STEP, db: loudnessSeries(mono(audio), audio.sampleRate, LOUDNESS_STEP) };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { error: "unreadable" };
  }
}

export async function measureHook(src: string, o: { signal?: AbortSignal; onProgress?: (share: number, stage: string) => void } = {}): Promise<HookMeasure> {
  const step = (share: number, stage: string) => o.onProgress?.(share, stage);
  step(0, "Opening the video");
  const v = await openVideo(src);
  try {
    const duration = v.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("This video has no length the browser can read");
    const times = hookTimes(duration);
    step(0.05, "Reading the first 3 seconds");
    const frames = await sampleFrames(v, times, { width: 120, jpeg: true, signal: o.signal, onProgress: (d) => step(0.05 + d * 0.5, "Reading the first 3 seconds") });
    if (o.signal?.aborted) throw new DOMException("Stopped", "AbortError");
    const motion = frames.map((f, i) => ({ t: f.t, diff: i ? frameDiff(frames[i - 1].data, f.data) : 0 }));
    // Larger frames for the detectors and the opening frame: 0, 1 and 2 s.
    step(0.6, "Looking for faces and text");
    const checkTimes = [0, 1, 2].filter((t) => t < Math.min(HOOK_SECONDS, duration));
    const width = Math.min(1280, v.videoWidth || 1280);
    const big = await sampleFrames(v, checkTimes, { width, jpeg: true, signal: o.signal });
    if (o.signal?.aborted) throw new DOMException("Stopped", "AbortError");
    const faces = await detectAll(detector("FaceDetector"), big, (found) => ({ count: found.length }));
    const text = await detectAll(detector("TextDetector"), big, (found) => ({ chars: found.reduce<number>((n, b) => n + String((b as { rawValue?: string }).rawValue ?? "").trim().length, 0) }));
    step(0.8, "Measuring the sound");
    const loudness = await measureLoudness(src, o.signal);
    step(1, "Done");
    return {
      input: { duration, width: v.videoWidth, height: v.videoHeight, motion, opening: lumaStats(frames[0].data), faces, text, loudness },
      strip: frames.filter((_, i) => i % 2 === 0).map((f) => ({ t: f.t, url: f.url! })),
      opening: big[0]?.url ?? null,
    };
  } finally {
    releaseVideo(v);
  }
}
