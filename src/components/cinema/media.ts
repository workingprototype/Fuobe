"use client";

import { uploadFile } from "@/lib/api";
import { lineStats, tileRects } from "./grid-math";

/** Browser-side media helpers: durations, a take's first frame, cutting a grid sheet into tiles. */

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));

/** Seconds of a video or audio file (NaN when the browser can't read it). */
export function mediaDuration(url: string, kind: "video" | "audio"): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const done = (v: number) => {
      el.removeAttribute("src");
      resolve(v);
    };
    const timer = setTimeout(() => done(NaN), 8000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(el.duration) ? el.duration : NaN);
    };
    el.onerror = () => {
      clearTimeout(timer);
      done(NaN);
    };
    el.src = url;
  });
}

/**
 * The first frame of a video, uploaded as a PNG (prequels end on it; open-source edits restyle it).
 * Null when the browser can't decode the clip (the server then extracts it with fal's FFmpeg).
 */
export async function firstFrame(url: string): Promise<string | null> {
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 8000);
      video.onloadeddata = () => {
        video.currentTime = 0.04;
      };
      video.onseeked = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error("decode"));
      };
    });
    video.src = url;
    await ready;
    if (!video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const blob = await toBlob(canvas);
    if (!blob) return null;
    return (await uploadFile(new File([blob], "first-frame.png", { type: "image/png" }))).url;
  } catch {
    return null;
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

/** Cut a contact sheet into rows × cols tiles (gutters detected, else an equal split) and upload each. */
export async function cutGrid(url: string, rows: number, cols: number): Promise<{ url: string; row: number; col: number }[]> {
  const img = await loadImage(url);
  const width = img.naturalWidth || 1024;
  const height = img.naturalHeight || 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const { rects } = tileRects(width, height, rows, cols, { x: lineStats(data, width, height, "x"), y: lineStats(data, width, height, "y") });
  const out: { url: string; row: number; col: number }[] = [];
  for (const r of rects) {
    const tile = document.createElement("canvas");
    tile.width = Math.max(1, r.w);
    tile.height = Math.max(1, r.h);
    tile.getContext("2d")!.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const blob = await toBlob(tile);
    if (!blob) throw new Error("Couldn't cut the sheet");
    const asset = await uploadFile(new File([blob], `tile-${r.row + 1}-${r.col + 1}.png`, { type: "image/png" }));
    out.push({ url: asset.url, row: r.row, col: r.col });
  }
  return out;
}
