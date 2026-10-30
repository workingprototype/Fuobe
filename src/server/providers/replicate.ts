import "server-only";
import { loraEndpointFor } from "@/lib/catalog/loras";
import { buildPayload, extractOutputs, noOutputsError } from "@/lib/catalog/payload";
import { getSetting } from "../settings";
import { toDataUri } from "../storage";
import { ProviderError, type ProviderAdapter } from "./types";

/**
 * Replicate predictions API.
 *   POST /v1/models/{owner}/{name}/predictions  { input }   (official models)
 *   POST /v1/predictions { version, input }                  (endpoint "owner/name:version")
 *   GET  /v1/predictions/{id}  → { status: starting|processing|succeeded|failed|canceled, output, error, logs }
 *   POST /v1/predictions/{id}/cancel
 */
const API = "https://api.replicate.com/v1";

function token(): string {
  return getSetting("replicateToken");
}

async function rFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const b = body as { detail?: string; title?: string };
    throw new ProviderError(`replicate ${res.status}: ${b?.detail ?? b?.title ?? String(text).slice(0, 300)}`, res.status);
  }
  return body;
}

export const replicateProvider: ProviderAdapter = {
  id: "replicate",
  label: "Replicate",
  isConfigured: () => !!token(),

  async prepareFile(data, contentType, name) {
    if (data.length < 1_000_000) return toDataUri(data, contentType);
    const form = new FormData();
    form.append("content", new Blob([new Uint8Array(data)], { type: contentType }), name);
    const file = (await rFetch(`${API}/files`, { method: "POST", body: form })) as { urls: { get: string } };
    return file.urls.get;
  },

  async submit({ route, input }) {
    const payload = buildPayload(route.map ?? {}, input);
    // LoRAs go in the route's own fields (lora_weights[] / one per Wan 2.2 expert) or its LoRA model.
    let endpoint: string;
    try {
      endpoint = loraEndpointFor(route, input.loras);
    } catch (e) {
      throw new ProviderError((e as Error).message);
    }
    const [slug, version] = endpoint.split(":");
    const res = (await (version
      ? rFetch(`${API}/predictions`, { method: "POST", body: JSON.stringify({ version, input: payload }) })
      : rFetch(`${API}/models/${slug}/predictions`, { method: "POST", body: JSON.stringify({ input: payload }) }))) as {
      id: string;
    };
    return { externalId: res.id, payload };
  },

  async poll({ externalId, route }) {
    const p = (await rFetch(`${API}/predictions/${externalId}`)) as {
      status: string;
      output: unknown;
      error?: string;
      logs?: string;
    };
    if (p.status === "starting") return { state: "queued", message: "Starting" };
    if (p.status === "processing") {
      const last = p.logs?.trim().split("\n").at(-1);
      const pct = last ? /(\d{1,3})%/.exec(last)?.[1] : undefined;
      return { state: "running", progress: pct ? Number(pct) / 100 : undefined, message: last ?? "Processing" };
    }
    if (p.status === "succeeded") {
      // Object outputs (Scribe's {text, words}) are read as the result itself; URL lists keep their order (layers).
      const outputs = extractOutputs({ output: p.output }, route?.op);
      if (!outputs.length) return { state: "failed", error: noOutputsError({ output: p.output }) };
      return { state: "succeeded", outputs };
    }
    return { state: "failed", error: p.error ?? p.status };
  },

  async cancel({ externalId }) {
    await rFetch(`${API}/predictions/${externalId}/cancel`, { method: "POST" }).catch(() => {});
  },

  async test() {
    if (!token()) return { ok: false, detail: "No token set" };
    try {
      const a = (await rFetch(`${API}/account`)) as { username?: string };
      return { ok: true, detail: `Signed in as ${a.username ?? "unknown"}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },
};
