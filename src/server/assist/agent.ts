import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { AUDIO_STUDIO, EDIT_STUDIO, IMAGE_STUDIO, MUSIC_STUDIO, VIDEO_STUDIO } from "@/lib/studios";
import { type AssistItem, type AssistThread, type AssistThreadSummary, type AssistThreadView, threadTitle } from "@/lib/assist";
import type { Engine, Generation } from "@/lib/catalog/types";
import { db } from "../db";
import { getGeneration } from "../generations";
import { engineMode, getSetting } from "../settings";
import { readRef } from "../storage";
import { apiTools, executeTool, getTool, planFor, type ToolContext } from "./tools";

/**
 * The Assist agent loop. History is kept exactly as the API returned it (append-only, thinking
 * included) so later turns stay valid; generations that cost money stop the loop with an approval
 * card, and the user's answer resumes it with the matching tool results.
 */

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
type UserBlock = Exclude<MessageParam["content"], string>[number];

export interface ModelRequest {
  system: { stable: string; turn: string };
  messages: MessageParam[];
  tools: Anthropic.Beta.BetaTool[];
  ctx: ToolContext;
}
export type ModelCall = (req: ModelRequest) => Promise<Anthropic.Beta.BetaMessage>;

const MAX_STEPS = 16;
const MAX_IMAGE_BYTES = 3_500_000;

// ---------------------------------------------------------------------------
// Storage

interface Pending {
  approvalItemId: string;
  /** Results of the turn's tools that already ran (read-only ones). */
  results: ToolResult[];
  /** The gated calls waiting for the user. */
  gated: { id: string; name: string; input: unknown }[];
  /** tool_use ids in the order the model sent them. */
  order: string[];
}

interface Row {
  id: string;
  title: string;
  status: AssistThread["status"];
  agent: AssistThread["agent"];
  engine: Engine;
  auto_approve: number;
  messages_json: string;
  items_json: string;
  pending_json: string | null;
  created_at: number;
  updated_at: number;
}

interface State {
  thread: AssistThread;
  messages: MessageParam[];
  pending: Pending | null;
}

declare global {
  var __fuobeAssistRuns: Set<string> | undefined;
}
const runs = (globalThis.__fuobeAssistRuns ??= new Set());

function load(id: string): State | null {
  const r = db().prepare("SELECT * FROM assist_threads WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  const s: State = {
    thread: {
      id: r.id,
      title: r.title,
      status: r.status,
      agent: r.agent,
      engine: r.engine,
      autoApprove: !!r.auto_approve,
      items: JSON.parse(r.items_json) as AssistItem[],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    },
    messages: JSON.parse(r.messages_json) as MessageParam[],
    pending: r.pending_json ? (JSON.parse(r.pending_json) as Pending) : null,
  };
  // A run that died with the server (restart, crash) leaves the thread "running": reopen it.
  if (s.thread.status === "running" && !runs.has(id)) {
    s.thread.status = "idle";
    push(s, { role: "notice", tone: "error", text: "This reply was interrupted. Send a message to carry on." });
    save(s);
  }
  return s;
}

function save(s: State): void {
  s.thread.updatedAt = Date.now();
  db()
    .prepare(
      `INSERT INTO assist_threads (id, title, status, agent, engine, auto_approve, messages_json, items_json, pending_json, created_at, updated_at)
       VALUES (@id, @title, @status, @agent, @engine, @auto_approve, @messages_json, @items_json, @pending_json, @created_at, @updated_at)
       ON CONFLICT(id) DO UPDATE SET title = @title, status = @status, auto_approve = @auto_approve, messages_json = @messages_json,
         items_json = @items_json, pending_json = @pending_json, updated_at = @updated_at`,
    )
    .run({
      id: s.thread.id,
      title: s.thread.title,
      status: s.thread.status,
      agent: s.thread.agent,
      engine: s.thread.engine,
      auto_approve: s.thread.autoApprove ? 1 : 0,
      messages_json: JSON.stringify(s.messages),
      items_json: JSON.stringify(s.thread.items),
      pending_json: s.pending ? JSON.stringify(s.pending) : null,
      created_at: s.thread.createdAt,
      updated_at: s.thread.updatedAt,
    });
}

