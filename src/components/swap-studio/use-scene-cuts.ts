"use client";

import { useCallback, useRef, useState } from "react";
import { openVideo, releaseVideo, sampleFrames } from "@/components/av/frame-sampler";
import { COARSE_WIDTH, coarseTimes, coarseWindows, fineWidth, sceneScores, STUDIO_FPS, windowChunks, windowCuts, windowFrames } from "@/lib/av/scene-cuts";

/**
 * "Detect edits": FFmpeg's scene score at Akatz Labs' 0.32, read in the browser (src/lib/av/scene-cuts.ts). A coarse
 * pass a few frames a second (small frames, a lower threshold) finds where a cut can be; a fine pass reads every
 * 24 fps frame there at the clip's own size (up to 1280 px wide: a smaller picture scores cuts lower than FFmpeg).
 */
export function useSceneCuts() {
  const [state, setState] = useState<{ busy: boolean; progress: number; error: string | null }>({ busy: false, progress: 0, error: null });
  const stop = useRef<AbortController | null>(null);

  const detect = useCallback(async (src: string, total: number): Promise<number[] | null> => {
    stop.current?.abort();
    const ctrl = new AbortController();
    stop.current = ctrl;
    setState({ busy: true, progress: 0, error: null });
    let v: HTMLVideoElement | null = null;
    try {
      v = await openVideo(src);
      const duration = v.duration;
      const times = coarseTimes(duration);
      const coarse = await sampleFrames(v, times, { width: COARSE_WIDTH, signal: ctrl.signal, onProgress: (p) => setState((s) => ({ ...s, progress: p * 0.6 })) });
      if (ctrl.signal.aborted) return null;
      const windows = coarseWindows(
        coarse.map((f) => f.t),
        sceneScores(coarse.map((f) => f.data.data)),
        total,
      );
      const cuts = new Set<number>();
      const width = fineWidth(v.videoWidth);
      for (const [i, w] of windows.entries()) {
        for (const piece of windowChunks(w)) {
          const frames = windowFrames(piece);
          // The middle of each 24 fps frame: whichever frame of the clip shows then.
          const fine = await sampleFrames(
            v,
            frames.map((f) => Math.min(duration - 0.01, (f + 0.5) / STUDIO_FPS)),
            { width, signal: ctrl.signal },
          );
          if (ctrl.signal.aborted) return null;
          for (const c of windowCuts(frames, fine.map((f) => f.data.data), total)) cuts.add(c);
        }
        setState((s) => ({ ...s, progress: 0.6 + (0.4 * (i + 1)) / windows.length }));
      }
      setState({ busy: false, progress: 1, error: null });
      return [...cuts].sort((a, b) => a - b);
    } catch (e) {
      if (!ctrl.signal.aborted) setState({ busy: false, progress: 0, error: (e as Error).message || "Couldn't read this clip's frames — add the cuts by hand" });
      return null;
    } finally {
      if (v) releaseVideo(v);
    }
  }, []);

  const cancel = useCallback(() => {
    stop.current?.abort();
    setState({ busy: false, progress: 0, error: null });
  }, []);

  return { ...state, detect, cancel };
}
