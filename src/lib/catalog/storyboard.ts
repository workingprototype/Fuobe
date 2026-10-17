/**
 * Storyboards (Higgsfield Popcorn): up to 8 consistent frames. Frame 1 is made from the
 * references (or text alone); every later frame is an edit of the previous frame, so faces,
 * wardrobe, location and grade carry through.
 */
import type { Engine } from "./types";

export const MAX_FRAMES = 8;

/** Which models make the first frame and the follow-ups on each engine. */
export const STORYBOARD_MODELS: Record<Engine, { first: string; firstWithRefs: string; next: string; chainFrom: "first" | "last" }> = {
  cloud: { first: "nano-banana-pro", firstWithRefs: "nano-banana-pro", next: "nano-banana-pro", chainFrom: "last" },
  // Qwen-Image-Edit + the next-scene LoRA takes the previous panel as image 1 and the character as image 2.
  open: { first: "oss-z-image-turbo", firstWithRefs: "oss-qwen-edit", next: "oss-qwen-next-scene", chainFrom: "first" },
};

const SHOTS = [
  "establishing wide shot",
  "medium shot",
  "close-up",
  "over-the-shoulder shot",
  "low-angle shot",
  "detail insert shot",
  "tracking shot",
  "wide closing shot",
];

/** Offline split of one story idea into n scenes (used when no LLM is configured). */
export function heuristicScenes(story: string, n: number): string[] {
  const s = story.trim().replace(/[.\s]+$/, "");
  return Array.from({ length: n }, (_, i) => `${SHOTS[i % SHOTS.length]}: ${s} — beat ${i + 1} of ${n}`);
}

/** Parse an LLM answer into n scene lines (JSON array or numbered list). */
export function parseScenes(text: string, n: number): string[] | null {
  const json = /\[[\s\S]*\]/.exec(text)?.[0];
  if (json) {
    try {
      const arr = (JSON.parse(json) as unknown[]).map((x) => String(typeof x === "object" && x ? ((x as { scene?: string }).scene ?? JSON.stringify(x)) : x).trim()).filter(Boolean);
      if (arr.length >= Math.min(2, n)) return arr.slice(0, n);
    } catch {}
  }
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim())
    .filter((l) => l.length > 8);
  return lines.length >= Math.min(2, n) ? lines.slice(0, n) : null;
}

export const SPLIT_SYSTEM = `You are a storyboard artist. Split the user's story into the requested number of consecutive frames of one film.
Each frame is one sentence describing a single still image: shot type, what the characters do, where, the light.
Keep the same characters, wardrobe and location style across frames. Return ONLY a JSON array of strings.`;

/** Prompt for one frame. `refs` = number of reference images sent before/after the previous frame. */
export function framePrompt(scene: string, index: number, opts: { refs: number; chainFrom: "first" | "last"; style?: string }): string {
  const s = scene.trim().replace(/[.\s]+$/, "");
  const style = opts.style?.trim() ? ` Style: ${opts.style.trim().replace(/[.\s]+$/, "")}.` : "";
  if (index === 0) {
    const refs = opts.refs ? ` Use the reference image${opts.refs > 1 ? "s" : ""} for the characters and look.` : "";
    return `Frame 1 of a storyboard: ${s}.${refs}${style} Cinematic still, consistent production design.`;
  }
  if (opts.chainFrom === "first") return `Next Scene: ${s}.${style}`;
  const prev = opts.refs + 1;
  return `Next frame of the same storyboard: ${s}. Image ${prev} is the previous frame — continue from it with the same characters, faces, wardrobe, props, location style, lighting and color grade, like consecutive shots of one film.${style}`;
}