type NewItem = AssistItem extends infer T ? (T extends AssistItem ? Omit<T, "id"> : never) : never;
function push(s: State, item: NewItem | AssistItem): AssistItem {
  const full = { ...item, id: ("id" in item && item.id) || nanoid(10) } as AssistItem;
  s.thread.items.push(full);
  return full;
}

export function listThreads(): AssistThreadSummary[] {
  return (db().prepare("SELECT id, title, status, updated_at FROM assist_threads ORDER BY updated_at DESC LIMIT 100").all() as Row[]).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    updatedAt: r.updated_at,
  }));
}

export function getThread(id: string): AssistThreadView | null {
  const s = load(id);
  if (!s) return null;
  const ids = s.thread.items.flatMap((i) => (i.role === "generations" ? i.ids : []));
  const generations = ids.map((g) => getGeneration(g)).filter((g): g is Generation => !!g);
  return { thread: s.thread, generations };
}

export function deleteThread(id: string): void {
  db().prepare("DELETE FROM assist_threads WHERE id = ?").run(id);
}

export function updateThread(id: string, patch: { autoApprove?: boolean; title?: string }): AssistThread | null {
  const s = load(id);
  if (!s) return null;
  if (patch.autoApprove !== undefined) s.thread.autoApprove = patch.autoApprove;
  if (patch.title) s.thread.title = patch.title;
  save(s);
  return s.thread;
}

/** Claude when a key is set (and the install allows it), else the offline planner. */
export function agentKind(): AssistThread["agent"] {
  const choice = getSetting("enhanceProvider");
  if (!getSetting("anthropicKey") || choice === "none" || choice === "ollama") return "offline";
  return choice === "anthropic" || engineMode() !== "open" ? "claude" : "offline";
}

export function createThread(opts: { engine: Engine; autoApprove?: boolean; title?: string }): AssistThread {
  const now = Date.now();
  const s: State = {
    thread: { id: nanoid(12), title: opts.title ?? "New chat", status: "idle", agent: agentKind(), engine: opts.engine, autoApprove: !!opts.autoApprove, items: [], createdAt: now, updatedAt: now },
    messages: [],
    pending: null,
  };
  save(s);
  return s.thread;
}

// ---------------------------------------------------------------------------
// Messages

/** User content goes into the last user turn when there is one (after a refusal or an error). */
function appendUser(messages: MessageParam[], blocks: UserBlock[]): void {
  const last = messages.at(-1);
  if (last?.role === "user") {
    const prior = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content;
    last.content = [...prior, ...blocks];
  } else {
    messages.push({ role: "user", content: blocks });
  }
}

/** Tool calls left without results (a crash mid-tool) would make every later request invalid. */
function closeDanglingToolUses(messages: MessageParam[]): void {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || typeof last.content === "string") return;
  const uses = last.content.filter((b) => b.type === "tool_use");
  if (uses.length) {
    messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result" as const, tool_use_id: (u as { id: string }).id, is_error: true, content: "Interrupted before this ran." })) });
  }
}

const FILE_KIND = (url: string) => (/\.(mp4|webm|mov|mkv)$/i.test(url) ? "video" : /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(url) ? "audio" : "image");

function userBlocks(text: string, attachments: string[]): UserBlock[] {
  const blocks: UserBlock[] = [];
  const lines = attachments.map((a, i) => `- ${FILE_KIND(a)} ${i + 1}: ${a}`);
  blocks.push({ type: "text", text: attachments.length ? `${text}\n\nAttached files (pass these URLs as inputs):\n${lines.join("\n")}` : text });
  // Local images are stored by URL and sent as base64 at request time (see hydrate).
  for (const a of attachments.filter((x) => FILE_KIND(x) === "image").slice(0, 4)) blocks.push({ type: "image", source: { type: "url", url: a } });
  return blocks;
}

