import type { AdRatio } from "@/lib/catalog/marketing";

/**
 * Ad compositing math (pure, tested): where the visual, scrim/panel, logo, headline, body copy and
 * CTA go in each format, how text wraps and shrinks to fit, and the brand theme. The browser draws
 * the plan on a canvas (render.ts) for the grid, the editor and PNG exports, so every surface shows
 * the same creative.
 */

export const AD_SIZE: Record<AdRatio, { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
  "9:16": { w: 1080, h: 1920 },
};

/** Canvas size for any "w:h" ratio, 1080 px wide (Ads Studio's three formats, or a poster's own shape). */
export function sizeFor(ratio: string): { w: number; h: number } {
  if (ratio in AD_SIZE) return AD_SIZE[ratio as AdRatio];
  const [a, b] = ratio.split(":").map(Number);
  return a > 0 && b > 0 ? { w: 1080, h: Math.round((1080 * b) / a) } : AD_SIZE["1:1"];
}

export type AdLayout = "overlay" | "panel" | "band" | "frame";

export const AD_LAYOUTS: { id: AdLayout; name: string; hint: string }[] = [
  { id: "overlay", name: "Overlay", hint: "Full-bleed picture, text over a soft shade" },
  { id: "panel", name: "Panel", hint: "Picture on top, a colour panel for the words" },
  { id: "band", name: "Band", hint: "A bold brand-colour band with the headline" },
  { id: "frame", name: "Frame", hint: "Editorial: the picture framed on paper" },
];

/** A sensible layout per format when the creative hasn't picked one. */
export const defaultLayout = (ratio: string, seed = 0): AdLayout => (sizeFor(ratio).h / sizeFor(ratio).w > 1.5 ? (seed % 3 === 2 ? "frame" : "panel") : (["overlay", "overlay", "band", "frame"] as AdLayout[])[seed % 4]);

/** Width of `text` set in `font` (a CSS font string), in px. The canvas provides it in the browser. */
export type Measure = (text: string, font: string) => number;

export interface AdTheme {
  accent: string;
  onAccent: string;
  ink: string;
  paper: string;
  heading: string;
  body: string;
}

export interface AdContent {
  headline: string;
  body?: string;
  cta?: string;
  /** Shown when there's no logo. */
  brand?: string;
}

