import { toSrt, type Cue } from "@/lib/cues";
import type { Engine, GenerationRequest } from "@/lib/catalog/types";

/**
 * Caption styles and how each burner takes them. The edited cue list is burned as-is: on the open
 * engine by ComfyUI's caption burn-in (core TextOverlay, cues in params.extra.cues), on the cloud by
 * VEED Subtitles from SRT text (srt_content skips its own transcription). Auto Subtitle is the
 * "quick" route: it transcribes and burns in one call (word-by-word karaoke), without your edits.
 */
export const CAPTIONS_FEATURE = "captions";

export type CaptionSize = "S" | "M" | "L";
export type CaptionPosition = "top" | "center" | "bottom";

export interface CaptionStyle {
  id: string;
  name: string;
  /** Google font the cloud burners render with (and the preview uses where loaded). */
  font: string;
  weight: 400 | 700 | 900;
  /** Text colour (hex). */
  color: string;
  /** Word-by-word: a few words at a time (open), the spoken word highlighted (cloud dynamic styles / Auto Subtitle). */
  karaoke: boolean;
  /** Highlight colour for karaoke (hex). */
  highlight?: string;
  /** A dark box behind the text instead of an outline. */
  box?: boolean;
  /** VEED's own preset this style starts from. */
  veed: string;
  /** Uppercase text (bold social styles). */
  upper?: boolean;
}

export const CAPTION_STYLES: CaptionStyle[] = [
  { id: "clean", name: "Clean", font: "Inter", weight: 700, color: "#ffffff", karaoke: false, veed: "simple" },
  { id: "bold", name: "Bold pop", font: "Montserrat", weight: 900, color: "#ffd400", karaoke: false, veed: "beans", upper: true },
  { id: "karaoke", name: "Karaoke", font: "Montserrat", weight: 900, color: "#ffffff", karaoke: true, highlight: "#8b5cf6", veed: "glide", upper: true },
  { id: "boxed", name: "Boxed", font: "Inter", weight: 700, color: "#ffffff", karaoke: false, box: true, veed: "backdrop" },
  { id: "subtle", name: "Subtle", font: "Inter", weight: 400, color: "#f5f5f5", karaoke: false, veed: "plain" },
  { id: "neon", name: "Neon", font: "Poppins", weight: 700, color: "#00e5ff", karaoke: true, highlight: "#ffffff", veed: "fusion" },
];

export const styleById = (id: string | undefined) => CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0];

export interface CaptionLook {
  style: string;
  size: CaptionSize;
  position: CaptionPosition;
  /** Overrides the style's colour. */
  color?: string;
}

/** The open burner's text size: % of the frame height. */
export const OPEN_FONT_SIZE: Record<CaptionSize, number> = { S: 4.5, M: 6, L: 8 };
/** Auto Subtitle's font size (px at its render size). */
const AUTO_FONT_SIZE: Record<CaptionSize, number> = { S: 60, M: 90, L: 120 };

/** Auto Subtitle's colour names: the nearest one to a hex colour. */
const NAMED: [string, [number, number, number]][] = [
  ["white", [255, 255, 255]],
  ["black", [0, 0, 0]],
  ["red", [230, 40, 40]],
  ["green", [40, 200, 80]],
  ["blue", [40, 90, 230]],
  ["yellow", [255, 212, 0]],
  ["orange", [255, 140, 0]],
  ["purple", [139, 92, 246]],
  ["pink", [244, 114, 182]],
  ["brown", [140, 90, 40]],
  ["gray", [128, 128, 128]],
  ["cyan", [0, 229, 255]],
  ["magenta", [230, 0, 230]],
];

