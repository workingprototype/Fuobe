import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { getModel } from "@/lib/catalog";
import { cueText, parseCues, toSrt, type Cue } from "@/lib/cues";
import type { GenInput, ModelRoute, Operation } from "@/lib/catalog/types";
import { engineMode, getSetting } from "../settings";
import { toDataUri } from "../storage";
import { comfyProvider } from "./comfyui";
import { ask, checkReach, reachSync, runningCheck, sharedCheck, takesConnection, within, type Reach } from "./reach";
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
  /** Reachability of Ollama, the models it listed when it last answered, when it last answered, and when a longer look last went unanswered (./reach). */
  var __fuobeOllamaReach: (Reach & { models?: string[] }) | undefined;
  var __fuobeLlmJobs: Map<string, LlmJob> | undefined;
}

const ollamaUrl = () => getSetting("ollamaUrl").replace(/\/+$/, "");
const PROBE_MS = 15_000;

/** What GET /api/tags got: an answer (with the names of the models pulled), a no, or nothing in time. */
function askOllama(url: string, timeoutMs: number) {
  return ask<string[]>(`${url}/api/tags`, timeoutMs, {
    read: async (r) => {
      const models = ((await r.json()) as { models?: { name?: unknown }[] } | null)?.models;
      return Array.isArray(models) ? models.map((m) => (typeof m?.name === "string" ? m.name : "")).filter(Boolean).slice(0, 50) : undefined;
    },
  });
}

/**
 * Is Ollama answering GET /api/tags? By the busy-vs-down rules ComfyUI has (./reach): a refused port or an HTTP
 * error is down at once; no answer in time is busy when it answered lately, else it gets the longer look when its
 * port takes a connection. Cached for 15 s (`force` checks now); one check runs at a time. Routing reads the cached
 * answer (see llmBackends), and so does Assist (with the models). A busy Ollama keeps the models it last listed.
 */
export async function probeOllama(force = false): Promise<boolean> {
  const cur = globalThis.__fuobeOllamaReach;
  const url = ollamaUrl();
  if (!force && cur && cur.url === url && Date.now() - cur.at < PROBE_MS) return cur.ok;
  return sharedCheck("ollama", url, async () => {
    const prev = globalThis.__fuobeOllamaReach?.url === url ? globalThis.__fuobeOllamaReach : undefined;
    const { reach, asked } = await checkReach(url, prev, (ms) => askOllama(url, ms));
    const models = (asked.answer === "yes" ? asked.value : undefined) ?? prev?.models;
    // The address may have changed while this ran: the new one's check speaks for it.
    if (url === ollamaUrl()) globalThis.__fuobeOllamaReach = reach.ok && models ? { ...reach, models } : reach;
    return reach.ok;
  });
}

/** The models the reachable Ollama listed when it last answered ([] when it's down, or no check has read them yet). */
export function ollamaModels(): string[] {
  const cur = globalThis.__fuobeOllamaReach;
  return cur?.ok && cur.url === ollamaUrl() ? (cur.models ?? []) : [];
}

/** How long a person's question (Assist) waits for what the last check of Ollama doesn't say yet. */
const SOON_MS = 1500;

/**
 * Is Ollama answering, for a person waiting on the answer (Assist's panel, a chat's mode)? What the last check found,
 * as routing reads it (ollamaReady): a stale answer is refreshed in the background, not waited on. It waits, at most
 * `waitMs`, only for what nothing has said yet: the first check of an address, or the models a check under way is
 * reading for a reachable Ollama. A first check still going then (no answer yet) counts an Ollama whose port took the
 * connection as busy for now, so reachable, as routing's blocking check does; the check goes on to say for sure.
 */
export async function ollamaSoon(waitMs = SOON_MS): Promise<boolean> {
  const url = ollamaUrl();
  const known = globalThis.__fuobeOllamaReach?.url === url ? globalThis.__fuobeOllamaReach : undefined;
  if (known) {
    if (Date.now() - known.at > PROBE_MS) void probeOllama().catch(() => false);
    const reading = known.ok && !known.models ? runningCheck("ollama", url) : undefined;
    if (reading) await within(reading, waitMs);
    const now = globalThis.__fuobeOllamaReach;
    return now?.url === url ? now.ok : known.ok;
  }
  const port = takesConnection(url, waitMs);
  return (await within(probeOllama().catch(() => false), waitMs)) ?? (await port);
}