export interface TextBox {
  lines: string[];
  x: number;
  /** Top of the first line. */
  y: number;
  size: number;
  lineHeight: number;
  font: string;
  color: string;
  align: "left" | "center";
  width: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AdPlan {
  w: number;
  h: number;
  bg: string;
  /** Where the visual goes and the part of it that's shown (cover crop). */
  image: (Rect & { sx: number; sy: number; sw: number; sh: number; radius: number }) | null;
  scrim?: Rect & { from: string; to: string };
  panel?: Rect & { color: string };
  logo?: Rect;
  brand?: TextBox;
  headline: TextBox;
  body?: TextBox;
  cta?: Rect & { radius: number; color: string; text: TextBox };
}

// ---------------------------------------------------------------------------
// Colour

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.padEnd(6, "0");
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** White or near-black text, whichever reads better on `bg`. */
export const readableOn = (bg: string) => (contrast(bg, "#ffffff") >= contrast(bg, "#141414") ? "#ffffff" : "#141414");

function saturation(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

const SERIF = /serif|playfair|garamond|didot|bodoni|cormorant|lora|baskerville|fraunces|merriweather|libre caslon|dm serif|crimson|georgia|times/i;
export const fallbackFor = (family: string) => (SERIF.test(family) && !/sans/i.test(family) ? "Georgia, serif" : "system-ui, sans-serif");

/** The ad theme from a brand kit: its most colourful colour as the accent, its darkest/lightest as ink/paper. */
export function themeFrom(kit: { colors?: string[]; fonts?: { heading?: string; body?: string } } | null | undefined): AdTheme {
  const colors = (kit?.colors ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const accent = colors.find((c) => saturation(c) > 0.3 && luminance(c) > 0.03 && luminance(c) < 0.8) ?? colors[0] ?? "#5d4bdb";
  const dark = [...colors].sort((a, b) => luminance(a) - luminance(b))[0];
  const light = [...colors].sort((a, b) => luminance(b) - luminance(a))[0];
  return {
    accent,
    onAccent: readableOn(accent),
    ink: dark && luminance(dark) < 0.06 ? dark : "#141414",
    paper: light && luminance(light) > 0.8 ? light : "#ffffff",
    heading: kit?.fonts?.heading || "Inter",
    body: kit?.fonts?.body || kit?.fonts?.heading || "Inter",
  };
}

export const fontString = (family: string, size: number, weight = 400) => `${weight} ${Math.round(size)}px "${family.replace(/"/g, "")}", ${fallbackFor(family)}`;

// ---------------------------------------------------------------------------
// Geometry

/** The part of an image that fills a box without distortion, centred on `focus` (0–1). */
export function coverCrop(iw: number, ih: number, bw: number, bh: number, focus = { x: 0.5, y: 0.45 }) {
  const scale = Math.max(bw / iw, bh / ih);
  const sw = Math.min(iw, bw / scale);
  const sh = Math.min(ih, bh / scale);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  return { sx: clamp(focus.x * iw - sw / 2, iw - sw), sy: clamp(focus.y * ih - sh / 2, ih - sh), sw, sh };
}

/** A box that fits `w×h` inside `box` keeping its shape, aligned left/top (or centred). */
export function containIn(w: number, h: number, box: Rect, align: "left" | "center" = "left"): Rect {
  const s = Math.min(box.w / w, box.h / h);
  const fw = w * s;
  const fh = h * s;
  return { x: align === "center" ? box.x + (box.w - fw) / 2 : box.x, y: box.y + (box.h - fh) / 2, w: fw, h: fh };
}

/** Greedy word wrap; a word longer than the line is broken by characters. */
export function wrapText(text: string, width: number, font: string, measure: Measure): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine, font) <= width) {
      line = tryLine;
      continue;
    }
    if (line) lines.push(line);
    if (measure(word, font) <= width) {
      line = word;
      continue;
    }
    // Break an over-long word.
    let piece = "";
    for (const ch of word) {
      if (measure(piece + ch, font) > width && piece) {
        lines.push(piece);
        piece = ch;
      } else piece += ch;
    }
    line = piece;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The largest size (from max down to min, in 6% steps) at which `text` fits in `maxLines` lines of
 * `width`. At the smallest size the last line ends with "…" if the text still doesn't fit.
 */
export function fitText(text: string, width: number, maxLines: number, family: string, weight: number, max: number, min: number, measure: Measure): { size: number; lines: string[] } {
  let size = max;
  for (;;) {
    const font = fontString(family, size, weight);
    const lines = wrapText(text, width, font, measure);
    if (lines.length <= maxLines) return { size, lines };
    if (size <= min) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last && measure(`${last}…`, font) > width) last = last.slice(0, -1).trimEnd();
      kept[maxLines - 1] = `${last}…`;
      return { size, lines: kept };
    }
    size = Math.max(min, size * 0.94);
  }
}

const textBox = (t: { size: number; lines: string[] }, x: number, y: number, family: string, weight: number, color: string, align: "left" | "center", width: number, lh = 1.12): TextBox => ({
  lines: t.lines,
  x,
  y,
  size: t.size,
  lineHeight: t.size * lh,
  font: fontString(family, t.size, weight),
  color,
  align,
  width,
});

const heightOf = (b: TextBox | undefined) => (b ? b.lines.length * b.lineHeight : 0);

// ---------------------------------------------------------------------------
// The plan

export interface PlanInput {
  /** "1:1", "4:5", "9:16" (or any w:h). */
  ratio: AdRatio | string;
  layout: AdLayout;
  content: AdContent;
  theme: AdTheme;
  /** The visual's pixel size (null: no visual yet). */
  image: { w: number; h: number } | null;
  logo?: { w: number; h: number } | null;
  measure: Measure;
}

