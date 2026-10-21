/** Colour helpers for the palette editor (pure): conversions, harmonies and k-means extraction. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

export const luminance = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export type Harmony = "analogous" | "complementary" | "monochromatic" | "split-complementary" | "triad" | "square";

export const HARMONIES: { id: Harmony; name: string; offsets: number[] }[] = [
  { id: "analogous", name: "Analogous", offsets: [-56, -28, 0, 28, 56] },
  { id: "complementary", name: "Complementary", offsets: [0, 180] },
  { id: "monochromatic", name: "Monochromatic", offsets: [0] },
  { id: "split-complementary", name: "Split complementary", offsets: [0, 150, 210] },
  { id: "triad", name: "Triad", offsets: [0, 120, 240] },
  { id: "square", name: "Square", offsets: [0, 90, 180, 270] },
];

/**
 * A palette around a base colour: the harmony's hues, each in a dark → light ramp, sorted dark → light
 * like Cinema Studio's palettes, with the base colour itself last (the accent).
 */
export function harmonyPalette(baseHex: string, harmony: Harmony, count = 6): string[] {
  const [h, s, l] = rgbToHsl(hexToRgb(baseHex));
  const def = HARMONIES.find((x) => x.id === harmony) ?? HARMONIES[0];
  const n = Math.max(2, Math.min(12, count));
  const out: { hex: string; l: number }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const hue = h + def.offsets[i % def.offsets.length];
    const t = n > 2 ? i / (n - 2) : 0.5;
    const light = 0.1 + t * 0.78;
    const sat = harmony === "monochromatic" ? Math.max(0.08, s * (0.45 + 0.55 * (1 - Math.abs(t - 0.5) * 2))) : Math.max(0.12, Math.min(0.85, s * (0.7 + 0.3 * Math.sin(t * Math.PI))));
    out.push({ hex: hslToHex(hue, sat, light), l: light });
  }
  out.sort((a, b) => a.l - b.l);
  return [...out.map((o) => o.hex), hslToHex(h, s, l)];
}

/** Deterministic PRNG (mulberry32) so the same image gives the same palette. */
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** RGBA pixels → at most `max` RGB samples (evenly strided, transparent pixels skipped). */
export function samplePixels(data: Uint8ClampedArray | number[], max = 6000): RGB[] {
  const total = data.length / 4;
  const step = Math.max(1, Math.floor(total / max));
  const out: RGB[] = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    out.push([data[o], data[o + 1], data[o + 2]]);
  }
  return out;
}

/**
 * k-means++ colour clustering. Returns the centres, dark → light, with the share of pixels each
 * covers; clusters that end up empty are dropped.
 */
export function kmeans(pixels: RGB[], k: number, iterations = 14, seed = 7): { color: string; share: number; rgb: RGB }[] {
  if (!pixels.length) return [];
  const rand = rng(seed);
  const kk = Math.max(1, Math.min(k, pixels.length));
  const centres: RGB[] = [pixels[Math.floor(rand() * pixels.length)]];
  while (centres.length < kk) {
    const d = pixels.map((p) => Math.min(...centres.map((c) => dist2(p, c))));
    const sum = d.reduce((a, b) => a + b, 0);
    if (!sum) break;
    let r = rand() * sum;
    let idx = 0;
    while (idx < d.length - 1 && r > d[idx]) r -= d[idx++];
    centres.push([...pixels[idx]] as RGB);
  }
  const assign = new Array<number>(pixels.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const dd = dist2(pixels[i], centres[c]);
        if (dd < bd) {
          bd = dd;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved = true;
      }
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    pixels.forEach((p, i) => {
      const s = sums[assign[i]];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    });
    sums.forEach((s, c) => {
      if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
    if (!moved && it > 0) break;
  }
  const counts = centres.map((_, c) => assign.filter((a) => a === c).length);
  return centres
    .map((c, i) => ({ rgb: c.map(Math.round) as RGB, color: rgbToHex(c), share: counts[i] / pixels.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => luminance(a.rgb) - luminance(b.rgb));
}

/** A Cinema-Studio-style palette from an image: k clusters dark → light, the most saturated sizeable one repeated last as the accent. */
export function paletteFromPixels(pixels: RGB[], count = 12): string[] {
  const clusters = kmeans(pixels, Math.max(2, count - 1));
  if (!clusters.length) return [];
  const accent = [...clusters].filter((c) => c.share > 0.02).sort((a, b) => rgbToHsl(b.rgb)[1] - rgbToHsl(a.rgb)[1])[0] ?? clusters[clusters.length - 1];
  return [...clusters.map((c) => c.color), accent.color];
}
