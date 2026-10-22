import "server-only";
import { Worker } from "node:worker_threads";
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { getModel } from "@/lib/catalog";
import { cueText, parseCues, toSrt, type Cue } from "@/lib/cues";
import type { GenInput, ModelRoute, Operation } from "@/lib/catalog/types";
import { engineMode, getSetting } from "../settings";
import { toDataUri } from "../storage";
import { comfyProvider } from "./comfyui";
import type { PollResult, ProviderAdapter, RemoteOutput } from "./types";

/**
 * The "llm" provider: text steps (translate, write) run inside this server on the LLM the
 * install is set up with — Claude when an Anthropic key is set (and the install isn't open
 * source only), else a local Ollama. Route endpoint "ollama" (the open model) never uses Claude;
 * when Ollama isn't running, its translations run on ComfyUI instead (Qwen3.5 4B through the
 * translate-qwen35-textgen workflow, one prompt per batch of lines, so cue timing is kept the same way).
 * Jobs run in the background of this process and are polled like any provider; a restart
 * loses a job that was still writing (it fails as interrupted and can be retried).
 */

type Backend = "claude" | "ollama" | "comfyui";

/** The ComfyUI model and workflow open-source translations fall back to without Ollama. */
export const COMFY_TRANSLATE_MODEL = "oss-qwen35-translate";

/** A text output: the words in `text`, the same words saved as a file (.txt, or .srt for timed text). */
export type TextOutput = RemoteOutput & { text: string; meta?: Record<string, unknown> };

export function textOutput(text: string, cues?: Cue[] | null, meta: Record<string, unknown> = {}): TextOutput {
  if (cues?.length) {
    return { url: toDataUri(Buffer.from(toSrt(cues)), "application/x-subrip"), kind: "text", contentType: "application/x-subrip", text, meta: { ...meta, cues } };
  }
  return { url: toDataUri(Buffer.from(text), "text/plain"), kind: "text", contentType: "text/plain", text, ...(Object.keys(meta).length && { meta }) };
}

// ---------------------------------------------------------------------------
// Which LLM

declare global {
  var __fuobeOllamaReach: { ok: boolean; at: number; url: string } | undefined;
  var __fuobeLlmJobs: Map<string, LlmJob> | undefined;
}

const ollamaUrl = () => getSetting("ollamaUrl").replace(/\/+$/, "");
const PROBE_MS = 15_000;

/** Is Ollama answering? Cached for 15 s; routing reads the cached answer (see llmBackends). */
export async function probeOllama(force = false): Promise<boolean> {
  const cur = globalThis.__fuobeOllamaReach;
  const url = ollamaUrl();
  if (!force && cur && cur.url === url && Date.now() - cur.at < PROBE_MS) return cur.ok;
  const ok = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false);
  globalThis.__fuobeOllamaReach = { ok, at: Date.now(), url };
  return ok;
}

const PROBE_WORKER = `const { workerData } = require("node:worker_threads");
const flag = new Int32Array(workerData.sab);
fetch(workerData.url, { signal: AbortSignal.timeout(workerData.timeout) })
  .then((r) => Atomics.store(flag, 0, r.ok ? 1 : 2), () => Atomics.store(flag, 0, 2))
  .finally(() => Atomics.notify(flag, 0));`;

/** Blocking check (a few ms for a refused port, at most `timeoutMs` for a host that doesn't answer). */
function probeOllamaSync(url: string, timeoutMs = 1500): boolean {
  let ok = false;
  try {
    const sab = new SharedArrayBuffer(4);
    const flag = new Int32Array(sab);
    const worker = new Worker(PROBE_WORKER, { eval: true, workerData: { sab, url: `${url}/api/tags`, timeout: timeoutMs } });
    Atomics.wait(flag, 0, 0, timeoutMs + 1000);
    ok = Atomics.load(flag, 0) === 1;
    void worker.terminate();
  } catch {}
  globalThis.__fuobeOllamaReach = { ok, at: Date.now(), url };
  return ok;
}

