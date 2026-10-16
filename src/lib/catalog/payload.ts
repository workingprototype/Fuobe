import type { EnumField, FieldMap, GenInput, MediaKind } from "./types";

function enumValue(field: string | EnumField, value: string): [string, unknown] {
  if (typeof field === "string") return [field, value];
  return [field.key, field.values && value in field.values ? field.values[value] : value];
}

/** Write `a.b.c` as nested objects (MiniMax's voice_setting.voice_id etc.). */
function setPath(out: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split(".");
  let o = out;
  for (const k of parts.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
  o[parts[parts.length - 1]] = value;
}

/** Build a provider payload from canonical input using a route's {@link FieldMap}. Pure + unit-tested. */
export function buildPayload(map: FieldMap, input: GenInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (map.prompt !== false && input.prompt !== undefined) setPath(out, map.prompt ?? "prompt", input.prompt);
  if (map.negativePrompt && input.negativePrompt) out[map.negativePrompt] = input.negativePrompt;

  const images = input.images ?? [];
  if (map.images && images.length) out[map.images] = images;
  if (map.image && images.length) out[map.image] = images[0];
  if (map.endImage && input.endImage) out[map.endImage] = input.endImage;
  if (map.mask && input.mask) out[map.mask] = input.mask;
  if (map.video && input.video) out[map.video] = input.video;
  if (map.videoArray && input.video) out[map.videoArray] = [input.video];
  if (map.audio && input.audio) out[map.audio] = input.audio;

  if (map.aspectRatio && input.aspectRatio) {
    const [k, v] = enumValue(map.aspectRatio, input.aspectRatio);
    out[k] = v;
  }
  if (map.resolution && input.resolution) {
    const [k, v] = enumValue(map.resolution, input.resolution);
    out[k] = v;
  }
  if (map.duration && input.duration !== undefined) {
    const d = map.duration;
    const v = input.duration * (d.multiplier ?? 1);
    out[d.key] = d.type === "number" ? v : `${v}${d.suffix ?? ""}`;
  }
  if (map.numOutputs && input.numOutputs !== undefined) out[map.numOutputs] = input.numOutputs;
  if (map.seed && input.seed !== undefined && input.seed >= 0) {
    const r = map.seedRange;
    out[map.seed] = r ? r[0] + (input.seed % (r[1] - r[0] + 1)) : input.seed;
  }
  if (map.generateAudio && input.generateAudio !== undefined) {
    const g = map.generateAudio;
    if (typeof g === "string") out[g] = input.generateAudio;
    else out[g.key] = input.generateAudio ? g.on : g.off;
  }

  // Native multi-shot replaces the single prompt with per-shot prompts.
  if (map.multiShot && (input.shots?.length || input.multiShot === "auto")) {
    const ms = map.multiShot;
    if (input.shots?.length) {
      const shots = input.shots.map((s) => ({ prompt: s.prompt, duration: ms.durationType === "string" ? String(s.duration) : s.duration }));
      out[ms.key] = ms.json ? JSON.stringify(shots) : shots;
      if (map.prompt !== false) delete out[map.prompt ?? "prompt"];
      if (ms.shotType) out[ms.shotType] = "customize";
    } else if (ms.shotType) {
      out[ms.shotType] = "intelligent";
    }
    if (ms.flag) out[ms.flag] = true;
  }
  if (map.draft && input.draft) out[map.draft] = true;
  // Voices, dialogue and dubbing.
  if (map.voice && input.voice) setPath(out, map.voice, input.voice);
  if (map.voiceAudio && input.voiceAudio) out[map.voiceAudio] = input.voiceAudio;
  if (map.dialogue && input.dialogue?.length) {
    const d = map.dialogue;
    out[d.key] = input.dialogue.map((l) => ({ [d.text]: l.text, [d.voice]: l.voice ?? input.voice }));
  }
  if (map.targetLanguage && input.targetLanguage) out[map.targetLanguage] = input.targetLanguage;
  if (map.draftId && input.draftId) out[map.draftId] = input.draftId;

  for (const [k, v] of Object.entries({ ...map.fixed, ...input.extra })) setPath(out, k, v);
  return out;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|gif)(\?|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac)(\?|$)/i;

export function guessKind(url: string, contentType?: string, hint?: string): MediaKind {
  if (contentType?.startsWith("video/")) return "video";
  if (contentType?.startsWith("audio/")) return "audio";
  if (contentType?.startsWith("image/")) return "image";
  if (hint && /video/i.test(hint)) return "video";
  if (hint && /audio|speech|music|voice/i.test(hint)) return "audio";
  if (VIDEO_EXT.test(url)) return "video";
  if (AUDIO_EXT.test(url)) return "audio";
  return "image";
}

/**
 * Extract media URLs from an arbitrary provider response. Handles the common shapes:
 * {images:[{url}]}, {image:{url}}, {video:{url}}, {audio:{url}}, {audio_file:{url}},
 * {output: "https://..."} and {output: ["https://..."]} (Replicate).
 */
export function extractMedia(response: unknown): { url: string; kind: MediaKind; contentType?: string }[] {
  const found: { url: string; kind: MediaKind; contentType?: string }[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, keyHint: string) => {
    if (node == null) return;
    if (typeof node === "string") {
      if (/^(https?:\/\/|data:(image|video|audio)\/)/.test(node) && !seen.has(node)) {
        // Skip obvious non-media links (docs, logs).
        if (/^https?:\/\//.test(node) && !/\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|ogg|flac|m4a)(\?|$)/i.test(node) && !/(image|video|audio|output|url|file|media)/i.test(keyHint)) return;
        seen.add(node);
        found.push({ url: node, kind: guessKind(node, undefined, keyHint) });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, keyHint));
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.url === "string" && !seen.has(obj.url)) {
        seen.add(obj.url);
        const ct = typeof obj.content_type === "string" ? obj.content_type : undefined;
        found.push({ url: obj.url, kind: guessKind(obj.url, ct, keyHint), contentType: ct });
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === "seed" || k === "timings" || k === "has_nsfw_concepts" || k === "logs") continue;
        visit(v, k);
      }
    }
  };
  visit(response, "output");
  return found;
}
