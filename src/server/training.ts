import "server-only";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ElementLora, StudioElement } from "@/lib/catalog/elements";
import { aiToolkitJob, getTrainingTarget, trainingCaption, triggerFor, type TrainingTarget } from "@/lib/catalog/training";
import { DATA_DIR, db } from "./db";
import { getElement, updateElement } from "./elements";
import { falFetch, falProvider } from "./providers/fal";
import { hfFetch, hfUpload, higgsfieldKey } from "./providers/higgsfield";
import { ProviderError } from "./providers/types";
import { getSetting } from "./settings";
import { readRef } from "./storage";
import { zip } from "./zip";

/**
 * Identity training (Soul ID parity): Higgsfield custom references, fal's Z-Image LoRA trainer,
 * or AI-Toolkit on your own GPU. Jobs are polled by the same background runner as generations.
 */
export interface Training {
  id: string;
  elementId: string;
  target: string;
  provider: TrainingTarget["provider"];
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number | null;
  message: string | null;
  trigger: string | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

interface Row {
  id: string;
  element_id: string;
  target: string;
  provider: Training["provider"];
  status: Training["status"];
  progress: number | null;
  message: string | null;
  external_id: string | null;
  meta_json: string | null;
  trigger_word: string | null;
  error: string | null;
  cost_usd: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

const toTraining = (r: Row): Training => ({
  id: r.id,
  elementId: r.element_id,
  target: r.target,
  provider: r.provider,
  status: r.status,
  progress: r.progress,
  message: r.message,
  trigger: r.trigger_word,
  error: r.error,
  createdAt: r.created_at,
  completedAt: r.completed_at,
});

function update(id: string, fields: Partial<Row>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE trainings SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`)
    .run({ ...fields, __now: Date.now(), __id: id });
}

export function listTrainings(elementId?: string): Training[] {
  const rows = elementId
    ? db().prepare("SELECT * FROM trainings WHERE element_id = ? ORDER BY created_at DESC").all(elementId)
    : db().prepare("SELECT * FROM trainings ORDER BY created_at DESC LIMIT 100").all();
  return (rows as Row[]).map(toTraining);
}

/** Can this target run here right now? Returns the reason it can't, or null. */
export function trainingBlocker(t: TrainingTarget): string | null {
  if (t.provider === "higgsfield" && !higgsfieldKey()) return "Add a Higgsfield API key in Settings";
  if (t.provider === "fal" && !getSetting("falKey")) return "Add a fal.ai key in Settings";
  if (t.provider === "ai-toolkit" && !getSetting("aiToolkitUrl")) return "Set your AI-Toolkit URL in Settings (or download the training kit)";
  return null;
}

export function startTraining(elementId: string, targetId: string): Training {
  const el = getElement(elementId);
  const target = getTrainingTarget(targetId);
  if (!el) throw new Error("Element not found");
  if (!target) throw new Error("Unknown training target");
  if (el.kind === "voice") throw new Error("Voices don't need training — they're cloned from the sample");
  const images = el.references.filter((r) => !/\.(wav|mp3|ogg|flac|m4a|webm)$/i.test(r));
  if (images.length < target.minImages) throw new Error(`Add at least ${target.minImages} photos of ${el.name} first (you have ${images.length})`);
  const blocker = trainingBlocker(target);
  if (blocker) throw new Error(blocker);
  if (db().prepare("SELECT 1 FROM trainings WHERE element_id = ? AND target = ? AND status IN ('queued','running')").get(elementId, targetId)) {
    throw new Error(`${el.name} is already training for ${target.name}`);
  }
  const now = Date.now();
  const row: Row = {
    id: nanoid(12),
    element_id: elementId,
    target: targetId,
    provider: target.provider,
    status: "queued",
    progress: null,
    message: "Preparing photos",
    external_id: null,
    meta_json: null,
    trigger_word: target.provider === "higgsfield" ? null : triggerFor(el.handle),
    error: null,
    cost_usd: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  db()
    .prepare(`INSERT INTO trainings (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  updateElement(elementId, { status: "training" });
  submittingTrainings().add(row.id);
  void submit(row.id, el, target, row.trigger_word ?? "", images)
    .catch((e) => fail(row.id, el.id, (e as Error).message))
    .finally(() => submittingTrainings().delete(row.id));
  return toTraining(row);
}

/** Trainings this process is still uploading (shared across hot reloads). */
declare global {
  var __fuobeTrainingSubmits: Set<string> | undefined;
}
const submittingTrainings = (): Set<string> => (globalThis.__fuobeTrainingSubmits ??= new Set<string>());

/** The longest a training may run before it's given up on. */
const MAX_TRAINING_MS = 8 * 3_600_000;
/** A queued training this old that nothing is uploading was cut off by a restart. */
const STALE_TRAINING_MS = 2 * 60 * 1000;

function fail(id: string, elementId: string, error: string) {
  update(id, { status: "failed", error, message: null, completed_at: Date.now() });
  settleElement(elementId);
}

/** The element is "training" while any job runs, else "ready". */
function settleElement(elementId: string) {
  const busy = db().prepare("SELECT 1 FROM trainings WHERE element_id = ? AND status IN ('queued','running')").get(elementId);
  updateElement(elementId, { status: busy ? "training" : "ready" });
}

function addIdentity(elementId: string, loras: ElementLora[]) {
  const el = getElement(elementId);
  if (!el) return;
  // A retrain replaces the previous identity for the same model.
  const kept = el.loras.filter((l) => !loras.some((n) => n.modelId === l.modelId));
  updateElement(elementId, { loras: [...kept, ...loras] });
}

/** Photos + one caption per photo: "photo of <trigger>, <description>". */
async function dataset(el: StudioElement, trigger: string, images: string[]) {
  const caption = trainingCaption(el.kind === "style" ? "style" : "character", trigger, el.description);
  const files: { name: string; data: Buffer }[] = [];
  for (const [i, ref] of images.entries()) {
    const f = await readRef(ref);
    const ext = f.contentType === "image/png" ? "png" : f.contentType === "image/webp" ? "webp" : "jpg";
    const base = `${String(i + 1).padStart(2, "0")}`;
    files.push({ name: `${base}.${ext}`, data: f.data }, { name: `${base}.txt`, data: Buffer.from(caption) });
  }
  return { files, caption };
}

async function aitk(pathname: string, init: RequestInit = {}) {
  const base = getSetting("aiToolkitUrl").replace(/\/$/, "");
  const token = getSetting("aiToolkitToken");
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ProviderError(`AI-Toolkit ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, res.status);
  return body as Record<string, unknown>;
}

async function submit(id: string, el: StudioElement, t: TrainingTarget, trigger: string, images: string[]) {
  if (t.provider === "higgsfield") {
    update(id, { message: `Uploading ${images.length} photos` });
    const urls: string[] = [];
    for (const ref of images) {
      const f = await readRef(ref);
      urls.push(await hfUpload(f.data, f.contentType));
    }
    const res = (await hfFetch("v1/custom-references", {
      method: "POST",
      body: JSON.stringify({
        name: el.name.slice(0, 100),
        model_version: t.id === "soul-id-cinema" ? "cinema" : "v2",
        input_images: urls.map((u) => ({ type: "image_url", image_url: u })),
      }),
    })) as { id: string; status?: string };
    update(id, { external_id: res.id, status: "running", message: "Training on Higgsfield" });
    return;
  }

  if (t.provider === "fal") {
    const { files, caption } = await dataset(el, trigger, images);
    update(id, { message: "Uploading the dataset" });
    const zipUrl = await falProvider.prepareFile(zip(files), "application/zip", "dataset.zip");
    const res = (await falFetch("https://queue.fal.run/fal-ai/z-image-turbo-trainer-v2", {
      method: "POST",
      body: JSON.stringify({ image_data_url: zipUrl, steps: 1000, default_caption: caption }),
    })) as { request_id: string; status_url: string; response_url: string };
    update(id, {
      external_id: res.request_id,
      meta_json: JSON.stringify({ statusUrl: res.status_url, responseUrl: res.response_url }),
      status: "running",
      message: "Queued on fal",
      cost_usd: 0.85,
    });
    return;
  }

  // AI-Toolkit: write the dataset where the trainer can read it, then create and start a job.
  const root = getSetting("aiToolkitDatasetDir") || path.join(DATA_DIR, "datasets");
  const folder = path.join(root, `fuobe-${el.id}-${id}`);
  const { files } = await dataset(el, trigger, images);
  fs.mkdirSync(folder, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(folder, f.name), f.data);
  const name = `fuobe_${el.handle.toLowerCase()}_${id.slice(0, 6)}`.replace(/[^a-z0-9_]/g, "_");
  const job = aiToolkitJob({ name, trigger, datasetFolder: folder, outputFolder: path.join(root, "output"), kind: el.kind === "style" ? "style" : "character" });
  const created = await aitk("/api/jobs", { method: "POST", body: JSON.stringify({ name, gpu_ids: "0", job_config: job }) });
  const jobId = String(created.id);
  await aitk(`/api/jobs/${jobId}/start`);
  update(id, { external_id: jobId, meta_json: JSON.stringify({ name }), status: "running", message: "Queued on AI-Toolkit" });
}

// ---------------------------------------------------------------------------
// Polling (called from the generation runner's tick)

/** A provider answer that won't change by asking again: the job failed or is gone (not auth, timeouts or rate limits). */
const permanent = (e: unknown) => e instanceof ProviderError && e.status !== undefined && e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status);

export async function pollTrainings(): Promise<void> {
  // Trainings a restart cut off mid-upload never reach the trainer: fail them so the element can retrain.
  const stale = db()
    .prepare("SELECT * FROM trainings WHERE status = 'queued' AND external_id IS NULL AND created_at < ?")
    .all(Date.now() - STALE_TRAINING_MS) as Row[];
  for (const r of stale) if (!submittingTrainings().has(r.id)) fail(r.id, r.element_id, "Interrupted before it reached the trainer — start it again");
  const rows = db().prepare("SELECT * FROM trainings WHERE status = 'running' AND external_id IS NOT NULL").all() as Row[];
  await Promise.all(
    rows.map((r) =>
      pollOne(r).catch((e) => {
        if (permanent(e)) return fail(r.id, r.element_id, (e as Error).message);
        update(r.id, { message: `Checking status failed: ${(e as Error).message}` });
      }),
    ),
  );
}

async function pollOne(r: Row) {
  const t = getTrainingTarget(r.target);
  if (!t) return fail(r.id, r.element_id, `Unknown training target ${r.target}`);
  if (Date.now() - r.created_at > MAX_TRAINING_MS) return fail(r.id, r.element_id, `Training didn't finish within ${MAX_TRAINING_MS / 3_600_000} hours`);
  const meta = JSON.parse(r.meta_json ?? "{}") as Record<string, string>;
  if (r.provider === "higgsfield") {
    const ref = (await hfFetch(`v1/custom-references/${r.external_id}`)) as { status: string; fail_reason?: string };
    if (ref.status === "completed") {
      addIdentity(r.element_id, t.modelIds.map((modelId) => ({ engine: "cloud", modelId, file: "", trigger: "", referenceId: r.external_id!, strength: 0.9 })));
      return done(r);
    }
    if (ref.status === "failed") return fail(r.id, r.element_id, ref.fail_reason || "Higgsfield couldn't train this character");
    update(r.id, { message: ref.status === "in_progress" ? "Training on Higgsfield" : "In Higgsfield's queue" });
    return;
  }
  if (r.provider === "fal") {
    const s = (await falFetch(`${meta.statusUrl}?logs=1`)) as { status: string; logs?: { message: string }[]; error?: string };
    if (s.error) return fail(r.id, r.element_id, `fal couldn't train this: ${s.error}`);
    if (s.status === "FAILED" || s.status === "ERROR" || s.status === "CANCELLED") return fail(r.id, r.element_id, `fal training ${s.status.toLowerCase()}`);
    if (s.status !== "COMPLETED") {
      const last = s.logs?.at(-1)?.message;
      const step = last && /(\d+)\s*\/\s*(\d+)/.exec(last);
      update(r.id, { progress: step ? Number(step[1]) / Number(step[2]) : r.progress, message: s.status === "IN_QUEUE" ? "In fal's queue" : (last ?? "Training") });
      return;
    }
    const out = (await falFetch(meta.responseUrl)) as { diffusers_lora_file?: { url: string }; lora_file?: { url: string } };
    const url = out.diffusers_lora_file?.url ?? out.lora_file?.url;
    if (!url) return fail(r.id, r.element_id, `No LoRA in fal's response: ${JSON.stringify(out).slice(0, 200)}`);
    addIdentity(r.element_id, t.modelIds.map((modelId) => ({ engine: "cloud", modelId, file: "", url, trigger: r.trigger_word!, strength: 1 })));
    return done(r);
  }
  // AI-Toolkit
  const res = await aitk(`/api/jobs?id=${encodeURIComponent(r.external_id!)}`);
  const job = ((res.job ?? res) as Record<string, unknown>) ?? {};
  const status = String(job.status ?? "");
  if (status === "error" || status === "stopped") return fail(r.id, r.element_id, String(job.info ?? `AI-Toolkit job ${status}`));
  if (status !== "completed") {
    const step = Number(job.step ?? 0);
    const total = Number(job.total_steps ?? 0);
    update(r.id, { progress: total ? step / total : null, message: status === "running" ? `Training · step ${step}/${total || "?"}` : "Waiting for the GPU" });
    return;
  }
  const filesRes = await aitk(`/api/jobs/${r.external_id}/files`);
  const files = ((filesRes.files ?? []) as { path: string }[]).map((f) => f.path).filter((p) => p.endsWith(".safetensors")).sort();
  const latest = files.at(-1);
  if (!latest) return fail(r.id, r.element_id, "AI-Toolkit finished but saved no .safetensors file");
  const el = getElement(r.element_id);
  const file = `fuobe/${(el?.handle ?? r.element_id).toLowerCase()}.safetensors`;
  const lorasDir = getSetting("comfyLorasDir");
  let message: string | null = null;
  if (lorasDir && fs.existsSync(latest)) {
    fs.mkdirSync(path.join(lorasDir, "fuobe"), { recursive: true });
    fs.copyFileSync(latest, path.join(lorasDir, file));
  } else {
    message = `Copy ${latest} to ComfyUI/models/loras/${file}`;
  }
  addIdentity(r.element_id, t.modelIds.map((modelId) => ({ engine: "open", modelId, file, trigger: r.trigger_word!, strength: 1 })));
  return done(r, message);
}

function done(r: Row, message: string | null = null) {
  update(r.id, { status: "succeeded", progress: 1, message, completed_at: Date.now() });
  settleElement(r.element_id);
}

// ---------------------------------------------------------------------------
// Download kit for training anywhere (AI-Toolkit CLI)

export async function trainingKit(elementId: string): Promise<{ name: string; data: Buffer }> {
  const el = getElement(elementId);
  if (!el) throw new Error("Element not found");
  const images = el.references.filter((r) => !/\.(wav|mp3|ogg|flac|m4a|webm)$/i.test(r));
  if (!images.length) throw new Error("Add photos first");
  const trigger = triggerFor(el.handle);
  const { files } = await dataset(el, trigger, images);
  const name = `fuobe_${el.handle.toLowerCase()}`.replace(/[^a-z0-9_]/g, "_");
  const job = aiToolkitJob({ name, trigger, datasetFolder: "./dataset", outputFolder: "./output", kind: el.kind === "style" ? "style" : "character" });
  const readme = `# Train ${el.name} with AI-Toolkit

1. Install AI-Toolkit: https://github.com/ostris/ai-toolkit (24 GB GPU recommended)
2. Unzip this kit next to it and run:

       python run.py ${name}.yaml

3. Copy the newest file from ./output/${name}/*.safetensors to ComfyUI/models/loras/fuobe/${el.handle.toLowerCase()}.safetensors
4. In Fuobe, open ${el.name} → Train → "I trained it myself" and enter that file name.

Trigger word: ${trigger} — Fuobe adds it to the prompt whenever you @${el.handle} on Z-Image Turbo (open source).
`;
  return {
    name: `${name}-training-kit.zip`,
    // JSON is valid YAML, so AI-Toolkit reads the config as-is.
    data: zip([
      ...files.map((f) => ({ name: `dataset/${f.name}`, data: f.data })),
      { name: `${name}.yaml`, data: Buffer.from(JSON.stringify(job, null, 2)) },
      { name: "README.md", data: Buffer.from(readme) },
    ]),
  };
}

/** Register a LoRA trained elsewhere (already in ComfyUI/models/loras). */
export function attachLora(elementId: string, input: { file: string; trigger: string; modelId: string }) {
  const file = input.file.trim().replace(/^\/+/, "");
  if (!/\.safetensors$/.test(file) || file.includes("..")) throw new Error("Enter the LoRA's file name inside ComfyUI/models/loras, ending in .safetensors");
  addIdentity(elementId, [{ engine: "open", modelId: input.modelId, file, trigger: input.trigger.trim(), strength: 1 }]);
}
