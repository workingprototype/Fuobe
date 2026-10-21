import "server-only";
import { nanoid } from "nanoid";
import { cueText, parseCues, type Cue } from "@/lib/cues";
import { OPERATION_OUTPUT, type MediaKind, type Operation } from "@/lib/catalog/types";
import type { ProviderAdapter, RemoteOutput } from "./types";
import { textOutput } from "./llm";
import { toDataUri } from "../storage";

/**
 * Demo provider: lets anyone click through the whole product with no API keys or GPU.
 * Produces abstract placeholder art (SVG) for images, a bundled sample clip for video, a short
 * tone for audio, labelled text for transcripts/translations/scripts and a sample .glb for 3D,
 * with the structured extras real providers return (layer boxes, cues, text blocks, stems).
 * Clearly labelled as demo output.
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

function demoWav(seconds = 2, tones: [number, number] = [440, 660], wobble = 0): Buffer {
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
    // A slow tremolo makes the "voice" stem sound different from the steady "background" one.
    const am = wobble ? 0.55 + 0.45 * Math.sin((2 * Math.PI * wobble * i) / rate) : 1;
    const v = (Math.sin((2 * Math.PI * tones[0] * i) / rate) * 0.25 + Math.sin((2 * Math.PI * tones[1] * i) / rate) * 0.12) * env * am;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const DURATION_MS: Record<MediaKind, number> = { image: 3500, video: 7000, audio: 3000, text: 2500, model3d: 6000 };

type DemoOutput = RemoteOutput & { text?: string; meta?: Record<string, unknown> };

const svgUri = (svg: string) => toDataUri(Buffer.from(svg), "image/svg+xml");

function canvas(aspectRatio: string) {
  const [aw, ah] = (aspectRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)?.slice(1).map(Number) ?? [1, 1]) as number[];
  return { w: 1024, h: Math.round((1024 * ah) / aw) };
}

/** Layers: a full-frame background plus 2–3 cut-out shapes on transparency, each with name, z and bbox [x, y, w, h]. */
function demoLayers(prompt: string, aspectRatio: string, n: number): DemoOutput[] {
  const { w, h } = canvas(aspectRatio);
  const hue = Math.floor(rng(hash(`${prompt}#layers`))() * 360);
  const layer = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  const label = escapeXml(prompt.split(/\s+/).slice(0, 3).join(" ") || "Demo");
  const all: { name: string; box: number[]; draw: (b: number[]) => string }[] = [
    { name: "Subject", box: [w * 0.28, h * 0.22, w * 0.44, h * 0.6], draw: (b) => `<ellipse cx="${b[0] + b[2] / 2}" cy="${b[1] + b[3] / 2}" rx="${b[2] / 2}" ry="${b[3] / 2}" fill="oklch(0.72 0.17 ${(hue + 40) % 360})"/>` },
    { name: "Prop", box: [w * 0.08, h * 0.62, w * 0.26, h * 0.3], draw: (b) => `<rect x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" rx="28" fill="oklch(0.8 0.14 ${(hue + 150) % 360})"/>` },
    {
      name: "Text",
      box: [w * 0.06, h * 0.06, w * 0.6, h * 0.1],
      draw: (b) => `<text x="${b[0]}" y="${b[1] + b[3] * 0.75}" font-size="${Math.round(b[3] * 0.7)}" font-family="ui-sans-serif, system-ui" font-weight="700" fill="white">${label}</text>`,
    },
  ];
  const shapes = all.slice(0, Math.max(2, Math.min(3, n - 1)));
  const background: DemoOutput = {
    url: svgUri(
      layer(
        `<rect width="100%" height="100%" fill="oklch(0.32 0.07 ${hue})"/><rect x="40" y="${h - 76}" rx="14" width="300" height="40" fill="white" fill-opacity="0.18"/><text x="58" y="${h - 49}" font-size="20" font-family="ui-sans-serif, system-ui" font-weight="600" fill="white">DEMO OUTPUT · layers</text>`,
      ),
    ),
    kind: "image",
    contentType: "image/svg+xml",
    meta: { name: "Background", z: 0, bbox: [0, 0, w, h], demo: true },
  };
  return [
    background,
    ...shapes.map((s, i) => ({
      url: svgUri(layer(s.draw(s.box))),
      kind: "image" as const,
      contentType: "image/svg+xml",
      meta: { name: s.name, z: i + 1, bbox: s.box.map(Math.round), demo: true },
    })),
  ];
}

