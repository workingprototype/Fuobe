import "server-only";
import { buildPayload, extractOutputs } from "@/lib/catalog/payload";
import type { Operation } from "@/lib/catalog/types";
import { getSetting } from "../settings";
import { ProviderError, type ProviderAdapter, type RemoteOutput } from "./types";

/**
 * Higgsfield's pay-per-use API (docs.higgsfield.ai, see docs/research/higgsfield-api.md).
 *   submit:  POST https://api.higgsfield.ai/<endpoint>   flat JSON → { request_id, status_url, cancel_url }
 *   status:  GET  <status_url>                            → { status: queued|in_progress|completed|failed|nsfw|canceled, images[], video }
 *   cancel:  POST <cancel_url>                            (only while queued)
 *   upload:  POST /files/generate-upload-url → PUT bytes with the returned headers → public_url
 * Auth is `Authorization: Key <id>:<secret>`.
 */
const API = "https://api.higgsfield.ai";

/** Same env names the official SDKs read. */
export function higgsfieldKey(): string {
  const k = getSetting("higgsfieldKey") || process.env.HF_KEY || "";
  if (k) return k;
  return process.env.HF_API_KEY && process.env.HF_API_SECRET ? `${process.env.HF_API_KEY}:${process.env.HF_API_SECRET}` : "";
}

function describe(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 400);
  const d = (body as { detail?: unknown; error?: unknown })?.detail ?? (body as { error?: unknown })?.error ?? body;
  if (Array.isArray(d)) return d.map((e: { loc?: unknown[]; msg?: string }) => `${(e.loc ?? []).slice(1).join(".")}: ${e.msg ?? JSON.stringify(e)}`).join("; ");
  return typeof d === "string" ? d : JSON.stringify(d).slice(0, 400);
}

const HINTS: Record<number, string> = {
  401: "Higgsfield rejected the API key — check Settings (format: KEY_ID:KEY_SECRET)",
  403: "Not enough Higgsfield balance — top up at console.higgsfield.ai",
  423: "Higgsfield has temporarily blocked this model — try again later or pick another one",
  503: "Higgsfield has disabled this model for now",
};

export async function hfFetch(pathOrUrl: string, init: RequestInit = {}): Promise<unknown> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}/${pathOrUrl.replace(/^\//, "")}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${higgsfieldKey()}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const hint = HINTS[res.status];
    throw new ProviderError(hint ? `${hint} (${describe(body)})` : `Higgsfield ${res.status}: ${describe(body)}`, res.status);
  }
  return body;
}

const UPLOAD_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "audio/wav", "audio/x-wav", "video/mp4"]);

/** Upload bytes through Higgsfield's signed-URL flow and return the public URL models accept. */
export async function hfUpload(data: Buffer, contentType: string): Promise<string> {
  if (!UPLOAD_TYPES.has(contentType)) {
    throw new Error(`Higgsfield only accepts JPEG, PNG, WebP, GIF, WAV and MP4 files — this one is ${contentType}`);
  }
  const slot = (await hfFetch("files/generate-upload-url", { method: "POST", body: JSON.stringify({ content_type: contentType }) })) as {
    public_url: string;
    upload_url: string;
    upload_headers?: Record<string, string>;
  };
  const put = await fetch(slot.upload_url, { method: "PUT", body: new Uint8Array(data), headers: slot.upload_headers ?? { "Content-Type": contentType } });
  if (!put.ok) throw new Error(`Higgsfield upload failed (${put.status})`);
  return slot.public_url;
}

/** RequestStatus fields that hold results (docs/research/higgsfield-api.json → lifecycle.status.outputs). */
const MEDIA_FIELDS = ["images", "image", "video", "videos", "audio", "audios"] as const;
/** Extra artifacts some video/3D jobs attach; kept as links on the first output, not shown as media. */
const ARTIFACT_FIELDS = ["zip", "mov", "jsx", "fbx", "ply"] as const;

/**
 * The outputs of a completed RequestStatus. The body also carries status_url and cancel_url (API links,
 * not results), so only the documented media fields are read.
 */
