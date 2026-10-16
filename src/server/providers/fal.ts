import "server-only";
import { createFalClient } from "@fal-ai/client";
import { buildPayload, extractMedia } from "@/lib/catalog/payload";
import { getSetting } from "../settings";
import { ProviderError, type ProviderAdapter } from "./types";

/**
 * fal.ai queue API.
 *   submit: POST https://queue.fal.run/<endpoint>            → { request_id, status_url, response_url, cancel_url }
 *   status: GET  <status_url>?logs=1                          → { status: IN_QUEUE | IN_PROGRESS | COMPLETED, logs }
 *   result: GET  <response_url>                               → model output (or { detail } on failure)
 *   cancel: PUT  <cancel_url>
 * We always use the URLs returned at submit time: for nested endpoint ids
 * (fal-ai/kling-video/v2.5-turbo/pro/image-to-video) the status/result paths drop the sub-path.
 */
const QUEUE = "https://queue.fal.run";

function key(): string {
  return getSetting("falKey");
}

async function falFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${key()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    throw new ProviderError(`fal ${res.status}: ${describeError(body)}`, res.status);
  }
  return body;
}

function describeError(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 500);
  const b = body as { detail?: unknown; error?: unknown; message?: unknown };
  const d = b.detail ?? b.error ?? b.message ?? body;
  if (Array.isArray(d)) {
    return d
      .map((e: { loc?: unknown[]; msg?: string }) => `${(e.loc ?? []).join(".")}: ${e.msg ?? JSON.stringify(e)}`)
      .join("; ");
  }
  return typeof d === "string" ? d : JSON.stringify(d).slice(0, 500);
}

export const falProvider: ProviderAdapter = {
  id: "fal",
  label: "fal.ai",
  isConfigured: () => !!key(),

  async prepareFile(data, contentType) {
    const client = createFalClient({ credentials: key() });
    return client.storage.upload(new Blob([new Uint8Array(data)], { type: contentType }));
  },

  async submit({ route, input }) {
    const payload = buildPayload(route.map ?? {}, input);
    const res = (await falFetch(`${QUEUE}/${route.endpoint}`, {
      method: "POST",
      body: JSON.stringify(payload),
    })) as { request_id: string; status_url: string; response_url: string; cancel_url: string };
    return {
      externalId: res.request_id,
      meta: { statusUrl: res.status_url, responseUrl: res.response_url, cancelUrl: res.cancel_url },
      payload,
    };
  },

  async poll({ meta }) {
    const status = (await falFetch(`${meta.statusUrl as string}?logs=1`)) as {
      status: string;
      queue_position?: number;
      logs?: { message: string }[];
      error?: string;
    };
    if (status.status === "IN_QUEUE") {
      return { state: "queued", message: status.queue_position != null ? `In queue · position ${status.queue_position + 1}` : "In queue" };
    }
    if (status.status === "IN_PROGRESS") {
      const last = status.logs?.at(-1)?.message;
      const pct = last ? /(\d{1,3})%/.exec(last)?.[1] : undefined;
      return { state: "running", progress: pct ? Number(pct) / 100 : undefined, message: last ?? "Generating" };
    }
    if (status.status === "COMPLETED") {
      if (status.error) return { state: "failed", error: status.error };
      try {
        const result = await falFetch(meta.responseUrl as string);
        const outputs = extractMedia(result);
        if (!outputs.length) return { state: "failed", error: `No media in response: ${JSON.stringify(result).slice(0, 300)}` };
        // Seedance draft mode: keep the id that finishes this take at 1080p.
        const draftId = /"draft_id"\s*:\s*"([^"]+)"/.exec(JSON.stringify(result))?.[1];
        return { state: "succeeded", outputs: draftId ? outputs.map((o) => ({ ...o, draftId })) : outputs };
      } catch (e) {
        return { state: "failed", error: (e as Error).message };
      }
    }
    return { state: "running", message: status.status };
  },

  async cancel({ meta }) {
    if (meta.cancelUrl) await falFetch(meta.cancelUrl as string, { method: "PUT" }).catch(() => {});
  },

  async test() {
    if (!key()) return { ok: false, detail: "No key set" };
    // Status lookup of a bogus request id: 401/403 means bad key, 404/422 means the key works.
    const res = await fetch(`${QUEUE}/fal-ai/flux/dev/requests/00000000-0000-0000-0000-000000000000/status`, {
      headers: { Authorization: `Key ${key()}` },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, detail: `Key rejected (${res.status})` };
    return { ok: true, detail: "Key accepted" };
  },
};