/** Text layers: the picture with its text removed, plus the text blocks that were on it. */
function demoTextLayers(prompt: string, aspectRatio: string): DemoOutput[] {
  const { w, h } = canvas(aspectRatio);
  const headline = prompt.split(/\s+/).slice(0, 4).join(" ") || "Your headline";
  const box = (x: number, y: number, bw: number, bh: number) => [x * w, y * h, bw * w, bh * h].map(Math.round);
  return [
    {
      url: svgUri(demoSvg("", aspectRatio, 7)),
      kind: "image",
      contentType: "image/svg+xml",
      meta: {
        name: "Background",
        z: 0,
        bbox: [0, 0, w, h],
        demo: true,
        textBlocks: [
          { text: headline.toUpperCase(), bbox: box(0.08, 0.1, 0.84, 0.12), fontFamily: "Inter", fontWeight: 800, fontSize: Math.round(h * 0.08), color: "#ffffff", align: "left" },
          { text: "Demo text block — connect a provider to read the real text", bbox: box(0.08, 0.24, 0.7, 0.05), fontFamily: "Inter", fontWeight: 500, fontSize: Math.round(h * 0.03), color: "#e8e6ff", align: "left" },
        ],
      },
    },
  ];
}

/** A demo transcript: a few timed lines that say what they are. */
function demoCues(prompt: string): Cue[] {
  const lines = [
    "This is a demo transcript.",
    "Connect a speech-to-text provider in Settings,",
    "or start ComfyUI, to transcribe your clip for real.",
    prompt ? `You asked for: ${prompt.slice(0, 80)}` : "Every line keeps its timing.",
  ];
  return lines.map((text, i) => ({ start: i * 2.5, end: i * 2.5 + 2.3, text }));
}

/** Demo translation: each line (or cue) tagged with the language, timing kept. */
function demoTranslate(source: string, language: string): DemoOutput {
  const tag = (t: string) => `[${language}] ${t}`;
  const cues = parseCues(source);
  if (cues) {
    const out = cues.map((c) => ({ ...c, text: tag(c.text) }));
    return textOutput(cueText(out), out, { language, demo: true });
  }
  const body = source.trim()
    ? source
        .split("\n")
        .map((l) => (l.trim() ? tag(l) : l))
        .join("\n")
    : tag("Demo translation");
  return textOutput(`${body}\n\n(Demo translation — connect Claude or Ollama in Settings to translate for real.)`, null, { language, demo: true });
}

function demoWrite(brief: string): DemoOutput {
  const topic = brief.trim().replace(/[.\s]+$/, "") || "your idea";
  return textOutput(
    [
      `Demo script for: ${topic}`,
      "",
      "HOOK — Open on the most striking image, no intro.",
      "BEAT 1 — Show the problem in one shot.",
      "BEAT 2 — Reveal the product or idea solving it.",
      "BEAT 3 — A close-up detail that makes it feel real.",
      "CLOSE — One line call to action.",
      "",
      "(Demo text — connect Claude or Ollama in Settings to write for real.)",
    ].join("\n"),
    null,
    { demo: true },
  );
}

const sampleClip = (ar: string) => (ar === "9:16" || ar === "3:4" || ar === "2:3" ? "demo-portrait.mp4" : ar === "1:1" ? "demo-square.mp4" : "demo-landscape.mp4");

