/**
 * A gallery card's data from a full catalog preset, rendered preview media included (the card
 * types and procedural previews are in preset-cards.ts). This is the one module that reads the
 * media manifest, so it's kept apart: whatever client code uses from a module ships in every client
 * chunk that holds it, and preset-cards.ts is in the galleries', home's, shorts' and mixed media's
 * chunks, which only need the hash on each card. Server pages (home, motions, effects, apps) import
 * this; on the client only the preset header does, in its own lazily loaded chunk (studio-page.tsx).
 */
import PREVIEW_MEDIA from "./catalog/preview-media.generated.json";
import type { Preset } from "./catalog/types";
import { clip, lookHue, motionMove, proceduralPreview, type PresetCardData, type PresetPreview } from "./preset-cards";
import { mediaHash, type PreviewManifest } from "./preview-media";

const MEDIA: PreviewManifest = PREVIEW_MEDIA;

/**
 * A preset's card preview: its rendered media when the manifest lists it (just the hash, and a
 * motion's move for its glyph), else the procedural one.
 */
export function previewFor(p: Pick<Preset, "id" | "type" | "name" | "category">): PresetPreview {
  const media = mediaHash(MEDIA, p.id);
  if (!media) return proceduralPreview(p);
  return { media, ...(p.type === "motion" ? { move: motionMove(p) } : {}) };
}

/** What a gallery card needs, and nothing else. */
export function toPresetCard(p: Preset): PresetCardData {
  return {
    id: p.id,
    name: p.name,
    description: clip(p.description, 100),
    category: p.category,
    icon: p.look.icon,
    hue: lookHue(p.look),
    ...(p.badges?.includes("top") ? { top: true as const } : {}),
    cloud: !!p.cloud,
    open: !!p.open,
    preview: previewFor(p),
  };
}