/** Turn stored local image URLs into base64 (the API can't reach this machine). */
async function hydrate(messages: MessageParam[]): Promise<MessageParam[]> {
  const cache = new Map<string, UserBlock>();
  const one = async (b: UserBlock): Promise<UserBlock> => {
    if (b.type !== "image" || b.source.type !== "url" || !b.source.url.startsWith("/api/files/")) return b;
    const url = b.source.url;
    if (!cache.has(url)) {
      try {
        const { data, contentType } = await readRef(url);
        if (data.length > MAX_IMAGE_BYTES || !/^image\/(png|jpeg|webp|gif)$/.test(contentType)) throw new Error("too big");
        cache.set(url, { type: "image", source: { type: "base64", media_type: contentType as "image/png", data: data.toString("base64") } });
      } catch {
        cache.set(url, { type: "text", text: `[image ${url} can't be shown]` });
      }
    }
    return cache.get(url)!;
  };
  return Promise.all(
    messages.map(async (m) => {
      if (m.role !== "user" || typeof m.content === "string") return m;
      const content = await Promise.all(
        m.content.map(async (b) =>
          b.type === "tool_result" && Array.isArray(b.content) ? { ...b, content: (await Promise.all(b.content.map((c) => one(c as UserBlock)))) as typeof b.content } : one(b),
        ),
      );
      return { ...m, content };
    }),
  );
}

// ---------------------------------------------------------------------------
// System prompt

const STABLE_SYSTEM = `You are Fuobe Assist, the creative assistant inside Fuobe — an AI image, video and audio studio. You plan and run generations for the user with the tools you have.

How you work:
- Understand the brief. If something essential is missing (what the subject is, or which of their files to use) ask one short question; otherwise make sensible creative choices and go.
- Look up models with search_models before you generate, and pick the model that best fits the job, the user's engine preference and their budget. Prefer connected models. Mention the model you picked and why in one line.
- Write rich, specific prompts: subject, setting, light, lens and composition; for video, the motion and camera move in time order. Keep any text the user wants rendered exactly.
- Call generate (or create_storyboard) directly. The app shows the user a plan card with the cost and runs it when they approve — never ask "shall I go ahead?" in text.
- For multi-step work (an image, then animate it; a hero shot, then variations), wait for the first results with check_generations and pass its output URL into the next generate call. Use look=true when judging the results matters.
- Use the user's files by the URLs listed in their message. Earlier outputs are found with list_recent. Saved characters and products are Elements: check list_elements and write their @handle in prompts.
- Results show up in the chat by themselves, so don't repeat URLs back. After starting jobs, say briefly what's coming; after they finish, give a short take and suggest a next step.
- Be brief and friendly. Plain sentences, no headings. Prices are estimates in USD; open-source models run free on the user's own GPU.`;

function turnSystem(t: AssistThread): string {
  const mode = engineMode();
  const engine =
    mode === "open"
      ? "This install runs open-source models only (ComfyUI on the user's GPU)."
      : mode === "cloud"
        ? "This install runs paid cloud APIs only."
        : t.engine === "open"
          ? "The user prefers open-source models (ComfyUI, free on their GPU); use paid ones only when no open model can do the job, and say so."
          : "The user prefers paid cloud models (best quality); open-source models are available too.";
  const approval = t.autoApprove ? "Auto-run is on: generations start without an approval card, so keep plans within what the user asked for." : "Ask-first is on: each generate call shows an approval card.";
  return `Today is ${new Date().toISOString().slice(0, 10)}. ${engine} ${approval}`;
}

// ---------------------------------------------------------------------------
// Models

export const claude: ModelCall = async ({ system, messages, tools }) => {
  const client = new Anthropic({ apiKey: getSetting("anthropicKey") });
  return client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      { type: "text", text: system.stable, cache_control: { type: "ephemeral" } },
      { type: "text", text: system.turn },
    ],
    tools,
    messages: await hydrate(messages),
  });
};

