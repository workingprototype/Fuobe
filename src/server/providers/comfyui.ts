import "server-only";
import fs from "node:fs";
import path from "node:path";
import { tracksFor, type MotionPaths } from "@/lib/motion-paths";
import { nanoid } from "nanoid";
import {
  applyBindings,
  computeDimensions,
  computeFrames,
  explainComfyError,
  injectLoras,
  randomSeed,
  type BindingKey,
  type ComfyWorkflow,
  type Manifest,
  type ManifestWorkflow,
} from "@/lib/comfy";
import { guessKind } from "@/lib/catalog/payload";
import { getSetting } from "../settings";
import { ProviderError, type ProviderAdapter, type RemoteOutput } from "./types";

export const WORKFLOW_DIR = path.join(process.cwd(), "workflows", "comfyui");

let manifestCache: { mtime: number; manifest: Manifest } | null = null;

export function loadManifest(): Manifest {
  const file = path.join(WORKFLOW_DIR, "manifest.json");
  if (!fs.existsSync(file)) return { version: 1, generatedAt: "", workflows: [] };
  const mtime = fs.statSync(file).mtimeMs;
  if (!manifestCache || manifestCache.mtime !== mtime) {
    manifestCache = { mtime, manifest: JSON.parse(fs.readFileSync(file, "utf8")) as Manifest };
  }
  return manifestCache.manifest;
}

export function getWorkflow(id: string): { manifest: ManifestWorkflow; workflow: ComfyWorkflow } {
  const manifest = loadManifest().workflows.find((w) => w.id === id);
  if (!manifest) throw new ProviderError(`Workflow "${id}" is not in workflows/comfyui/manifest.json`);
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, manifest.file), "utf8")) as ComfyWorkflow;
  return { manifest, workflow };
}

function baseUrl(): string {
  return getSetting("comfyUrl").replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const t = getSetting("comfyToken");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function comfyFetch(p: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${baseUrl()}${p}`, { ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  } catch (e) {
    throw new ProviderError(`Can't reach ComfyUI at ${baseUrl()} (${(e as Error).message}). Is it running?`);
  }
}

// ---------------------------------------------------------------------------
// Live progress over the ComfyUI websocket (one connection per server URL).

interface Progress {
  value: number;
  max: number;
  node?: string;
  nodesDone: number;
}

declare global {
  var __fuobeComfyWs: { url: string; ws: WebSocket; clientId: string; progress: Map<string, Progress> } | undefined;
}