/**
 * Routing is synchronous, so it reads the cached answer, refreshed in the background. The first
 * check for an address (right after boot, or after the Ollama URL changes in Settings) waits for a
 * real answer instead: a translate posted then must not fall back to demo text while Ollama is up.
 */
function ollamaReady(): boolean {
  const cur = globalThis.__fuobeOllamaReach;
  const url = ollamaUrl();
  if (!cur || cur.url !== url) return probeOllamaSync(url);
  if (Date.now() - cur.at > PROBE_MS) void probeOllama();
  return cur.ok;
}

/** A route, or the part of one that decides its LLMs (the op: only translations fall back to ComfyUI). */
type LlmRoute = Pick<ModelRoute, "endpoint"> & { op?: Operation };

/**
 * The LLMs a route may use right now, in the order they're tried. Follows Settings → AI helper
 * ("none" turns text steps off; "ollama" never calls Claude) and the engine mode. An open-source
 * translation with no Ollama answering runs on ComfyUI when that answers.
 */
export function llmBackends(route: LlmRoute): Backend[] {
  const choice = getSetting("enhanceProvider");
  if (choice === "none") return [];
  const out: Backend[] = [];
  const claude = route.endpoint !== "ollama" && !!getSetting("anthropicKey") && (choice === "anthropic" || (choice === "auto" && engineMode() !== "open"));
  if (claude) out.push("claude");
  if ((route.endpoint === "ollama" || choice !== "anthropic") && ollamaReady()) out.push("ollama");
  else if (route.endpoint === "ollama" && route.op === "translate" && comfyProvider.isConfigured()) out.push("comfyui");
  return out;
}

/** What to tell the user when no LLM can run a route (demo mode off). */
export const llmMissing = (route: LlmRoute) =>
  route.endpoint !== "ollama"
    ? "Connect Claude or Ollama in Settings to run this model"
    : route.op === "translate"
      ? "Connect Ollama, or start ComfyUI with Qwen3.5 4B, in Settings to translate on your own machine"
      : "Connect Ollama in Settings to run this model (open-source text runs on your own machine)";

/** Claude is the one that costs money. */
export const llmUsesClaude = (route: Pick<ModelRoute, "endpoint">) => llmBackends(route)[0] === "claude";

// ---------------------------------------------------------------------------
// Calls

const BACKEND_LABEL: Record<Backend, string> = { claude: "Claude", ollama: "Ollama", comfyui: "Qwen3.5 on ComfyUI" };

async function viaClaude(system: string, user: string, signal: AbortSignal): Promise<string> {
  const client = new Anthropic({ apiKey: getSetting("anthropicKey") });
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = (await client.beta.messages.create(
      {
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: user }],
      } as Parameters<typeof client.beta.messages.create>[0] & { fallbacks: string },
      { signal },
    )) as Anthropic.Beta.BetaMessage;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Your Anthropic API key was rejected. Check it in Settings → API keys.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Claude is rate-limited right now. Try again in a minute.");
    if (e instanceof Anthropic.APIError) throw new Error(`Claude returned an error (${e.status ?? "network"}): ${e.message}`);
    throw e;
  }
  if (res.stop_reason === "refusal") throw new Error("Claude declined this text");
  if (res.stop_reason === "max_tokens") throw new Error("That text is too long for one pass — split it and try again");
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text");
  return text;
}

async function viaOllama(system: string, user: string, signal: AbortSignal): Promise<string> {
  const url = ollamaUrl();
  const model = getSetting("ollamaModel");
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      options: { num_ctx: 16384 },
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
  }).catch((e: Error) => {
    if (signal.aborted) throw e;
    throw new Error(`Couldn't reach Ollama at ${url} (${e.message}). Is it running?`);
  });
  if (res.status === 404) throw new Error(`Ollama doesn't have ${model} yet — run \`ollama pull ${model}\``);
  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { message?: { content?: string } };
  const text = (j.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new Error("Ollama returned no text");
  return text;
}