/** Lay out one creative. Every box stays inside the canvas; text shrinks before it overflows. */
export function planAd(p: PlanInput): AdPlan {
  const { w: W, h: H } = sizeFor(p.ratio);
  const m = Math.round(W * 0.07);
  const tall = H / W > 1.5;
  const portrait = H / W > 1.15;
  const t = p.theme;
  const inner = W - 2 * m;

  // Copy blocks are measured first, then stacked from the bottom of their region.
  const headlineMax = W * (tall ? 0.1 : 0.088);
  const fitHeadline = (width: number, lines: number, max = headlineMax) => fitText(p.content.headline || " ", width, lines, t.heading, 800, max, W * 0.042, p.measure);
  const fitBody = (width: number) => (p.content.body?.trim() ? fitText(p.content.body, width, tall ? 4 : 3, t.body, 400, W * 0.034, W * 0.026, p.measure) : null);
  const ctaBox = (x: number, bottom: number, color: string, onColor: string, align: "left" | "center", maxW = inner): AdPlan["cta"] => {
    if (!p.content.cta?.trim()) return undefined;
    const size = W * 0.032;
    const label = fitText(p.content.cta.trim(), maxW - size * 2.4, 1, t.body, 700, size, W * 0.024, p.measure);
    const tw = p.measure(label.lines[0], fontString(t.body, label.size, 700));
    const bw = Math.min(maxW, tw + label.size * 2.4);
    const bh = label.size * 2.3;
    const bx = align === "center" ? (W - bw) / 2 : x;
    return {
      x: bx,
      y: bottom - bh,
      w: bw,
      h: bh,
      radius: bh / 2,
      color,
      text: textBox(label, bx + bw / 2, bottom - bh + (bh - label.size * 1.12) / 2, t.body, 700, onColor, "center", bw),
    };
  };
  /** The CTA pill: brand colour (frame, overlay), or paper on the brand-colour panel. */
  const panelCta = (onPaper: boolean, x: number, bottom: number, maxW = inner) =>
    onPaper ? ctaBox(x, bottom, t.accent, t.onAccent, "left", maxW) : ctaBox(x, bottom, t.paper, readableOn(t.paper) === "#ffffff" ? "#ffffff" : t.ink, "left", maxW);
  const logoRect = (x: number, y: number, maxW: number, maxH: number, align: "left" | "center" = "left"): Rect | undefined =>
    p.logo ? containIn(p.logo.w, p.logo.h, { x, y, w: maxW, h: maxH }, align) : undefined;
  const brandText = (x: number, y: number, color: string, align: "left" | "center"): TextBox | undefined =>
    !p.logo && p.content.brand?.trim() ? textBox(fitText(p.content.brand.trim().toUpperCase(), inner * 0.6, 1, t.body, 700, W * 0.03, W * 0.022, p.measure), x, y, t.body, 700, color, align, inner * 0.6, 1.1) : undefined;
  const image = (r: Rect, radius = 0): AdPlan["image"] => (p.image ? { ...r, ...coverCrop(p.image.w, p.image.h, r.w, r.h), radius } : null);

  // Landscape (a 16:9 poster): the words get a column beside the picture, not the strip under it.
  if (W / H > 1.3 && p.layout !== "band") {
    const framed = p.layout === "frame";
    const overlay = p.layout === "overlay";
    const half = Math.round(W * 0.5);
    const colW = overlay ? Math.round(W * 0.6) - m : half - Math.round(m * 1.5);
    const bg = overlay ? t.ink : framed ? t.paper : t.accent;
    const ink = overlay ? "#ffffff" : framed ? (readableOn(bg) === "#ffffff" ? "#ffffff" : t.ink) : t.onAccent;
    const imgRect = overlay ? { x: 0, y: 0, w: W, h: H } : framed ? { x: half, y: m, w: W - half - m, h: H - 2 * m } : { x: half, y: 0, w: W - half, h: H };
    const top = m * 1.7;
    const bottom = H - m;
    const cta = panelCta(framed || overlay, m, bottom, colW);
    const gap = m * 0.35;
    let body = fitBody(colW);
    const room = () => (cta ? cta.y - gap : bottom) - top - (body ? body.lines.length * body.size * 1.32 + gap : 0);
    let head = fitHeadline(colW, 4);
    while (head.lines.length * head.size * 1.08 > room() && head.size > W * 0.042) head = fitHeadline(colW, 4, head.size * 0.92);
    // Still too tall at the smallest headline: the body steps aside.
    if (body && head.lines.length * head.size * 1.08 > room()) body = null;
    const headH = head.lines.length * head.size * 1.08;
    const bodyH = body ? body.lines.length * body.size * 1.32 + gap : 0;
    // Overlay: the words sit just above the CTA; panel and frame: from the top of the column.
    const headY = overlay ? Math.max(top, (cta ? cta.y - gap : bottom) - bodyH - headH) : top;
    const headline = textBox(head, m, headY, t.heading, 800, ink, "left", colW, 1.08);
    const bodyBox = body ? textBox(body, m, headY + heightOf(headline) + gap, t.body, overlay ? 500 : 400, overlay ? "rgba(255,255,255,0.9)" : ink, "left", colW, 1.32) : undefined;
    return {
      w: W,
      h: H,
      bg,
      image: image(imgRect, framed ? W * 0.02 : 0),
      panel: overlay || framed ? undefined : { x: 0, y: 0, w: half, h: H, color: bg },
      scrim: overlay ? { x: 0, y: H * 0.2, w: W, h: H * 0.8, from: "rgba(0,0,0,0)", to: "rgba(0,0,0,0.74)" } : undefined,
      logo: logoRect(m, m * 0.5, W * 0.22, m * 0.85),
      brand: brandText(m, m * 0.65, ink, "left"),
      headline,
      body: bodyBox,
      cta,
    };
  }

  if (p.layout === "panel" || p.layout === "frame") {
    const framed = p.layout === "frame";
    // Frame: the picture on the brand's paper; panel: the words on a brand-colour panel.
    const bg = framed ? t.paper : t.accent;
    const ink = framed ? (readableOn(bg) === "#ffffff" ? "#ffffff" : t.ink) : t.onAccent;
    const imgH = Math.round(H * (tall ? 0.56 : portrait ? 0.58 : 0.54));
    const imgRect = framed ? { x: m, y: m * 1.9, w: W - 2 * m, h: imgH - m * 1.4 } : { x: 0, y: 0, w: W, h: imgH };
    const top = imgRect.y + imgRect.h + m * 0.8;
    const bottom = H - m;
    const cta = panelCta(framed, m, bottom);
    const body = fitBody(inner);
    const gap = m * 0.4;
    let head = fitHeadline(inner, tall ? 3 : 2);
    const room = (cta ? bottom - cta.h - gap : bottom) - top - (body ? body.lines.length * body.size * 1.32 + gap : 0);
    while (head.lines.length * head.size * 1.08 > room && head.size > W * 0.042) head = fitHeadline(inner, tall ? 3 : 2, head.size * 0.92);
    const headline = textBox(head, m, top, t.heading, 800, ink, "left", inner, 1.08);
    const bodyBox = body ? textBox(body, m, top + heightOf(headline) + gap, t.body, 400, ink, "left", inner, 1.32) : undefined;
    return {
      w: W,
      h: H,
      bg,
      image: image(imgRect, framed ? W * 0.025 : 0),
      panel: framed ? undefined : { x: 0, y: imgH, w: W, h: H - imgH, color: bg },
      logo: framed ? logoRect(m, m * 0.55, W * 0.32, m * 0.95) : logoRect(m, m * 0.7, W * 0.3, H * 0.055),
      brand: framed ? brandText(m, m * 0.75, ink, "left") : undefined,
      headline,
      body: bodyBox,
      cta,
    };
  }

  if (p.layout === "band") {
    const bandH = Math.round(H * (tall ? 0.24 : 0.27));
    // A short (landscape) band takes a smaller headline so two lines still fit in it.
    const head = fitHeadline(inner, 2, Math.min(W * 0.08, bandH * 0.4));
    const headline = textBox(head, W / 2, (bandH - head.lines.length * head.size * 1.08) / 2 + m * 0.25, t.heading, 800, t.onAccent, "center", inner, 1.08);
    const bottom = H - m;
    const cta = ctaBox(m, bottom, t.paper, readableOn(t.paper) === "#ffffff" ? "#ffffff" : t.ink, "center");
    const body = fitBody(inner);
    const bodyBox = body ? textBox(body, W / 2, (cta ? cta.y : bottom) - m * 0.45 - body.lines.length * body.size * 1.32, t.body, 600, "#ffffff", "center", inner, 1.32) : undefined;
    return {
      w: W,
      h: H,
      bg: t.accent,
      image: image({ x: 0, y: bandH, w: W, h: H - bandH }),
      panel: { x: 0, y: 0, w: W, h: bandH, color: t.accent },
      scrim: bodyBox || cta ? { x: 0, y: H * 0.62, w: W, h: H * 0.38, from: "rgba(0,0,0,0)", to: "rgba(0,0,0,0.62)" } : undefined,
      logo: logoRect(W / 2 - W * 0.13, bandH - m * 0.2 - Math.min(m * 0.5, bandH * 0.18), W * 0.26, Math.min(m * 0.5, bandH * 0.18), "center"),
      headline,
      body: bodyBox,
      cta,
    };
  }

  // Overlay: the visual fills the canvas; the words sit on a shade at the bottom.
  const bottom = H - m;
  const cta = ctaBox(m, bottom, t.accent, t.onAccent, "left");
  const body = fitBody(inner);
  const gap = m * 0.38;
  const head = fitHeadline(inner, 3);
  const bodyTop = (cta ? cta.y - gap : bottom) - (body ? body.lines.length * body.size * 1.32 : 0);
  const bodyBox = body ? textBox(body, m, bodyTop, t.body, 500, "rgba(255,255,255,0.9)", "left", inner, 1.32) : undefined;
  const headTop = (bodyBox ? bodyTop - gap : cta ? cta.y - gap : bottom) - head.lines.length * head.size * 1.06;
  const headline = textBox(head, m, Math.max(H * 0.3, headTop), t.heading, 800, "#ffffff", "left", inner, 1.06);
  return {
    w: W,
    h: H,
    bg: t.ink,
    image: image({ x: 0, y: 0, w: W, h: H }),
    scrim: { x: 0, y: Math.min(headline.y - m * 1.2, H * 0.45), w: W, h: H - Math.min(headline.y - m * 1.2, H * 0.45), from: "rgba(0,0,0,0)", to: "rgba(0,0,0,0.74)" },
    logo: logoRect(m, m * 0.8, W * 0.3, H * 0.06),
    brand: brandText(m, m * 0.8, "#ffffff", "left"),
    headline,
    body: bodyBox,
    cta,
  };
}

/** Every drawn box of a plan (tests check they stay inside the canvas). */
export function planRects(plan: AdPlan): Rect[] {
  const tb = (b?: TextBox): Rect | null =>
    b ? { x: b.align === "center" ? b.x - b.width / 2 : b.x, y: b.y, w: b.width, h: b.lines.length * b.lineHeight } : null;
  return [plan.image, plan.panel, plan.scrim, plan.logo, tb(plan.brand), tb(plan.headline), tb(plan.body), plan.cta].filter((r): r is Rect => !!r);
}

/** File name for an exported creative: "acme-serum-4x5-3.png". */
export function exportName(brand: string, product: string | undefined, ratio: string, n: number): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .slice(0, 40);
  return `${[slug(brand), product && slug(product)].filter(Boolean).join("-") || "ad"}-${ratio.replace(":", "x")}-${n}.png`;
}