export function nearestColorName(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "white";
  const n = parseInt(m[1], 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = NAMED[0];
  let bestD = Infinity;
  for (const c of NAMED) {
    const d = c[1].reduce((acc, v, i) => acc + (v - rgb[i]) ** 2, 0);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best[0];
}

export type BurnRoute = "open" | "veed" | "auto";

export const BURN_MODELS: Record<BurnRoute, string> = { open: "oss-captions-burnin", veed: "veed-subtitles", auto: "auto-subtitle" };

/** Which burner a route uses on an engine ("auto" is cloud only, "open" is the open engine's). */
export const burnRouteFor = (engine: Engine, quick: boolean): BurnRoute => (engine === "open" ? "open" : quick ? "auto" : "veed");

/** Whether a route burns your edited lines (Auto Subtitle transcribes again by itself). */
export const usesCues = (route: BurnRoute) => route !== "auto";

const upper = (cues: Cue[], on?: boolean) => (on ? cues.map((c) => ({ ...c, text: c.text.toUpperCase() })) : cues);

/** The burn job for a style: the model, its settings (params.extra) and the cues it takes. */
export function burnRequest(o: { route: BurnRoute; video: string; cues: Cue[]; look: CaptionLook; sourceLanguage?: string }): GenerationRequest {
  const style = styleById(o.look.style);
  const color = o.look.color ?? style.color;
  const cues = upper(o.cues.filter((c) => c.text.trim()), style.upper);
  const base = { feature: CAPTIONS_FEATURE, modelId: BURN_MODELS[o.route], op: "captions" as const, inputs: { video: o.video } };
  if (o.route === "open") {
    if (!cues.length) throw new Error("There are no lines to burn in");
    return {
      ...base,
      params: {
        extra: {
          cues: cues.map((c) => ({ start: c.start, end: c.end, text: c.text.trim() })),
          fontSize: OPEN_FONT_SIZE[o.look.size],
          fontColor: color,
          // The open burner places text at the top or the bottom.
          captionPosition: o.look.position === "top" ? "top" : "bottom",
          wordsPerCaption: style.karaoke ? 3 : 0,
        },
      },
    };
  }
  if (o.route === "veed") {
    if (!cues.length) throw new Error("There are no lines to burn in");
    return {
      ...base,
      params: {
        extra: {
          preset: style.veed,
          srt_content: toSrt(cues),
          "customization.position": o.look.position,
          "customization.shadow": style.box ? "none" : "mid",
          "customization.text_customizations.baseline.font": style.font,
          "customization.text_customizations.baseline.weight": style.weight,
          "customization.text_customizations.baseline.color": color,
          ...(style.highlight && { "customization.text_customizations.highlighted.color": style.highlight }),
        },
      },
    };
  }
  return {
    ...base,
    params: {
      ...(o.sourceLanguage && o.sourceLanguage !== "auto" && { sourceLanguage: o.sourceLanguage }),
      extra: {
        font_name: style.font,
        font_weight: style.weight >= 900 ? "black" : style.weight >= 700 ? "bold" : "normal",
        font_color: nearestColorName(color),
        highlight_color: nearestColorName(style.highlight ?? color),
        position: o.look.position,
        font_size: AUTO_FONT_SIZE[o.look.size],
        words_per_subtitle: style.karaoke ? 3 : 6,
        background_color: style.box ? "black" : "none",
        ...(style.box && { background_opacity: 0.6 }),
      },
    },
  };
}

/** The transcription job: the engine's transcriber, the spoken language if known. */
export function transcribeRequest(o: { engine: Engine; video: string; modelId?: string; sourceLanguage?: string }): GenerationRequest {
  return {
    feature: CAPTIONS_FEATURE,
    modelId: o.modelId ?? (o.engine === "open" ? "oss-qwen3-asr" : "scribe-v2"),
    op: "transcribe",
    inputs: { video: o.video },
    ...(o.sourceLanguage && o.sourceLanguage !== "auto" && { params: { sourceLanguage: o.sourceLanguage } }),
  };
}

/** The words shown at time `t` (karaoke styles show a few words at a time), for the live preview. */
export function previewText(cues: Cue[], t: number, look: CaptionLook): { text: string; highlight?: number } | null {
  const c = cues.find((x) => t >= x.start && t < x.end);
  if (!c) return null;
  const style = styleById(look.style);
  const text = style.upper ? c.text.toUpperCase() : c.text;
  if (!style.karaoke) return { text };
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const i = Math.min(words.length - 1, Math.floor(((t - c.start) / Math.max(0.01, c.end - c.start)) * words.length));
  const group = Math.floor(i / 3) * 3;
  return { text: words.slice(group, group + 3).join(" "), highlight: i - group };
}
