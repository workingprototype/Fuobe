import { DUB_LANGUAGES, type DubLanguage } from "./av/languages";
import { FACELESS_STYLE_IDS, STYLES } from "./catalog/faceless";
import { SHORTS_PRESETS, type ShortsPreset } from "./catalog/shorts";

/**
 * How an Assist / MCP studio call's words map onto a studio's own choices: a Shorts preset, a
 * Faceless style, a dub language. Pure (the adapters in src/server/assist/studio-routes.ts use it).
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/colour/g, "color")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The Shorts preset a style names outright ("Claymation", "pencil sketch", "shorts-watercolor"); other words are a look of their own. */
export function shortsPresetFor(style: string): ShortsPreset | undefined {
  const s = norm(style);
  if (!s) return undefined;
  return SHORTS_PRESETS.find((p) => p.id === style.trim().toLowerCase() || norm(p.name) === s);
}

/** Words that point at each Faceless / Explainer style (whole words or phrases, after norm()). */
const STYLE_WORDS: Record<string, string[]> = {
  "editorial-motion-graphics": ["editorial", "motion graphics", "documentary", "infographic", "diagrams", "explainer"],
  "stickman-cartoon": ["stickman", "stick figure", "stick figures", "stick man"],
  "watercolor-chronicle": ["watercolor", "painterly", "aquarelle"],
  "fairy-tale-myth": ["fairy", "fairy tale", "myth", "mythology", "legend", "fable", "fantasy"],
  "paper-diorama": ["diorama", "papercut", "paper cut", "layered paper"],
  "pastel-flat-2d": ["pastel", "flat", "flat 2d", "2d", "flat illustration"],
  "colorful-3d": ["colorful 3d", "toy", "toylike", "3d render", "pixar", "3d"],
  "hand-drawn": ["hand drawn", "handdrawn", "sketch", "sketched", "pencil", "ink", "storybook"],
  "poster-vector": ["poster", "vector"],
  mannequin: ["mannequin", "mannequins"],
  "whiteboard-doodle": ["whiteboard", "doodle", "doodles", "marker"],
  "3d-papercraft": ["papercraft", "folded paper", "origami"],
  "mixed-media": ["mixed media"],
  "low-poly": ["low poly", "lowpoly", "polygonal"],
  "2d-illustrator": ["2d illustration", "illustrator", "illustration"],
  "pixel-art": ["pixel", "pixel art", "8 bit", "16 bit"],
  claymotion: ["clay", "claymation", "claymotion", "plasticine", "stop motion"],
  "isometric-flat-vector": ["isometric"],
  "3d-mix": ["3d mix"],
  "studio-3d": ["studio 3d", "studio lit", "clean 3d"],
  "fluffy-toy": ["plush", "fluffy", "felt", "stuffed"],
  "paper-collage": ["collage", "torn paper", "cutout", "cut out"],
};

/**
 * The Faceless style a description points at: an exact style id or name, else the style with the most
 * matching words (ties: the longest matching phrase, then Faceless Studio's own 12 before the
 * Explainer's). Null when nothing matches — the words describe a look the studio doesn't have.
 */
export function facelessStyleFor(style: string): string | null {
  const raw = style.trim().toLowerCase();
  const s = ` ${norm(style)} `;
  const exact = STYLES.find((x) => x.id === raw || ` ${norm(x.name)} ` === s);
  if (exact) return exact.id;
  let best: { id: string; hits: number; longest: number; own: boolean } | null = null;
  for (const x of STYLES) {
    const hits = (STYLE_WORDS[x.id] ?? []).filter((w) => s.includes(` ${w} `));
    if (!hits.length) continue;
    const cand = { id: x.id, hits: hits.length, longest: Math.max(...hits.map((w) => w.length)), own: FACELESS_STYLE_IDS.includes(x.id) };
    if (!best || cand.hits > best.hits || (cand.hits === best.hits && (cand.longest > best.longest || (cand.longest === best.longest && cand.own && !best.own)))) best = cand;
  }
  return best?.id ?? null;
}

/** Other names people use for a language Translate & dub lists. */
const LANGUAGE_ALIASES: Record<string, string> = { mandarin: "zh", "mandarin chinese": "zh", castilian: "es", "brazilian portuguese": "pt", tagalog: "fil", bokmal: "no", "bokmål": "no" };

/** The dub language a name or code means ("Spanish", "es", "spanish (mexico)", "Mandarin"), if Translate & dub has it. */
export function dubLanguageFor(name: string): DubLanguage | undefined {
  const s = name.trim().toLowerCase();
  const base = s.replace(/\s*\(.*\)\s*$/, "").trim();
  const code = LANGUAGE_ALIASES[s] ?? LANGUAGE_ALIASES[base];
  return DUB_LANGUAGES.find((l) => l.code === code || l.code === s || l.code === base || l.name.toLowerCase() === s || l.name.toLowerCase() === base);
}
