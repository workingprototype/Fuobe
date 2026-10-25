"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { applyPreset, PRESETS } from "@/lib/grade";
import type { Generation } from "@/lib/catalog/types";
import { finishSteps, outputsToFinish, overlayLayout, type FinishSteps } from "@/lib/soul-post";

/**
 * Fuobe Soul's post steps in the browser (research §4.4): when a result with a look arrives, its grade (the
 * WebGL grade of the Color grading tool) and its overlay are applied once, and the finished picture is kept
 * on the server in place of the raw one (the raw one stays as meta.original). Any open studio feed does it;
 * the server takes the first and answers the others 409.
 */

const started = new Set<string>();

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
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
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

/** Finish every Soul result in `items` that still needs it (once per output, in the background). */
export function useSoulFinish(items: Generation[]) {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof document === "undefined" || document.visibilityState === "hidden") return;
    for (const g of items) {
      for (const i of outputsToFinish(g)) {
        const key = `${g.id}:${i}`;
        if (started.has(key)) continue;
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
            if (res.ok) void qc.invalidateQueries({ queryKey: ["generations"] });
          } catch (e) {
            // The raw picture stays; it is finished next time a feed shows it.
            started.delete(key);
            console.warn(`[fuobe] couldn't finish ${g.id}: ${(e as Error).message}`);
          }
        })();
      }
    }
  }, [items, qc]);
}
