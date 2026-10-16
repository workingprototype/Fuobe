import "server-only";
import { nanoid } from "nanoid";
import { OPERATION_OUTPUT } from "@/lib/catalog/types";
import type { ProviderAdapter } from "./types";
import { toDataUri } from "../storage";

/**
 * Demo provider: lets anyone click through the whole product with no API keys or GPU.
 * Produces abstract placeholder art (SVG) for images, a bundled sample clip for video
 * and a short tone for audio. Clearly labelled as demo output.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export function demoSvg(prompt: string, aspectRatio = "1:1", variant = 0): string {
  const [aw, ah] = (aspectRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)?.slice(1).map(Number) ?? [1, 1]) as number[];
  const width = 1024;
  const height = Math.round((1024 * ah) / aw);
  const r = rng(hash(`${prompt}#${variant}`));
  const hue = Math.floor(r() * 360);
  const blobs = Array.from({ length: 6 }, (_, i) => {
    const h = (hue + i * 47 + r() * 40) % 360;
    return `<circle cx="${(r() * width).toFixed(0)}" cy="${(r() * height).toFixed(0)}" r="${(180 + r() * 320).toFixed(0)}" fill="oklch(${(0.62 + r() * 0.25).toFixed(2)} ${(0.12 + r() * 0.1).toFixed(2)} ${h})" opacity="${(0.55 + r() * 0.4).toFixed(2)}"/>`;
  }).join("");
  const words = prompt.trim().split(/\s+/).slice(0, 18);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 28) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  const text = lines
    .slice(0, 4)
    .map((l, i) => `<text x="64" y="${height - 72 - (Math.min(lines.length, 4) - 1 - i) * 44}" font-size="34" font-family="ui-sans-serif, system-ui" font-weight="600" fill="white" fill-opacity="0.92">${escapeXml(l)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="90"/></filter>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="black" stop-opacity="0"/><stop offset="1" stop-color="black" stop-opacity="0.55"/></linearGradient></defs>
<rect width="100%" height="100%" fill="oklch(0.3 0.06 ${hue})"/>
<g filter="url(#b)">${blobs}</g>
<rect width="100%" height="100%" fill="url(#s)"/>
<rect x="56" y="48" rx="18" width="176" height="40" fill="white" fill-opacity="0.18"/>
<text x="76" y="75" font-size="20" font-family="ui-sans-serif, system-ui" font-weight="600" fill="white">DEMO OUTPUT</text>
${text}
</svg>`;
}

function demoWav(seconds = 2): Buffer {
  const rate = 22050;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 2000, (n - i) / 2000);
    const v = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.25 * env + Math.sin((2 * Math.PI * 660 * i) / rate) * 0.12 * env;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const DURATION_MS = { image: 3500, video: 7000, audio: 3000 };

export const mockProvider: ProviderAdapter = {
  id: "mock",
  label: "Demo",
  isConfigured: () => true,

  async prepareFile(data, contentType) {
    return toDataUri(data.subarray(0, 64), contentType); // never sent anywhere; keep it tiny
  },

  async submit({ route, input }) {
    return {
      externalId: `demo_${nanoid(10)}`,
      meta: {
        startedAt: Date.now(),
        kind: OPERATION_OUTPUT[route.op],
        prompt: input.prompt ?? route.op,
        aspectRatio: input.aspectRatio ?? "1:1",
        count: Math.max(1, Math.min(4, input.numOutputs ?? 1)),
        // Let draft mode be tried end to end in demo mode.
        draft: !!(input.draft && route.map?.draft),
      },
      payload: { demo: true, ...input },
    };
  },

  async poll({ meta }) {
    const kind = meta.kind as "image" | "video" | "audio";
    const elapsed = Date.now() - Number(meta.startedAt);
    const total = DURATION_MS[kind];
    if (elapsed < 600) return { state: "queued", message: "Queued (demo)" };
    if (elapsed < total) return { state: "running", progress: elapsed / total, message: "Generating demo output" };
    if (kind === "image") {
      return {
        state: "succeeded",
        outputs: Array.from({ length: Number(meta.count) }, (_, i) => ({
          url: toDataUri(Buffer.from(demoSvg(String(meta.prompt), String(meta.aspectRatio), i)), "image/svg+xml"),
          kind: "image" as const,
          contentType: "image/svg+xml",
        })),
      };
    }
    if (kind === "audio") {
      return { state: "succeeded", outputs: [{ url: toDataUri(demoWav(), "audio/wav"), kind: "audio", contentType: "audio/wav" }] };
    }
    const ar = String(meta.aspectRatio);
    const sample = ar === "9:16" || ar === "3:4" || ar === "2:3" ? "demo-portrait.mp4" : ar === "1:1" ? "demo-square.mp4" : "demo-landscape.mp4";
    return {
      state: "succeeded",
      outputs: [{ url: `sample:${sample}`, kind: "video", contentType: "video/mp4", ...(meta.draft ? { draftId: `demo_draft_${nanoid(8)}` } : {}) }],
    };
  },

  async test() {
    return { ok: true, detail: "Demo provider is always available" };
  },
};