/** A rule-based planner with the same shape as a model reply, for installs without an LLM. */
export const offline: ModelCall = async ({ messages, ctx }) => {
  const last = messages.at(-1);
  const blocks = last && typeof last.content !== "string" ? last.content : [];
  const reply = (content: Anthropic.Beta.BetaContentBlock[], stop: Anthropic.Beta.BetaStopReason): Anthropic.Beta.BetaMessage =>
    ({ id: `msg_offline_${nanoid(8)}`, type: "message", role: "assistant", model: "offline", content, stop_reason: stop, stop_sequence: null, stop_details: null, usage: null }) as unknown as Anthropic.Beta.BetaMessage;
  const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.Beta.BetaTextBlock;

  const results = blocks.filter((b): b is ToolResult => b.type === "tool_result");
  const said = blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  if (results.length && !said.trim()) {
    const body = results.map((r) => (typeof r.content === "string" ? r.content : "")).join(" ");
    if (results.some((r) => r.is_error)) return reply([text(/declined/i.test(body) ? "Okay, I won't run that. Tell me what to change." : `That didn't start: ${body.replace(/^.*"error":"([^"]+)".*$/, "$1")}`)], "end_turn");
    return reply([text("On it — the results will appear here as they finish. Want variations, a different look, or to animate one?")], "end_turn");
  }
  const plan = offlinePlan(said, ctx.engine);
  if (!plan) return reply([text("Tell me what to make — an image, a video, a voice-over or a storyboard — and attach any photos to use.")], "end_turn");
  return reply(
    [text(plan.say), { type: "tool_use", id: `toolu_offline_${nanoid(10)}`, name: plan.tool, input: plan.input, caller: { type: "direct" } } as unknown as Anthropic.Beta.BetaToolUseBlock],
    "tool_use",
  );
};

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/** Read a request like "3 vertical videos of a fox, animate this" into one tool call. */
export function offlinePlan(message: string, preferred: Engine): { tool: string; input: Record<string, unknown>; say: string } | null {
  const [body, attached = ""] = message.split(/\n\nAttached files[^\n]*\n/);
  const text = body.trim();
  if (!text) return null;
  const files = [...attached.matchAll(/^- (image|video|audio) \d+: (\S+)$/gm)].map((m) => ({ kind: m[1], url: m[2] }));
  const images = files.filter((f) => f.kind === "image").map((f) => f.url);
  const t = text.toLowerCase();
  const mode = engineMode();
  const engine: Engine = mode === "both" ? preferred : mode;
  const count = (() => {
    const m = /\b(\d|one|two|three|four|five|six|seven|eight)\s+(?:\w+\s+)?(images?|pictures?|photos?|versions?|takes?|variations?|options?|videos?|clips?|frames?|panels?|scenes?|shots?)\b/.exec(t);
    return m ? (NUMBER_WORDS[m[1]] ?? Number(m[1])) : undefined;
  })();
  const aspect = /\b(vertical|portrait|9:16|reels?|tiktok|stories|story format)\b/.test(t) ? "9:16" : /\b(square|1:1)\b/.test(t) ? "1:1" : /\b(wide|landscape|16:9|widescreen)\b/.test(t) ? "16:9" : undefined;

  if (/\b(storyboard|comic|panels|shot list)\b/.test(t) || (count && /\b(frames|scenes|panels)\b/.test(t))) {
    const frames = Math.max(1, Math.min(8, count ?? 4));
    return {
      tool: "create_storyboard",
      input: { story: text, frames, ...(images.length && { references: images.slice(0, 4) }), ...(aspect && { aspect_ratio: aspect }) },
      say: `I'll split that into ${frames} frames with the same characters and look, each made from the one before.`,
    };
  }
  const pick = (d: { cloud: string; open: string }) => (engine === "open" && d.open ? d.open : d.cloud);
  const isMusic = /\b(music|song|soundtrack|beat|jingle)\b/.test(t);
  const isSpeech = !isMusic && /\b(voice ?over|narrat\w*|read (this|it|out)|say|speak|text to speech|tts)\b/.test(t);
  const isVideo = !isMusic && !isSpeech && (files.some((f) => f.kind === "video") || /\b(videos?|clips?|animate|animation|motion|films?|footage|movies?|trailers?|commercials?)\b/.test(t));
  if (isMusic || isSpeech) {
    const quoted = /["“]([^"”]+)["”]/.exec(text)?.[1] ?? text.replace(/^.*?:\s*/, "");
    return {
      tool: "generate",
      input: { summary: isMusic ? "A music track" : "A voice-over", jobs: [{ model_id: pick(isMusic ? MUSIC_STUDIO.defaultModels : AUDIO_STUDIO.defaultModels), prompt: isMusic ? text : quoted }] },
      say: isMusic ? "Here's a track for that." : "I'll record that as a voice-over.",
    };
  }
  const studio = isVideo ? VIDEO_STUDIO : images.length ? EDIT_STUDIO : IMAGE_STUDIO;
  const n = Math.max(1, Math.min(4, count ?? (isVideo ? 1 : 2)));
  const job = { model_id: pick(studio.defaultModels), prompt: text, ...(images.length && { images: images.slice(0, isVideo ? 1 : 4) }), ...(aspect && { aspect_ratio: aspect }), ...(n > 1 && { outputs: n }) };
  const what = isVideo ? (images.length ? "animate your image" : "make the video") : images.length ? "edit your image" : `make ${n} take${n === 1 ? "" : "s"}`;
  return { tool: "generate", input: { summary: `${isVideo ? "Video" : images.length ? "Edit" : "Image"}: ${text.slice(0, 80)}`, jobs: [job] }, say: `I'll ${what} with the default ${isVideo ? "video" : "image"} model.` };
}

