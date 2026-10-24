import { END_CARD } from "@/lib/catalog/marketing";
import { containIn, contrast, fitText, fontString, readableOn, textBox, type AdPlan, type AdTheme, type Measure, type Rect, type TextBox } from "../ads/layout";
import { drawPlan, ensureFont, loadImage, measureText } from "../ads/render";

/**
 * Click to Ad's logo end card: the brand colour, the logo (or the brand's name), the product name and a
 * call-to-action pill, centred on a 9:16 card. Laid out here (pure, tested) and drawn with the Ads Studio
 * compositor's drawPlan, so the preview on the page and the PNG the ad ends on are the same picture.
 */

export interface EndCardContent {
  /** Shown when the kit has no logo. */
  brand: string;
  product: string;
  cta?: string;
  /** A small line at the bottom (the shop's address). */
  website?: string;
}

export interface EndCardLayoutInput {
  theme: AdTheme;
  content: EndCardContent;
  /** The logo's pixel size (null: none, or it didn't load). */
  logo?: { w: number; h: number } | null;
  measure: Measure;
  size?: { w: number; h: number };
}

/** "yourshop.com" from "https://www.yourshop.com/products/x". */
export function siteLabel(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Where everything goes on the card: one centred block (logo or name, product, CTA), the address at the foot. */
export function planEndCard(p: EndCardLayoutInput): AdPlan {
  const { w: W, h: H } = p.size ?? END_CARD.size;
  const t = p.theme;
  const m = Math.round(W * 0.1);
  const inner = W - 2 * m;
  const ink = t.onAccent;
  const gap = H * 0.04;
  // Measure the block first, then centre it a little above the middle.
  const logoH = H * 0.15;
  const name = !p.logo && p.content.brand.trim() ? fitText(p.content.brand.trim().toUpperCase(), inner, 2, t.heading, 800, W * 0.1, W * 0.06, p.measure) : null;
  const head = fitText(p.content.product.trim() || " ", inner, 2, t.heading, 700, W * 0.068, W * 0.045, p.measure);
  const ctaSize = W * 0.045;
  const label = p.content.cta?.trim() ? fitText(p.content.cta.trim(), inner - ctaSize * 2.4, 1, t.body, 700, ctaSize, W * 0.03, p.measure) : null;
  const ctaH = label ? label.size * 2.3 : 0;
  const top = p.logo ? logoH : name ? name.lines.length * name.size * 1.05 : 0;
  const headH = head.lines.length * head.size * 1.12;
  const total = top + (top ? gap : 0) + headH + (label ? gap * 1.4 + ctaH : 0);
  let y = Math.max(m, (H - total) / 2 - H * 0.03);

  let logo: Rect | undefined;
  let brand: TextBox | undefined;
  if (p.logo) {
    logo = containIn(p.logo.w, p.logo.h, { x: m, y, w: inner, h: logoH }, "center");
    y += logoH + gap;
  } else if (name) {
    brand = textBox(name, W / 2, y, t.heading, 800, ink, "center", inner, 1.05);
    y += top + gap;
  }
  const headline = textBox(head, W / 2, y, t.heading, 700, ink, "center", inner);
  y += headH;
  let cta: AdPlan["cta"];
  if (label) {
    y += gap * 1.4;
    const tw = p.measure(label.lines[0], fontString(t.body, label.size, 700));
    const bw = Math.min(inner, tw + label.size * 2.4);
    const bx = (W - bw) / 2;
    // The pill is the text colour; its words the brand colour, or whatever reads on the pill.
    const onPill = contrast(t.accent, ink) >= 3 ? t.accent : readableOn(ink);
    cta = { x: bx, y, w: bw, h: ctaH, radius: ctaH / 2, color: ink, text: textBox(label, bx + bw / 2, y + (ctaH - label.size * 1.12) / 2, t.body, 700, onPill, "center", bw) };
  }
  const site = p.content.website?.trim() ? fitText(p.content.website.trim(), inner, 1, t.body, 500, W * 0.032, W * 0.024, p.measure) : null;
  const body = site ? textBox(site, W / 2, H - m - site.size * 1.12, t.body, 500, ink, "center", inner) : undefined;
  return { w: W, h: H, bg: t.accent, image: null, logo, brand, headline, body, cta };
}

export interface EndCardInput {
  theme: AdTheme;
  content: EndCardContent;
  logo?: string | null;
}

/**
 * Draw the card on `canvas` at `scale` (1 = the full 720 × 1280 card). Fonts and the logo load first;
 * `current` says whether this drawing is still wanted then (a newer one for the same canvas wins).
 */
export async function renderEndCard(canvas: HTMLCanvasElement, input: EndCardInput, scale = 1, current: () => boolean = () => true): Promise<void> {
  const [logo] = await Promise.all([input.logo ? loadImage(input.logo).catch(() => null) : null, ensureFont(input.theme.heading), ensureFont(input.theme.body)]);
  if (!current()) return;
  const { w, h } = END_CARD.size;
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const plan = planEndCard({ theme: input.theme, content: input.content, logo: logo ? { w: logo.naturalWidth || 400, h: logo.naturalHeight || 120 } : null, measure: measureText });
  drawPlan(ctx, plan, null, logo);
}

/** The full-size card as a PNG, ready to upload. */
export async function endCardPng(input: EndCardInput): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await renderEndCard(canvas, input, 1);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the end card"))), "image/png"));
}
