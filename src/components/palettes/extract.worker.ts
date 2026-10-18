/**
 * Palette extraction off the main thread: decode each picked image at ~160 px, sample its pixels and
 * run k-means over all of them (src/lib/catalog/palettes.ts). Nothing leaves the browser.
 */
import { extractPalette, samplePixels, suggestName, type RGB } from "@/lib/catalog/palettes";

export interface ExtractRequest {
  id: number;
  files: Blob[];
  count?: number;
}

export interface ExtractResult {
  id: number;
  colors: string[];
  background: string | null;
  weights: number[];
  name: string;
  error?: string;
}

async function pixelsOf(file: Blob): Promise<RGB[]> {
  const bmp = await createImageBitmap(file, { resizeWidth: 160, resizeQuality: "medium" });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas in this worker");
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return samplePixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, 3000);
}

const post = (m: ExtractResult) => (self as unknown as { postMessage: (m: ExtractResult) => void }).postMessage(m);

self.onmessage = async (e: MessageEvent<ExtractRequest>) => {
  const { id, files, count } = e.data;
  try {
    const sets: RGB[][] = [];
    for (const f of files) {
      try {
        sets.push(await pixelsOf(f));
      } catch {
        // An image the browser can't decode is skipped; the others still count.
      }
    }
    if (!sets.length) throw new Error("Couldn't read those images — try JPEG, PNG or WebP");
    const res = extractPalette(sets, { count });
    post({ id, ...res, name: suggestName(res.colors, res.background) });
  } catch (err) {
    post({ id, colors: [], background: null, weights: [], name: "", error: (err as Error).message });
  }
};
