import { getModel } from "@/lib/catalog";
import { estimateCost } from "@/lib/catalog/plan";
import { formatCost } from "@/lib/format";
import { IMAGE_STUDIO, VIDEO_STUDIO } from "@/lib/studios";

/**
 * What a first image and a first clip cost on the default paid models, for the first-run guide
 * ("Nano Banana Pro ≈ $0.15 an image · Seedance 2.5 ≈ $0.60 a 5 s clip"). Server side: it reads
 * the catalog, which stays out of the browser. Empty when no price is known.
 */
export function starterPriceLine(): string {
  const quote = (id: string, what: (d?: number) => string) => {
    const m = getModel(id);
    const usd = m ? estimateCost(m, { ...m.defaults }) : null;
    return m && usd ? `${m.name} ≈ ${formatCost(usd)} ${what(m.defaults?.duration)}` : "";
  };
  return [quote(IMAGE_STUDIO.defaultModels.cloud, () => "an image"), quote(VIDEO_STUDIO.defaultModels.cloud, (d) => (d ? `a ${d} s clip` : "a clip"))].filter(Boolean).join(" · ");
}
