import { getModel } from "@/lib/catalog";
import { estimateCost } from "@/lib/catalog/plan";
import { formatCost } from "@/lib/format";
import { EDIT_STUDIO, IMAGE_STUDIO, VIDEO_STUDIO } from "@/lib/studios";

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

/** What Home's Start runs in a mode: the studio's default model on each engine, and what one run costs on the paid one. */
export interface StartQuote {
  cloud: { name: string; price: string } | null;
  open: { name: string } | null;
}

/** Home's Start quotes, by mode (image, video, edit), so the price is known before a paid run starts. */
export function startQuotes(): Record<"image" | "video" | "edit", StartQuote> {
  const quote = (d: { cloud: string; open: string }, what: (duration?: number) => string): StartQuote => {
    const cloud = getModel(d.cloud);
    const open = getModel(d.open);
    const usd = cloud ? estimateCost(cloud, { ...cloud.defaults }) : null;
    return {
      cloud: cloud ? { name: cloud.name, price: usd ? `about ${formatCost(usd)} ${what(cloud.defaults?.duration)}` : "priced by the provider" } : null,
      open: open ? { name: open.name } : null,
    };
  };
  return {
    image: quote(IMAGE_STUDIO.defaultModels, () => "an image"),
    video: quote(VIDEO_STUDIO.defaultModels, (d) => (d ? `a ${d} s clip` : "a clip")),
    edit: quote(EDIT_STUDIO.defaultModels, () => "an edit"),
  };
}