function ensureSocket(): { clientId: string; progress: Map<string, Progress> } {
  const url = baseUrl();
  const cur = globalThis.__fuobeComfyWs;
  if (cur && cur.url === url && cur.ws.readyState <= 1) return cur;
  const clientId = cur?.clientId ?? `fuobe-${nanoid(8)}`;
  const progress = cur?.progress ?? new Map<string, Progress>();
  try {
    const ws = new WebSocket(`${url.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return; // binary preview frames
      try {
        const msg = JSON.parse(ev.data) as { type: string; data: Record<string, unknown> };
        const pid = msg.data?.prompt_id as string | undefined;
        if (!pid) return;
        const p = progress.get(pid) ?? { value: 0, max: 0, nodesDone: 0 };
        if (msg.type === "progress") {
          p.value = Number(msg.data.value);
          p.max = Number(msg.data.max);
          p.node = String(msg.data.node ?? p.node ?? "");
        } else if (msg.type === "executing") {
          if (msg.data.node) {
            p.node = String(msg.data.node);
            p.nodesDone += 1;
            p.value = 0;
            p.max = 0;
          }
        }
        progress.set(pid, p);
      } catch {}
    };
    ws.onerror = () => {};
    globalThis.__fuobeComfyWs = { url, ws, clientId, progress };
  } catch {
    globalThis.__fuobeComfyWs = undefined;
  }
  return { clientId, progress };
}

// ---------------------------------------------------------------------------

type HistoryFile = { filename: string; subfolder: string; type: string };
type HistoryEntry = {
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, Record<string, unknown>>;
};

function collectFiles(entry: HistoryEntry, manifest: ManifestWorkflow | undefined): RemoteOutput[] {
  const outputs = entry.outputs ?? {};
  const preferred = new Set(manifest?.outputs.map((o) => o.node) ?? []);
  const nodeIds = Object.keys(outputs);
  const ordered = [...nodeIds.filter((n) => preferred.has(n)), ...nodeIds.filter((n) => !preferred.has(n))];
  const files: RemoteOutput[] = [];
  const pick = (type: string) => {
    for (const nodeId of ordered) {
      const ui = outputs[nodeId];
      for (const [key, val] of Object.entries(ui)) {
        if (!Array.isArray(val)) continue;
        for (const f of val as HistoryFile[]) {
          if (!f || typeof f !== "object" || typeof f.filename !== "string" || f.type !== type) continue;
          const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type });
          const declared = manifest?.outputs.find((o) => o.node === nodeId)?.kind;
          files.push({
            url: `${baseUrl()}/view?${qs}`,
            kind: declared ?? guessKind(f.filename, undefined, key === "gifs" || key === "videos" ? "video" : key),
            headers: authHeaders(),
          });
        }
      }
    }
  };
  pick("output");
  if (!files.length) pick("temp");
  // If the manifest declares output nodes, drop intermediate saves from other nodes when we have declared ones.
  return files;
}

// Reachability is probed in the background so routing (which is synchronous) can fall back
// to demo output when no ComfyUI server is up.
declare global {
  var __fuobeComfyReach: { ok: boolean; at: number; url: string } | undefined;
}

export async function probeComfy(force = false): Promise<boolean> {
  const cur = globalThis.__fuobeComfyReach;
  if (!force && cur && cur.url === baseUrl() && Date.now() - cur.at < 10_000) return cur.ok;
  let ok = false;
  try {
    const r = await fetch(`${baseUrl()}/system_stats`, { headers: authHeaders(), signal: AbortSignal.timeout(2000) });
    ok = r.ok;
  } catch {}
  globalThis.__fuobeComfyReach = { ok, at: Date.now(), url: baseUrl() };
  return ok;
}

export const comfyProvider: ProviderAdapter = {
  id: "comfyui",
  label: "ComfyUI",
  isConfigured: () => {
    const cur = globalThis.__fuobeComfyReach;
    if (!cur || cur.url !== baseUrl() || Date.now() - cur.at > 10_000) void probeComfy();
    return !!cur && cur.url === baseUrl() && cur.ok;
  },

  async prepareFile(data, contentType, name) {
    const form = new FormData();
    const ext = name.includes(".") ? name.split(".").pop() : contentType.split("/")[1];
    form.append("image", new Blob([new Uint8Array(data)], { type: contentType }), `fuobe_${nanoid(8)}.${ext}`);
    form.append("type", "input");
    form.append("overwrite", "true");
    const res = await comfyFetch("/upload/image", { method: "POST", body: form });
    if (!res.ok) throw new ProviderError(`ComfyUI upload failed: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { name: string; subfolder?: string };
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  },

  async submit({ route, input, generationId }) {
    // "video-concat-{n}": one workflow per clip count.
    const clips = input.videos ?? [];
    const endpoint = route.endpoint.replace("{n}", String(Math.max(2, Math.min(4, clips.length))));
    if (route.endpoint.includes("{n}") && clips.length > 4) throw new ProviderError("ComfyUI joins up to 4 clips at a time");
    const { manifest, workflow } = getWorkflow(endpoint);
    const d = manifest.defaults;
    const images = input.images ?? [];
    const values: Partial<Record<BindingKey, unknown>> = {
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      image: images[0],
      image2: images[1],
      image3: images[2],
      image4: images[3],
      endImage: input.endImage,
      mask: input.mask,
      video: input.video ?? clips[0],
      video2: clips[1],
      video3: clips[2],
      video4: clips[3],
      audio: input.audio,
      seed: input.seed !== undefined && input.seed >= 0 ? input.seed : randomSeed(),
    };
    // Voice workflows: "audio" is the voice to speak with (TTS), speaker A (dialogue) or the speech to convert
    // (voice change, whose target voice is "audio2").
    if (route.op === "tts") values.audio = input.voiceAudio ?? input.audio;
    if (route.op === "dialogue") {
      values.audio = input.voiceAudio;
      values.audio2 = input.voiceAudio2;
      values.prompt = (input.dialogue ?? []).filter((l) => l.text.trim()).map((l) => `SPEAKER ${l.voice === "B" ? "B" : "A"}: ${l.text.trim()}`).join("\n");
    }
    if (route.op === "voice-change") values.audio2 = input.voiceAudio;
    if (manifest.bindings.language && input.targetLanguage) values.language = input.targetLanguage;
    if (manifest.bindings.width || manifest.bindings.height) {
      const multiple = Number(manifest.limits?.dimensionMultiple ?? 16);
      // With motion paths the frame keeps the start image's shape, so the paths need no cropping.
      const srcAspect = (input.extra?.motionPaths as MotionPaths | undefined)?.aspect;
      const dims = computeDimensions(
        srcAspect ? `${srcAspect[0]}:${srcAspect[1]}` : input.aspectRatio === "auto" ? undefined : input.aspectRatio,
        input.resolution,
        { width: Number(d.width ?? 1024), height: Number(d.height ?? 1024) },
        multiple,
      );
      // Respect the workflow's size limits while keeping the aspect ratio.
      const maxW = Number(manifest.limits?.maxWidth ?? Infinity);
      const maxH = Number(manifest.limits?.maxHeight ?? Infinity);
      const k = Math.min(1, maxW / dims.width, maxH / dims.height);
      values.width = Math.max(multiple, Math.floor((dims.width * k) / multiple) * multiple);
      values.height = Math.max(multiple, Math.floor((dims.height * k) / multiple) * multiple);
    }
    if (manifest.bindings.frames && input.duration) {
      const fps = Number(d.fps ?? 16);
      values.frames = computeFrames(input.duration, fps, Number(d.frameStep ?? 4), manifest.limits?.maxFrames);
    }
    // Drawn motion paths (normalised to the start frame) → one pixel point per output frame (Wan-Move).
    const extra = { ...(input.extra ?? {}) };
    const paths = extra.motionPaths as MotionPaths | undefined;
    delete extra.motionPaths;
    if (manifest.bindings.tracks && paths?.paths.length) {
      const frames = Number(values.frames ?? d.frames ?? 81);
      values.tracks = JSON.stringify(tracksFor(paths, Number(values.width ?? d.width ?? 832), Number(values.height ?? d.height ?? 480), frames));
    }
    if (manifest.bindings.duration && input.duration) values.duration = input.duration;
    if (manifest.bindings.tags && !manifest.bindings.prompt) values.tags = input.prompt;
    if (manifest.bindings.filenamePrefix) values.filenamePrefix = `fuobe/${generationId}`;
    for (const [k, v] of Object.entries(extra)) values[k as BindingKey] = v;

    const bound = applyBindings(workflow, manifest.bindings, values);
    const missing = bound.missing;
    let wf = bound.workflow;
    if (missing.length) throw new ProviderError(`Workflow ${manifest.id} bindings point at missing nodes: ${missing.join(", ")}`);
    if (input.loras?.length) wf = injectLoras(wf, input.loras);

    const { clientId } = ensureSocket();
    const res = await comfyFetch("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: wf, client_id: clientId }),
    });
    const body = (await res.json().catch(() => ({}))) as { prompt_id?: string; error?: { message?: string }; node_errors?: unknown };
    if (!res.ok || !body.prompt_id) {
      const detail = body.node_errors && Object.keys(body.node_errors as object).length ? explainComfyError(body.node_errors, { ...manifest, models: [...manifest.models, ...(input.loras ?? []).map((l) => ({ file: l.file, folder: "loras", url: l.url }))] }) : body.error?.message;
      throw new ProviderError(detail ?? `ComfyUI /prompt failed (${res.status})`, res.status);
    }
    return { externalId: body.prompt_id, meta: { workflowId: manifest.id, nodeCount: Object.keys(wf).length }, payload: wf };
  },

  async poll({ externalId, meta }) {
    const histRes = await comfyFetch(`/history/${externalId}`);
    if (!histRes.ok) throw new ProviderError(`ComfyUI history ${histRes.status}`);
    const hist = (await histRes.json()) as Record<string, HistoryEntry>;
    const entry = hist[externalId];
    if (entry?.status?.completed || entry?.status?.status_str === "success") {
      let manifest: ManifestWorkflow | undefined;
      try {
        manifest = getWorkflow(String(meta.workflowId)).manifest;
      } catch {}
      const outputs = collectFiles(entry, manifest);
      if (!outputs.length) return { state: "failed", error: "Workflow finished without saving any output" };
      return { state: "succeeded", outputs };
    }
    if (entry?.status?.status_str === "error") {
      const err = entry.status.messages?.find(([t]) => t === "execution_error")?.[1] as
        | { exception_message?: string; node_type?: string }
        | undefined;
      return { state: "failed", error: err ? `${err.node_type}: ${err.exception_message}` : "Execution error" };
    }
    // Still queued or running.
    const { progress } = ensureSocket();
    const p = progress.get(externalId);
    const queueRes = await comfyFetch("/queue");
    const queue = (await queueRes.json().catch(() => ({}))) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
    const running = queue.queue_running?.some((q) => q[1] === externalId);
    const pendingIdx = queue.queue_pending?.findIndex((q) => q[1] === externalId) ?? -1;
    if (!running && pendingIdx < 0 && !entry) {
      return { state: "failed", error: "Prompt disappeared from the ComfyUI queue (server restarted or job was cleared)" };
    }
    if (pendingIdx >= 0) return { state: "queued", message: `In ComfyUI queue · position ${pendingIdx + 1}` };
    const total = Number(meta.nodeCount ?? 0);
    const stepFrac = p && p.max ? p.value / p.max : 0;
    const progressValue = total ? Math.min(0.99, ((p?.nodesDone ?? 0) - 1 + stepFrac) / total) : stepFrac || undefined;
    return {
      state: "running",
      progress: progressValue && progressValue > 0 ? progressValue : undefined,
      message: p?.max ? `Sampling ${p.value}/${p.max}` : "Running on ComfyUI",
    };
  },

  async cancel({ externalId }) {
    await comfyFetch("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [externalId] }),
    }).catch(() => {});
    const q = (await (await comfyFetch("/queue")).json().catch(() => ({}))) as { queue_running?: unknown[][] };
    if (q.queue_running?.some((r) => r[1] === externalId)) {
      await comfyFetch("/interrupt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: externalId }),
      }).catch(() => {});
    }
  },

  async test() {
    try {
      const res = await comfyFetch("/system_stats");
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const s = (await res.json()) as { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] };
      const dev = s.devices?.[0];
      return {
        ok: true,
        detail: `ComfyUI ${s.system?.comfyui_version ?? ""} · ${dev?.name ?? "unknown device"}${dev?.vram_total ? ` · ${(dev.vram_total / 2 ** 30).toFixed(0)} GB` : ""}`,
      };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },
};

/** Which manifest models are present on the connected ComfyUI server. */
export async function modelInventory(): Promise<Record<string, string[]> | null> {
  try {
    const listed = await comfyFetch("/models");
    const folders = listed.ok ? ((await listed.json()) as string[]) : ["diffusion_models", "checkpoints", "text_encoders", "vae", "loras"];
    const out: Record<string, string[]> = {};
    await Promise.all(
      folders.map(async (f) => {
        const r = await comfyFetch(`/models/${f}`);
        out[f] = r.ok ? ((await r.json()) as string[]) : [];
      }),
    );
    return out;
  } catch {
    return null;
  }
}
