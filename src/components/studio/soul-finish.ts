"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { applyPreset, PRESETS } from "@/lib/grade";
import type { Generation } from "@/lib/catalog/types";
import { cropRect, finishSteps, outputsToFinish, overlayLayout, type FinishSteps } from "@/lib/soul-post";

/**
 * Fuobe Soul's post steps in the browser (research §4.4): when a result with a look arrives, Soul Cinema's 21:9
 * crop, its grade (the WebGL grade of the Color grading tool) and its overlay are applied once, and the finished picture is kept
 * on the server in place of the raw one (the raw one stays as meta.original). Any open studio feed does it, and
 * Cinema's feed and builders (its stills on Soul Cinema, Soul Location's Movie look); the server takes the first and
 * answers the others 409.
 */

const started = new Set<string>();
/** Outputs that failed to finish (no WebGL, a picture that won't load): tried again after a pause, a few times. */
const failed = new Map<string, { tries: number; at: number }>();
const MAX_TRIES = 3;
const GENERATIONS = ["generations"] as const;
const RETRY_MS = 30_000;

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The picture didn't load"));
    img.src = url;
  });
}

const FONTS = { mono: '"Courier New", ui-monospace, monospace', serif: 'Georgia, "Times New Roman", serif' } as const;

/** The finished picture: graded, then its overlay drawn (a print border, a date stamp, a CCTV caption). */
async function finish(url: string, steps: FinishSteps, when: Date): Promise<Blob> {
  const img = await load(url);
  let canvas = document.createElement("canvas");
  // Soul Cinema's 21:9: the middle band of the 16:9 picture.
  const r = steps.crop ? cropRect(img.naturalWidth, img.naturalHeight, steps.crop) : { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight };
  canvas.width = r.width;
  canvas.height = r.height;
  canvas.getContext("2d")!.drawImage(img, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
  const preset = steps.grade ? PRESETS.find((p) => p.id === steps.grade) : undefined;
  if (preset) {
    const { LayerGrader } = await import("@/components/layers/grade-gl");
    const grader = new LayerGrader();
    try {
      canvas = grader.grade(canvas, applyPreset(preset));
    } finally {
      grader.dispose();
    }
  }
  if (steps.overlay) {
    const layout = overlayLayout(steps.overlay, canvas.width, canvas.height, when);
    const out = document.createElement("canvas");
    out.width = layout.width;
    out.height = layout.height;
    const ctx = out.getContext("2d")!;
    if (layout.paper) {
      ctx.fillStyle = layout.paper;
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(canvas, layout.photo.x, layout.photo.y);
    for (const t of layout.texts) {
      ctx.font = `${t.font === "mono" ? "700 " : ""}${t.size}px ${FONTS[t.font]}`;
      ctx.textAlign = t.align;
      ctx.textBaseline = t.baseline;
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.glow ?? "transparent";
      ctx.shadowBlur = t.glow ? Math.max(2, t.size * 0.35) : 0;
      ctx.fillText(t.text, t.x, t.y);
    }
    canvas = out;
  }
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the picture"))), "image/png"));
}

/**
 * Finish every Soul result in `items` that still needs it (once per output, in the background). `queryKey`: the cache
 * that shows them, refetched once the finished picture is kept (Cinema keeps its takes under ["cinema"]).
 */
export function useSoulFinish(items: Generation[], queryKey: readonly unknown[] = GENERATIONS) {
  const qc = useQueryClient();
  const cacheKey = JSON.stringify(queryKey);
  useEffect(() => {
    if (typeof document === "undefined" || document.visibilityState === "hidden") return;
    for (const g of items) {
      for (const i of outputsToFinish(g)) {
        const key = `${g.id}:${i}`;
        if (started.has(key)) continue;
        // A failure is tried again after a pause that doubles, and not after the third: each try loads the full picture.
        const f = failed.get(key);
        if (f && (f.tries >= MAX_TRIES || Date.now() - f.at < RETRY_MS * 2 ** (f.tries - 1))) continue;
        started.add(key);
        const steps = finishSteps(g.outputs[i])!;
        void (async () => {
          try {
            const png = await finish(g.outputs[i].url, steps, new Date(g.createdAt));
            const form = new FormData();
            form.append("file", new File([png], `soul-${g.id}-${i}.png`, { type: "image/png" }));
            form.append("index", String(i));
            const res = await fetch(`/api/generations/${g.id}/finish`, { method: "POST", body: form });
            // The live stream brings the finished row; a feed without it refetches.
            failed.delete(key);
            if (res.ok) void qc.invalidateQueries({ queryKey: JSON.parse(cacheKey) as unknown[] });
          } catch (e) {
            // The raw picture stays; a feed showing it later tries again (after a pause, at most three times).
            started.delete(key);
            failed.set(key, { tries: (f?.tries ?? 0) + 1, at: Date.now() });
            console.warn(`[fuobe] couldn't finish ${g.id}: ${(e as Error).message}`);
          }
        })();
      }
    }
  }, [items, qc, cacheKey]);
}