/**
 * Blocking check (reachSync): a few ms for an Ollama that answers or a refused port, at most `timeoutMs` otherwise.
 * One that takes the connection but doesn't answer in time is busy for now, and probeOllama goes on in the background
 * to say for sure. One that answers gets a background check too: this one can't read the models it has (Assist lists them).
 */
function probeOllamaSync(url: string, timeoutMs = 1500): boolean {
  const { reach, sure } = reachSync(url, `${url}/api/tags`, timeoutMs);
  globalThis.__fuobeOllamaReach = reach;
  if (!sure || reach.ok) void probeOllama(true).catch(() => false);
  return reach.ok;
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
  if (Date.now() - cur.at > PROBE_MS) void probeOllama().catch(() => false);
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

/** Is the Anthropic key accepted? Listing one model costs nothing. */
async function testClaude(): Promise<{ ok: boolean; detail: string }> {
  try {
    await new Anthropic({ apiKey: getSetting("anthropicKey") }).models.list({ limit: 1 }, { timeout: 15_000, maxRetries: 0 });
    return { ok: true, detail: "Claude key accepted" };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, detail: "Anthropic rejected the key (401)" };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, detail: "That Anthropic key can't use the API (403)" };
    if (e instanceof Anthropic.APIError && e.status) return { ok: false, detail: `Anthropic answered ${e.status}: ${e.message}` };
    return { ok: false, detail: `Can't reach Anthropic (${(e as Error).message})` };
  }
}

/** Does Ollama answer, and has it pulled the model Settings names? */
async function testOllama(): Promise<{ ok: boolean; detail: string }> {
  const model = getSetting("ollamaModel");
  try {
    const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, detail: `Ollama answered HTTP ${res.status}` };
    const names = (((await res.json()) as { models?: { name?: string }[] }).models ?? []).map((m) => m.name ?? "");
    const has = names.some((n) => n === model || n === `${model}:latest` || n.split(":")[0] === model);
    return has ? { ok: true, detail: `Ollama · ${model} ready` } : { ok: false, detail: `Ollama answers, but ${model} isn't pulled — run: ollama pull ${model}` };
  } catch (e) {
    return { ok: false, detail: `Can't reach Ollama at ${ollamaUrl()} (${(e as Error).message})` };
  }
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

  /**
   * Checks each LLM text steps would use: Claude's key (a free model list call) and that Ollama has
   * its model. Checking the Anthropic key itself (focus) always asks Anthropic, also when text steps
   * run on Ollama (Open source only, or the Enhancer set to Ollama): Assist can still use the key.
   * Checking Ollama's address or model asks Ollama.
   */
  async test(opts) {
    if (opts?.focus === "anthropicKey") {
      if (!getSetting("anthropicKey")) return { ok: false, detail: "No Anthropic key set" };
      const claude = await testClaude();
      // A good key that text steps don't use: say where they run, so green doesn't read as "Claude rewrites prompts".
      const choice = getSetting("enhanceProvider");
      let elsewhere: string | null = null;
      if (choice === "none") elsewhere = "text steps are off (Enhancer: Offline rewriter)";
      else if (choice === "ollama") elsewhere = "text steps use Ollama (Enhancer)";
      else if (choice === "auto" && engineMode() === "open") elsewhere = "Open source only mode keeps text steps on Ollama";
      return claude.ok && elsewhere ? { ok: true, detail: `${claude.detail} · ${elsewhere}` } : claude;
    }
    if (opts?.focus === "ollamaUrl" || opts?.focus === "ollamaModel") return testOllama();
    if (getSetting("enhanceProvider") === "none") return { ok: false, detail: "Text steps are off (Enhancer: Offline rewriter)" };
    await probeOllama(true);
    const b = llmBackends({ endpoint: "auto" });
    if (!b.length) {
      return { ok: false, detail: engineMode() === "open" && getSetting("anthropicKey") ? `Open source only mode skips Claude, and Ollama doesn't answer at ${ollamaUrl()}` : `Add an Anthropic key, or start Ollama (nothing answers at ${ollamaUrl()})` };
    }
    const checks = await Promise.all(b.map((x) => (x === "claude" ? testClaude() : x === "ollama" ? testOllama() : Promise.resolve({ ok: true, detail: BACKEND_LABEL[x] }))));
    const detail = checks.map((c) => c.detail).join(" · ");
    // Fine when the first one works (the rest are fallbacks); otherwise say what failed.
    return { ok: checks[0].ok, detail: b.length > 1 && checks[0].ok ? `Text steps run on ${b.map((x) => BACKEND_LABEL[x]).join(", then ")} · ${detail}` : detail };
  },
};