function demoOutputs(op: Operation | undefined, kind: MediaKind, prompt: string, ar: string, meta: Record<string, unknown>): DemoOutput[] {
  // The prompt falls back to the op name when a step has none.
  const brief = prompt === op ? "" : prompt;
  switch (op) {
    case "layers":
      return demoLayers(brief, ar, Math.max(3, Math.min(4, Number(meta.numLayers ?? 4))));
    case "text-layers":
      return demoTextLayers(brief, ar);
    case "transcribe": {
      const cues = demoCues(brief);
      return [textOutput(cueText(cues), cues, { language: meta.sourceLanguage ?? "English", demo: true })];
    }
    case "translate":
      return [demoTranslate(brief, String(meta.targetLanguage ?? "Spanish"))];
    case "write":
      return [demoWrite(brief)];
    case "separate-audio": {
      const stems: DemoOutput[] = [
        { url: toDataUri(demoWav(3, [220, 330], 3), "audio/wav"), kind: "audio", contentType: "audio/wav", meta: { stem: "voice", demo: true } },
        { url: toDataUri(demoWav(3, [110, 165]), "audio/wav"), kind: "audio", contentType: "audio/wav", meta: { stem: "background", demo: true } },
      ];
      // Workflows that also time the voice stem (the open dub's first step) return its cues too.
      if (meta.transcript) {
        const cues = demoCues("");
        stems.push(textOutput(cueText(cues), cues, { role: "cues", language: meta.sourceLanguage ?? "English", demo: true }));
      }
      return stems;
    }
    case "image-to-3d":
      return [
        { url: "sample:demo-model.glb", kind: "model3d", contentType: "model/gltf-binary", meta: { demo: true, format: "glb" } },
        { url: "sample:demo-turntable.mp4", kind: "video", contentType: "video/mp4", meta: { demo: true, turntable: true } },
      ];
    case "trim":
    case "captions":
    case "mux":
      return [
        { url: `sample:${sampleClip(ar)}`, kind: "video", contentType: "video/mp4", meta: { demo: true } },
        // The segment cutter also hands over the segment's first frame (Shorts restyles it, then the clip).
        ...(meta.firstFrame ? [{ url: svgUri(demoSvg("first frame", ar, 3)), kind: "image" as const, contentType: "image/svg+xml", meta: { role: "first-frame", demo: true } }] : []),
      ];
  }
  if (kind === "image") {
    return Array.from({ length: Number(meta.count) }, (_, i) => ({ url: svgUri(demoSvg(prompt, ar, i)), kind: "image" as const, contentType: "image/svg+xml" }));
  }
  if (kind === "audio") return [{ url: toDataUri(demoWav(), "audio/wav"), kind: "audio", contentType: "audio/wav" }];
  if (kind === "text") return [textOutput(`Demo text for: ${brief || "your request"}`, null, { demo: true })];
  if (kind === "model3d") return [{ url: "sample:demo-model.glb", kind: "model3d", contentType: "model/gltf-binary", meta: { demo: true } }];
  return [{ url: `sample:${sampleClip(ar)}`, kind: "video", contentType: "video/mp4", ...(meta.draft ? { draftId: `demo_draft_${nanoid(8)}` } : {}) }];
}

export const mockProvider: ProviderAdapter = {
  id: "mock",
  label: "Demo",
  isConfigured: () => true,

  async prepareFile(data, contentType) {
    return toDataUri(data.subarray(0, 64), contentType); // never sent anywhere; keep it tiny
  },

  async submit({ route, input, model }) {
    return {
      externalId: `demo_${nanoid(10)}`,
      meta: {
        startedAt: Date.now(),
        op: route.op,
        // Colour matching keeps the input's kind (an image or a video); a timeline is audio or (fal) a video.
        kind: route.op === "color-match" || route.op === "timeline" ? model.kind : OPERATION_OUTPUT[route.op],
        prompt: input.prompt ?? route.op,
        aspectRatio: input.aspectRatio ?? "1:1",
        count: Math.max(1, Math.min(4, input.numOutputs ?? 1)),
        // Let draft mode be tried end to end in demo mode.
        draft: !!(input.draft && route.map?.draft),
        targetLanguage: input.targetLanguage,
        sourceLanguage: input.sourceLanguage,
        numLayers: input.numLayers,
        // Workflows whose second output is the cut's first frame (video-segment-resample).
        firstFrame: route.provider === "comfyui" && route.endpoint === "video-segment-resample",
        // A stem split that also transcribes (ComfyUI's dub-prepare-separate-transcribe).
        transcript: route.op === "separate-audio" && route.provider === "comfyui" && route.endpoint.includes("transcribe"),
      },
      payload: { demo: true, ...input },
    };
  },

  async poll({ meta }) {
    const kind = meta.kind as MediaKind;
    const elapsed = Date.now() - Number(meta.startedAt);
    const total = DURATION_MS[kind] ?? DURATION_MS.image;
    if (elapsed < 600) return { state: "queued", message: "Queued (demo)" };
    if (elapsed < total) return { state: "running", progress: elapsed / total, message: "Generating demo output" };
    return { state: "succeeded", outputs: demoOutputs(meta.op as Operation | undefined, kind, String(meta.prompt), String(meta.aspectRatio), meta) };
  },

  async test() {
    return { ok: true, detail: "Demo provider is always available" };
  },
};