export function higgsfieldOutputs(status: Record<string, unknown>, op?: Operation): RemoteOutput[] {
  const media = Object.fromEntries(MEDIA_FIELDS.filter((k) => status[k] != null).map((k) => [k, status[k]]));
  const outputs: RemoteOutput[] = extractOutputs(media, op);
  const artifacts = Object.fromEntries(
    ARTIFACT_FIELDS.flatMap((k) => {
      const v = status[k] as { url?: unknown } | string | undefined;
      const url = typeof v === "string" ? v : typeof v?.url === "string" ? v.url : undefined;
      return url ? [[k, url]] : [];
    }),
  );
  if (outputs.length && Object.keys(artifacts).length) outputs[0] = { ...outputs[0], meta: { ...outputs[0].meta, artifacts } };
  return outputs;
}

export const higgsfieldProvider: ProviderAdapter = {
  id: "higgsfield",
  label: "Higgsfield",
  isConfigured: () => !!higgsfieldKey(),

  prepareFile: (data, contentType) => hfUpload(data, contentType),

  async submit({ route, input, generationId }) {
    const payload = buildPayload(route.map ?? {}, input);
    const res = (await hfFetch(route.endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
      // A retried submit of the same generation is never billed twice.
      headers: { "Idempotency-Key": `fuobe-${generationId}` },
    })) as { request_id: string; status_url?: string; cancel_url?: string };
    return {
      externalId: res.request_id,
      meta: { statusUrl: res.status_url ?? `${API}/requests/${res.request_id}/status`, cancelUrl: res.cancel_url ?? `${API}/requests/${res.request_id}/cancel` },
      payload,
    };
  },

  async poll({ meta, route }) {
    const s = (await hfFetch(meta.statusUrl as string)) as { status: string; error?: string | null } & Record<string, unknown>;
    switch (s.status) {
      case "queued":
        return { state: "queued", message: "In queue" };
      case "in_progress":
        return { state: "running", message: "Generating" };
      case "completed": {
        const outputs = higgsfieldOutputs(s, route?.op);
        return outputs.length ? { state: "succeeded", outputs } : { state: "failed", error: `No media in response: ${JSON.stringify(s).slice(0, 300)}` };
      }
      case "nsfw":
        return { state: "failed", error: "Higgsfield's moderation blocked this prompt or result (not charged)" };
      case "canceled":
        return { state: "failed", error: "Canceled on Higgsfield" };
      case "failed":
        return { state: "failed", error: s.error || "Higgsfield couldn't generate this (not charged)" };
      default:
        return { state: "running", message: s.status };
    }
  },

  async cancel({ meta }) {
    if (meta.cancelUrl) await hfFetch(meta.cancelUrl as string, { method: "POST" }).catch(() => {});
  },

  async test() {
    if (!higgsfieldKey()) return { ok: false, detail: "No key set" };
    if (!higgsfieldKey().includes(":")) return { ok: false, detail: "Use the KEY_ID:KEY_SECRET format from console.higgsfield.ai" };
    try {
      await hfFetch("v1/custom-references/list?page=1&page_size=1");
      return { ok: true, detail: "Key accepted" };
    } catch (e) {
      const status = (e as ProviderError).status;
      return status === 401 ? { ok: false, detail: "Key rejected (401)" } : { ok: true, detail: `Key accepted (list returned ${status ?? "an error"})` };
    }
  },
};

// ---------------------------------------------------------------------------
// Style / template lists shown in the composer

export interface HiggsfieldPreset {
  id: string;
  name: string;
  preview?: string;
  group?: string;
}

const PRESET_SOURCES: Record<string, string> = {
  "soul-v1": "v1/text2image/soul-styles",
  "soul-v2": "v1/text2image/soul-styles/v2",
  "genjutsu-restyle": "models/higgsfield/genjutsu/restyle/v1.0/presets",
  "marketing-studio": "marketing-studio/image/presets?size=200&cursor=0",
};

const cache = new Map<string, { at: number; items: HiggsfieldPreset[] }>();

export async function higgsfieldPresets(source: string): Promise<HiggsfieldPreset[]> {
  const path = PRESET_SOURCES[source];
  if (!path) throw new Error(`Unknown preset list ${source}`);
  const hit = cache.get(source);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.items;
  const body = (await hfFetch(path)) as unknown;
  const raw = (Array.isArray(body) ? body : ((body as { items?: unknown[] }).items ?? [])) as Record<string, unknown>[];
  const items = raw.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? r.id),
    preview: (r.preview_url ?? r.cover_image) as string | undefined,
    group: ((r.metadata as { group_name?: string } | undefined)?.group_name ?? (r.type as string | undefined)) || undefined,
  }));
  cache.set(source, { at: Date.now(), items });
  return items;
}
