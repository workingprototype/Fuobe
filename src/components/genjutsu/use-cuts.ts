"use client";

import { useEffect, useState } from "react";
import { frameDiff, openVideo, releaseVideo, sampleFrames } from "@/components/av/frame-sampler";
import { detectCuts } from "@/lib/av/katana";

/**
 * The hard cuts in a clip, found in the browser (Katana's frame-difference pass: about 6 samples a second at 48 px,
 * at most 180 over the clip). Character swap warns when its part has one: H3 swaps one continuous shot. Null while
 * it reads (or when the browser can't read the clip's frames).
 */
export function useClipCuts(src: string | undefined, enabled: boolean): number[] | null {
  const [found, setFound] = useState<{ src: string; cuts: number[] } | null>(null);
  useEffect(() => {
    if (!enabled || !src || found?.src === src) return;
    const stop = new AbortController();
    void (async () => {
      let v: HTMLVideoElement | null = null;
      try {
        v = await openVideo(src);
        const duration = v.duration || 0;
        const fps = Math.min(6, 180 / Math.max(1, duration));
        const times = Array.from({ length: Math.max(2, Math.floor(duration * fps)) }, (_, i) => i / fps);
        const frames = await sampleFrames(v, times, { width: 48, signal: stop.signal });
        if (stop.signal.aborted) return;
        const diffs = frames.slice(1).map((f, i) => frameDiff(frames[i].data, f.data));
        setFound({ src, cuts: detectCuts(diffs, frames.map((f) => f.t)) });
      } catch {
        // The browser can't read this clip's frames: no warning rather than a wrong one.
      } finally {
        if (v) releaseVideo(v);
      }
    })();
    return () => stop.abort();
  }, [src, enabled, found?.src]);
  return found && found.src === src ? found.cuts : null;
}
