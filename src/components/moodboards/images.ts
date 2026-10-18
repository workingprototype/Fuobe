"use client";

import { samplePixels, type RGB } from "@/lib/catalog/palettes";
import { collageGroups, coverCrop } from "./logic";

/** Load an image (object URL or same-origin /api/files URL) fully decoded. */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

/** A small pixel sample of an image (for its colour signature). */
export function pixelsOf(img: HTMLImageElement, size = 64): RGB[] {
  const w = size;
  const h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * size));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  return samplePixels(ctx.getImageData(0, 0, w, h).data, 2000);
}

/** Up to two 2×2 collages (1024 px JPEGs) from the board's images, most representative first. */
export async function renderCollages(srcs: string[], size = 1024): Promise<Blob[]> {
  const out: Blob[] = [];
  for (const group of collageGroups(srcs)) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) break;
    const cell = size / 2;
    for (const [i, src] of group.entries()) {
      try {
        const img = await loadImage(src);
        const { sx, sy, sw, sh } = coverCrop(img.naturalWidth, img.naturalHeight, cell, cell);
        ctx.drawImage(img, sx, sy, sw, sh, (i % 2) * cell, Math.floor(i / 2) * cell, cell, cell);
      } catch {
        // A cell that won't load stays blank.
      }
    }
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
    if (blob) out.push(blob);
  }
  return out;
}