// ---------------------------------------------------------------------------
// The loop

async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<{ result: Omit<ToolResult, "tool_use_id">; items: AssistItem[] }> {
  const out = await executeTool(name, input, ctx);
  return { result: { type: "tool_result", content: out.content, ...(out.isError && { is_error: true }) }, items: out.items ?? [] };
}

function ordered(results: ToolResult[], order: string[]): ToolResult[] {
  return [...results].sort((a, b) => order.indexOf(a.tool_use_id) - order.indexOf(b.tool_use_id));
}

async function step(s: State, model: ModelCall): Promise<"continue" | "stop"> {
  const ctx: ToolContext = { engine: s.thread.engine };
  const res = await model({ system: { stable: STABLE_SYSTEM, turn: turnSystem(s.thread) }, messages: s.messages, tools: apiTools(), ctx });

  if (res.stop_reason === "refusal") {
    // Nothing is appended: the user's turn stays last and their next message joins it.
    push(s, { role: "notice", tone: "error", text: res.stop_details?.explanation || "Claude declined this request. Try rephrasing it." });
    return "stop";
  }
  if (res.stop_reason === "model_context_window_exceeded") {
    push(s, { role: "notice", tone: "error", text: "This chat is too long to continue. Start a new one." });
    return "stop";
  }
  s.messages.push({ role: "assistant", content: res.content });
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
  if (text) push(s, { role: "assistant", text });
  if (res.stop_reason === "pause_turn") return "continue";

  const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
  if (res.stop_reason === "max_tokens") {
    if (!uses.length) {
      push(s, { role: "notice", tone: "info", text: "The reply was cut short." });
      return "stop";
    }
    // A cut-off tool call may be incomplete: don't run it, ask for a shorter one.
    s.messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result" as const, tool_use_id: u.id, is_error: true, content: "Your reply hit the output limit before this call was complete. Make the call again, shorter." })) });
    return "continue";
  }
  if (!uses.length) return "stop";

  const results: ToolResult[] = [];
  const gated: Pending["gated"] = [];
  for (const u of uses) {
    if (getTool(u.name)?.gated && !s.thread.autoApprove) {
      gated.push({ id: u.id, name: u.name, input: u.input });
      continue;
    }
    const { result, items } = await runTool(u.name, u.input, ctx);
    results.push({ ...result, tool_use_id: u.id });
    for (const it of items) push(s, it);
  }
  const order = uses.map((u) => u.id);
  if (gated.length) {
    const plans = gated.map((g) => planFor(g.name, g.input, ctx));
    const jobs = plans.flatMap((p) => p.jobs);
    const summaries = gated.map((g) => (g.input as { summary?: string }).summary).filter(Boolean);
    const total = plans.some((p) => p.total === null) ? null : plans.reduce((n, p) => n + (p.total ?? 0), 0);
    const item = push(s, { role: "approval", summary: summaries.join(" · ") || (gated[0].name === "create_storyboard" ? "Storyboard" : "Generate"), jobs, totalUsd: total, status: "pending" });
    s.pending = { approvalItemId: item.id, results, gated, order };
    s.thread.status = "waiting";
    return "stop";
  }
  s.messages.push({ role: "user", content: ordered(results, order) });
  return "continue";
}