const COMFY_POLL_MS = 500;
/** One answer may take this long on ComfyUI (a GPU busy with other jobs queues it). */
const COMFY_ANSWER_MS = 15 * 60_000;

/**
 * One answer from Qwen3.5 4B inside ComfyUI: the system prompt is the workflow's instruction and the
 * user text follows it (TextGenerate reads them as one message). Submitted and polled like any
 * ComfyUI job; canceling the text step cancels the prompt.
 */
async function viaComfy(system: string, user: string, signal: AbortSignal): Promise<string> {
  const model = getModel(COMFY_TRANSLATE_MODEL);
  const route = model?.routes.find((r) => r.provider === "comfyui");
  if (!model || !route) throw new Error("The ComfyUI translate workflow is missing from the catalog");
  // Room for a long chunk of plain text (~8k characters) translated in one go.
  const { externalId, meta = {} } = await comfyProvider.submit({ generationId: `llm_${nanoid(8)}`, model, route, input: { prompt: user, extra: { instruction: `${system}\n\n`, maxTokens: 4096 } } });
  const ctx = { externalId, meta, route, model, createdAt: Date.now() };
  const stop = () => void comfyProvider.cancel?.(ctx).catch(() => {});
  signal.addEventListener("abort", stop, { once: true });
  try {
    let misses = 0;
    for (const end = Date.now() + COMFY_ANSWER_MS; Date.now() < end; ) {
      await new Promise((r) => setTimeout(r, COMFY_POLL_MS));
      if (signal.aborted) throw new Error("Canceled");
      let r: PollResult;
      try {
        r = await comfyProvider.poll(ctx);
        misses = 0;
      } catch (e) {
        // A proxy hiccup: ask again, a few times.
        if (++misses >= 5) throw new Error(`ComfyUI stopped answering (${(e as Error).message})`);
        continue;
      }
      if (r.state === "failed") throw new Error(`ComfyUI couldn't translate: ${r.error}`);
      if (r.state !== "succeeded") continue;
      const out = r.outputs.find((o) => o.kind === "text");
      // SaveText hands the words back with the file; read the file when they're missing.
      const raw = out?.text ?? (out ? await (await fetch(out.url, { headers: out.headers, signal })).text() : "");
      const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!text) throw new Error("ComfyUI returned no text");
      return text;
    }
    stop();
    throw new Error("ComfyUI took too long to translate");
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

const CALL: Record<Backend, (system: string, user: string, signal: AbortSignal) => Promise<string>> = { claude: viaClaude, ollama: viaOllama, comfyui: viaComfy };

/** Ask the first backend; if it fails, the next (Claude → Ollama). Throws the first error when all fail. */
async function complete(backends: Backend[], system: string, user: string, job: LlmJob): Promise<string> {
  let first: Error | null = null;
  for (const b of backends) {
    try {
      job.backend = b;
      return await CALL[b](system, user, job.abort.signal);
    } catch (e) {
      if (job.abort.signal.aborted) throw e;
      first ??= e as Error;
    }
  }
  throw first ?? new Error(llmMissing({ endpoint: "auto" }));
}

// ---------------------------------------------------------------------------
// Translate and write

const translateSystem = (lang: string, from?: string) => `You are a professional translator. Translate the user's text ${from ? `from ${from} ` : ""}into ${lang}.
- Keep the meaning, tone, register, names, numbers and formatting (line breaks, lists, markdown).
- Reply with the translation only: no notes, no quotes around it, no explanations.`;

const cuesSystem = (lang: string, from?: string) => `You translate subtitles ${from ? `from ${from} ` : ""}into ${lang}.
The user sends numbered subtitle lines like "[3] text". Translate each line on its own and reply with every number, in order, one line each: "[3] translation".
- Never merge, split, skip or reorder lines; keep "<br>" where it appears.
- Keep each line about as short as the original so it still reads as a subtitle.
- Reply with the numbered lines only.`;

const WRITE_SYSTEM = `You are a writer for a video and image studio: scripts, voice-overs, captions, shot lists, hooks and ad copy.
- Follow the brief: length, format, tone, audience and language.
- Write words meant to be spoken as natural speech, with no stage directions unless asked.
- Reply with the text only: no preamble, no notes, no quotes around it.`;

const CUE_BATCH = 30;
/** When a model merges or drops numbered lines, the batch is retried in pieces this size, then cue by cue. */
const CUE_RETRY = 10;
const CHUNK_CHARS = 8000;

/** Plain text in pieces that fit one call: paragraphs grouped up to ~8k characters. */
function chunks(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of text.split(/\n{2,}/)) {
    if (cur && cur.length + p.length + 2 > CHUNK_CHARS) {
      out.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** "[n] text" answers back into the batch's order; null if any line is missing. */
function readNumbered(answer: string, from: number, count: number): string[] | null {
  const got = new Map<number, string>();
  for (const line of answer.split("\n")) {
    const m = /^\s*\[(\d+)\]\s*(.*)$/.exec(line);
    if (m) got.set(Number(m[1]), m[2].trim());
  }
  const out = Array.from({ length: count }, (_, i) => got.get(from + i));
  return out.every((x) => x !== undefined && x !== "") ? (out as string[]) : null;
}

/** Run `f` over `items` with at most `limit` calls in flight, keeping the order. */
async function pool<T, R>(items: T[], limit: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export interface TranslateCuesOptions {
  /** Requests in flight at once for cue-by-cue translation (1 for Ollama, which serves one at a time). */
  concurrency?: number;
  onProgress?: (done: number) => void;
}

/**
 * Translate subtitles in numbered batches, keeping each cue's timing. A batch whose answer has lines
 * merged or missing (small local models do this) is retried in smaller numbered pieces (30 → 10),
 * and only then cue by cue, a few at a time: a local model queues parallel requests behind each
 * other, and each request's timeout runs from when it was sent.
 */
export async function translateCues(cues: Cue[], lang: string, from: string | undefined, ask: (system: string, user: string) => Promise<string>, opts: TranslateCuesOptions = {}): Promise<Cue[]> {
  const numbered = async (batch: Cue[], first: number): Promise<string[] | null> =>
    readNumbered(await ask(cuesSystem(lang, from), batch.map((c, k) => `[${first + k}] ${c.text.trim().replace(/\n/g, " <br> ")}`).join("\n")), first, batch.length);
  const run = async (batch: Cue[], first: number, size: number): Promise<string[]> => {
    const lines = await numbered(batch, first);
    if (lines) return lines;
    if (size > CUE_RETRY && batch.length > CUE_RETRY) {
      const out: string[] = [];
      for (let k = 0; k < batch.length; k += CUE_RETRY) out.push(...(await run(batch.slice(k, k + CUE_RETRY), first + k, CUE_RETRY)));
      return out;
    }
    return pool(batch, opts.concurrency ?? 1, (c) => ask(translateSystem(lang, from), c.text));
  };
  const out: Cue[] = [];
  for (let i = 0; i < cues.length; i += CUE_BATCH) {
    const batch = cues.slice(i, i + CUE_BATCH);
    const lines = await run(batch, i + 1, CUE_BATCH);
    batch.forEach((c, k) => out.push({ start: c.start, end: c.end, text: lines[k].replace(/\s*<br>\s*/gi, "\n").trim() }));
    opts.onProgress?.(out.length);
  }
  return out;
}

interface LlmJob {
  state: "running" | "succeeded" | "failed";
  progress?: number;
  backend?: Backend;
  outputs?: RemoteOutput[];
  error?: string;
  abort: AbortController;
  at: number;
}

const jobs = (): Map<string, LlmJob> => (globalThis.__fuobeLlmJobs ??= new Map<string, LlmJob>());

async function runJob(op: string, input: GenInput, backends: Backend[], job: LlmJob): Promise<RemoteOutput[]> {
  const ask = (system: string, user: string) => complete(backends, system, user, job);
  const source = (input.prompt ?? "").trim();
  if (op === "write") {
    const custom = typeof input.extra?.system === "string" ? input.extra.system.trim() : "";
    if (!source) throw new Error("Write a brief first");
    return [textOutput(await ask(custom || WRITE_SYSTEM, source), null, { op: "write" })];
  }
  if (op !== "translate") throw new Error(`The LLM can't do ${op}`);
  const lang = input.targetLanguage ?? (typeof input.extra?.targetLanguage === "string" ? input.extra.targetLanguage : "");
  if (!lang) throw new Error("Pick a language to translate into");
  if (!source) throw new Error("Nothing to translate");
  const from = input.sourceLanguage;
  const cues = parseCues(source);
  if (cues) {
    // Claude takes a few cues at once; Ollama works through requests one by one.
    const translated = await translateCues(cues, lang, from, ask, { concurrency: backends[0] === "claude" ? 4 : 1, onProgress: (done) => (job.progress = Math.min(0.95, done / cues.length)) });
    return [textOutput(cueText(translated), translated, { language: lang })];
  }
  const parts = chunks(source);
  const done: string[] = [];
  for (const p of parts) {
    done.push(await ask(translateSystem(lang, from), p));
    job.progress = Math.min(0.95, done.length / parts.length);
  }
  return [textOutput(done.join("\n\n"), null, { language: lang })];
}

export const llmProvider: ProviderAdapter = {
  id: "llm",
  label: "Claude or Ollama",
  isConfigured: () => llmBackends({ endpoint: "auto" }).length > 0,

  // Text steps read their text from the prompt; files aren't sent anywhere.
  async prepareFile(_data, _contentType, name) {
    return `local:${name}`;
  },

  async submit({ route, input }) {
    const backends = llmBackends(route);
    if (!backends.length) throw new Error(llmMissing(route));
    const all = jobs();
    for (const [id, j] of all) if (Date.now() - j.at > 6 * 3_600_000) all.delete(id);
    const id = `llm_${nanoid(10)}`;
    const job: LlmJob = { state: "running", abort: new AbortController(), at: Date.now(), backend: backends[0] };
    all.set(id, job);
    runJob(route.op, input, backends, job).then(
      (outputs) => Object.assign(job, { state: "succeeded", outputs }),
      (e: Error) => Object.assign(job, { state: "failed", error: e.message || "The LLM failed" }),
    );
    return { externalId: id, meta: { backends }, payload: { op: route.op, backends, targetLanguage: input.targetLanguage, chars: input.prompt?.length ?? 0 } };
  },

  async poll({ externalId }) {
    const job = jobs().get(externalId);
    if (!job) return { state: "failed", error: "Interrupted — the server restarted while this was being written. Try again." };
    if (job.state === "running") return { state: "running", progress: job.progress, message: `Writing with ${BACKEND_LABEL[job.backend ?? "claude"]}` };
    jobs().delete(externalId);
    return job.state === "succeeded" ? { state: "succeeded", outputs: job.outputs ?? [] } : { state: "failed", error: job.error ?? "The LLM failed" };
  },

  async cancel({ externalId }) {
    jobs().get(externalId)?.abort.abort();
    jobs().delete(externalId);
  },

  async test() {
    await probeOllama(true);
    const b = llmBackends({ endpoint: "auto" });
    return b.length ? { ok: true, detail: `Text steps run on ${b.map((x) => BACKEND_LABEL[x]).join(", then ")}` } : { ok: false, detail: "Add an Anthropic key or start Ollama" };
  },
};
