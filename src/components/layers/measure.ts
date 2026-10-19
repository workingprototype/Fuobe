"use client";

import type { LayerJob } from "@/lib/layers";
import { imagesToMeasure, type MeasuredImage, type MeasuredJob } from "./apply";
import { alphaBox, loadImage, sizeOf } from "./render";

/** Load a finished job's images and measure them (sizes, alpha boxes) for {@link applyMeasured}. */
export async function measureJob(job: LayerJob): Promise<MeasuredJob> {
  const byUrl = new Map((job.result?.outputs ?? []).map((o) => [o.url, o]));
  const outputs = await Promise.all(
    imagesToMeasure(job).map(async ({ url, alpha }): Promise<MeasuredImage> => {
      const img = await loadImage(url);
      return { url, meta: byUrl.get(url)?.meta, natural: sizeOf(img), ...(alpha ? { alpha: alphaBox(img) } : {}) };
    }),
  );
  let original: MeasuredImage | null | undefined;
  if (job.tool === "regional" && typeof job.settings?.image === "string") {
    const url = job.settings.image;
    original = await loadImage(url).then(
      (img) => ({ url, natural: sizeOf(img) }),
      () => null,
    );
  }
  return { outputs, ...(original !== undefined ? { original } : {}) };
}
