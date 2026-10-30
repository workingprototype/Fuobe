/**
 * Where a preset card's rendered preview lives (scripts/build-previews.mjs makes it from the masters):
 * a poster still as AVIF in three widths plus a WebP fallback, and a short muted loop, all under
 * public/previews/<kind>/ with the hash of their masters in the name. A new render gets new names,
 * so the files are served as immutable (next.config.ts). Which presets have media, and their hashes,
 * is the manifest src/lib/catalog/preview-media.generated.json, read only by previewFor() in
 * preset-card-data.ts: card data only carries the 8-character hash. Pure module, safe on both sides.
 */

/** Folders under public/previews: the 4:3 preset cards (other surfaces add theirs here). */
export type PreviewKind = "motions" | "effects" | "apps";

/**
 * `{ kind: { preset id: hash } }`, as the build script writes it. A hash with a trailing `s` is a still: the
 * preset has its poster but no clip yet (the build's `--stills` mode, while clips are still rendering).
 */
export type PreviewManifest = Partial<Record<PreviewKind, Record<string, string>>>;

/** Whether a manifest hash is a still (poster only, no clip). */
export function isStill(hash: string): boolean {
  return /^[0-9a-f]{8}s$/.test(hash);
}

const KIND_OF_PREFIX: Record<string, PreviewKind> = { motion: "motions", effect: "effects", app: "apps" };

/** Which folder a preset's media is in, from its id's prefix (the build script uses the same rule). */
export function kindOf(id: string): PreviewKind | undefined {
  const prefix = /^(motion|effect|app)-[a-z0-9-]+$/.exec(id)?.[1];
  return prefix ? KIND_OF_PREFIX[prefix] : undefined;
}

/** The poster comes as AVIF in each of these widths (a srcset), and as WebP in one. */
export const POSTER_WIDTHS = [320, 480, 640] as const;
export const WEBP_WIDTH = 480;

export interface PreviewSources {
  /** For `<source type="image/avif" srcSet>`. */
  avifSrcSet: string;
  /** The poster for browsers without AVIF. */
  webpSrc: string;
  /** The muted loop (480 × 360 H.264, no audio); none for a still. */
  mp4Src?: string;
}

/** The URLs of a preset's media files (the files are named after the 8-digit hash, without a still's `s`). */
export function previewSrc(kind: PreviewKind, id: string, hash: string): PreviewSources {
  const base = `/previews/${kind}/${id}.${hash.slice(0, 8)}`;
  return {
    avifSrcSet: POSTER_WIDTHS.map((w) => `${base}.${w}.avif ${w}w`).join(", "),
    webpSrc: `${base}.${WEBP_WIDTH}.webp`,
    ...(isStill(hash) ? {} : { mp4Src: `${base}.mp4` }),
  };
}

/** A preset's media hash, when the manifest lists it. */
export function mediaHash(manifest: PreviewManifest, id: string): string | undefined {
  const kind = kindOf(id);
  return kind && manifest[kind]?.[id];
}

/** How wide each surface draws a preset card's preview: the poster's `sizes`, for picking from its srcset. */
export const PREVIEW_SIZES = {
  /** PresetGallery: 2, 3, 4 then 5 columns (GALLERY_GRID) in PageShell's 1200 px. */
  gallery: "(min-width: 1280px) 212px, (min-width: 1024px) 165px, (min-width: 640px) 30vw, 46vw",
  /** Home rows: 2, 4 then 6 columns. */
  home: "(min-width: 1024px) 175px, (min-width: 640px) 25vw, 46vw",
  /** PresetHeader: 96 px wide on phones, 128 px from sm up. */
  header: "128px",
} as const;