const MODELS: Record<AssistThread["agent"], ModelCall> = { claude, offline };

/**
 * Run the agent until it ends its turn or waits for approval. Call it right after addMessage or
 * answerApproval: it claims the thread synchronously, so the "running" status they saved stays valid.
 */
export async function run(id: string, model?: ModelCall): Promise<void> {
  if (runs.has(id)) return;
  runs.add(id);
  try {
    const s = load(id);
    if (!s) return;
    const call = model ?? MODELS[s.thread.agent];
    s.thread.status = "running";
    save(s);
    for (let i = 0; i < MAX_STEPS; i++) {
      let next: "continue" | "stop";
      try {
        next = await step(s, call);
      } catch (e) {
        push(s, { role: "notice", tone: "error", text: errorText(e) });
        next = "stop";
      }
      if (next === "stop") break;
      save(s);
      if (i === MAX_STEPS - 1) push(s, { role: "notice", tone: "info", text: "Paused after many steps. Send a message to keep going." });
    }
    if (s.thread.status === "running") s.thread.status = "idle";
    save(s);
  } finally {
    runs.delete(id);
  }
}

function errorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Your Anthropic API key was rejected. Check it in Settings → API keys.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now. Try again in a minute.";
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status ?? "network"}): ${e.message}`;
  return (e as Error).message || "Something went wrong";
}

export class AssistBusyError extends Error {}

/** Add the user's message; a pending plan they didn't approve is declined with their message as feedback. */
export function addMessage(id: string, text: string, attachments: string[] = []): AssistThread {
  const s = load(id);
  if (!s) throw new Error("Not found");
  if (s.thread.status === "running" || runs.has(id)) throw new AssistBusyError("Still working on the last message");
  if (!s.thread.items.some((i) => i.role === "user")) s.thread.title = threadTitle(text);
  // Tool results first: they answer the assistant's last turn.
  const results = s.pending ? decline(s, "The user replied with new instructions instead of approving; follow them.") : [];
  if (!results.length) closeDanglingToolUses(s.messages);
  appendUser(s.messages, [...results, ...userBlocks(text, attachments)]);
  push(s, { role: "user", text, ...(attachments.length && { attachments }) });
  s.thread.status = "running";
  save(s);
  return s.thread;
}

function settle(s: State, approved: boolean): Pending {
  const p = s.pending!;
  const item = s.thread.items.find((i) => i.id === p.approvalItemId);
  if (item?.role === "approval") item.status = approved ? "approved" : "declined";
  s.pending = null;
  return p;
}

function decline(s: State, why = "The user declined this plan. Ask what they'd like to change."): ToolResult[] {
  const p = settle(s, false);
  return ordered([...p.results, ...p.gated.map((g) => ({ type: "tool_result" as const, tool_use_id: g.id, is_error: true, content: why }))], p.order);
}

async function approve(s: State): Promise<ToolResult[]> {
  const p = settle(s, true);
  const results = [...p.results];
  for (const g of p.gated) {
    const { result, items } = await runTool(g.name, g.input, { engine: s.thread.engine });
    results.push({ ...result, tool_use_id: g.id });
    for (const it of items) push(s, it);
  }
  return ordered(results, p.order);
}

/** The user's answer on the approval card. */
export async function answerApproval(id: string, ok: boolean): Promise<AssistThread> {
  const s = load(id);
  if (!s) throw new Error("Not found");
  if (!s.pending || s.thread.status !== "waiting") throw new AssistBusyError("Nothing is waiting for approval");
  const results = ok ? await approve(s) : decline(s);
  s.messages.push({ role: "user", content: results });
  s.thread.status = "running";
  save(s);
  return s.thread;
}
