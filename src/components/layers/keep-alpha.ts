"use client";

import { useEffect, useState } from "react";
import type { LayerNode } from "@/lib/layers";
import { hasSeeThrough } from "./render";

/**
 * “Keep transparency” for a run on a layer: on when the layer's own pixels are see-through (a cut-out,
 * a decomposition's layer), off for full-frame pictures. Whole-image Inpaint and Enhancer results land
 * on top as opaque layers; a cut-out there would only strip their background (and bill for it). The
 * switch wins once flipped, for that layer's picture.
 */
export function useKeepAlpha(node?: LayerNode): [boolean, (on: boolean) => void] {
  const src = node?.src;
  const crop = node?.crop;
  const natural = node?.natural;
  const key = node ? `${node.id}|${node.src}|${node.crop?.join(",") ?? ""}` : "";
  const [measured, setMeasured] = useState<{ key: string; clear: boolean } | null>(null);
  const [picked, setPicked] = useState<{ key: string; on: boolean } | null>(null);
  useEffect(() => {
    if (!src) return;
    let gone = false;
    hasSeeThrough({ src, crop: crop ?? null, natural }).then(
      (clear) => {
        if (!gone) setMeasured({ key, clear });
      },
      () => {
        // Unknown (the picture didn't load): stays off.
      },
    );
    return () => {
      gone = true;
    };
  }, [key, src, crop, natural]);
  const on = !!node && (picked?.key === key ? picked.on : measured?.key === key && measured.clear);
  return [on, (v) => setPicked({ key, on: v })];
}
