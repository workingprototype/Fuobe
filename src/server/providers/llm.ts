import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { cueText, parseCues, toSrt, type Cue } from "@/lib/cues";
import type { GenInput, ModelRoute } from "@/lib/catalog/types";
import { engineMode, getSetting } from "../settings";
import { toDataUri } from "../storage";
import type { ProviderAdapter, RemoteOutput } from "./types";

/**
 * The "llm" provider: text steps (translate, write) run inside this server on the LLM the
 * install is set up with — Claude when an Anthropic key is set (and the install isn't open
 * source only), else a local Ollama. Route endpoint "ollama" (the open model) never uses Claude.
 * Jobs run in the background of this process and are polled like any provider; a restart
 * loses a job that was still writing (it fails as interrupted and can be retried).
 */

type Backend = "claude" | "ollama";

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

function ollamaReady(): boolean {
  const cur = globalThis.__fuobeOllamaReach;
  const url = ollamaUrl();
  if (!cur || cur.url !== url || Date.now() - cur.at > PROBE_MS) void probeOllama();
  return !!cur && cur.url === url && cur.ok;
}

/**
 * The LLMs a route may use right now, in the order they're tried. Follows Settings → AI helper
 * ("none" turns text steps off; "ollama" never calls Claude) and the engine mode.
 */
export function llmBackends(route: Pick<ModelRoute, "endpoint">): Backend[] {
  const choice = getSetting("enhanceProvider");
  if (choice === "none") return [];
  const out: Backend[] = [];
  const claude = route.endpoint !== "ollama" && !!getSetting("anthropicKey") && (choice === "anthropic" || (choice === "auto" && engineMode() !== "open"));
  if (claude) out.push("claude");
  if ((route.endpoint === "ollama" || choice !== "anthropic") && ollamaReady()) out.push("ollama");
  return out;
}

/** What to tell the user when no LLM can run a route (demo mode off). */
export const llmMissing = (route: Pick<ModelRoute, "endpoint">) =>
  route.endpoint === "ollama" ? "Connect Ollama in Settings to run this model (open-source text runs on your own machine)" : "Connect Claude or Ollama in Settings to run this model";

/** Claude is the one that costs money. */
export const llmUsesClaude = (route: Pick<ModelRoute, "endpoint">) => llmBackends(route)[0] === "claude";

// ---------------------------------------------------------------------------
// Calls

const BACKEND_LABEL: Record<Backend, string> = { claude: "Claude", ollama: "Ollama" };

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

/** Ask the first backend; if it fails, the next (Claude → Ollama). Throws the first error when all fail. */
async function complete(backends: Backend[], system: string, user: string, job: LlmJob): Promise<string> {
  let first: Error | null = null;
  for (const b of backends) {
    try {
      job.backend = b;
      return await (b === "claude" ? viaClaude : viaOllama)(system, user, job.abort.signal);
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

export async function translateCues(cues: Cue[], lang: string, from: string | undefined, ask: (system: string, user: string) => Promise<string>, onProgress?: (done: number) => void): Promise<Cue[]> {
  const out: Cue[] = [];
  for (let i = 0; i < cues.length; i += CUE_BATCH) {
    const batch = cues.slice(i, i + CUE_BATCH);
    const answer = await ask(cuesSystem(lang, from), batch.map((c, k) => `[${i + k + 1}] ${c.text.trim().replace(/\n/g, " <br> ")}`).join("\n"));
    let lines = readNumbered(answer, i + 1, batch.length);
    // The model merged or dropped a line: translate this batch cue by cue instead.
    if (!lines) lines = await Promise.all(batch.map((c) => ask(translateSystem(lang, from), c.text)));
    batch.forEach((c, k) => out.push({ start: c.start, end: c.end, text: lines![k].replace(/\s*<br>\s*/gi, "\n").trim() }));
    onProgress?.(out.length);
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
    const translated = await translateCues(cues, lang, from, ask, (done) => (job.progress = Math.min(0.95, done / cues.length)));
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
