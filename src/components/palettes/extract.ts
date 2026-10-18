"use client";

import { extractPalette, samplePixels, suggestName, type RGB } from "@/lib/catalog/palettes";
import type { ExtractRequest, ExtractResult } from "./extract.worker";

/**
 * Extract a palette from up to 20 images in a Web Worker (k-means, src/lib/catalog/palettes.ts).
 * Browsers without module workers or OffscreenCanvas get the same maths on the main thread.
 */

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (r: ExtractResult) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  try {
    worker = new Worker(new URL("./extract.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ExtractResult>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      // A worker that can't start: answer everyone waiting, then fall back to the main thread from now on.
      for (const [id, done] of waiting) done({ id, colors: [], background: null, weights: [], name: "", error: "worker" });
      waiting.clear();
      worker?.terminate();
      worker = null;
      broken = true;
    };
    return worker;
  } catch {
    return null;
  }
}

let broken = false;

async function onMainThread(files: Blob[], count?: number): Promise<Omit<ExtractResult, "id">> {
  const sets: RGB[][] = [];
  for (const f of files) {
    const url = URL.createObjectURL(f);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const w = 160;
      const h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, w, h);
      sets.push(samplePixels(ctx.getImageData(0, 0, w, h).data, 3000));
    } catch {
      // skip undecodable files
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (!sets.length) throw new Error("Couldn't read those images — try JPEG, PNG or WebP");
  const res = extractPalette(sets, { count });
  return { ...res, name: suggestName(res.colors, res.background) };
}

export async function extractFromFiles(files: Blob[], count = 8): Promise<Omit<ExtractResult, "id" | "error">> {
  const w = broken ? null : getWorker();
  if (w) {
    const id = ++seq;
    const res = await new Promise<ExtractResult>((resolve) => {
      waiting.set(id, resolve);
      w.postMessage({ id, files, count } satisfies ExtractRequest);
    });
    if (!res.error) return res;
    if (res.error !== "worker") throw new Error(res.error);
  }
  return onMainThread(files, count);
}
