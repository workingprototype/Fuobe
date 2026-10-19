import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getModel } from "@/lib/catalog";
import {
  AUTO_SECONDS,
  blockCount,
  buildEpisodeGraph,
  changedKeys,
  channelName,
  defaultSettings,
  ENGINE_MODELS,
  estimateGraph,
  finalKey,
  genreInfo,
  getStyle,
  MAX_SCRIPT,
  narrationText,
  normalizeBlocks,
  OFFLINE_NOTE,
  offlineScript,
  offlineTopics,
  parseScript,
  parseTopics,
  parseVisuals,
  placeholderBlocks,
  planRerun,
  planRetry,
  previewLine,
  scriptBrief,
  scriptSystem,
  splitScript,
  topicsBrief,
  topicsSystem,
  totalSeconds,
  visualsBrief,
  visualsSystem,
  wordsFor,
  youtubeKind,
  YOUTUBE_ERROR,
  type ChangePart,
  type ChangePreview,
  type ChannelReference,
  type ChannelSettings,
  type EpisodeCard,
  type EpisodePlan,
  type EpisodeScript,
  type EpisodeSettings,
  type EpisodeStatus,
  type EpisodeView,
  type EstimateResult,
  type ExplainerSource,
  type FacelessChannel,
  type FacelessEpisode,
  type FacelessGenre,
  type GraphInput,
  type GraphStep,
  type NarratorVoice,
  type ScriptBlock,
  type StillEdits,
  type TopicIdea,
} from "@/lib/catalog/faceless";
import { routesFor } from "@/lib/catalog/plan";
import type { Engine, Generation, GenerationRequest } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { db } from "./db";
import { listElements } from "./elements";
import { cancelGeneration, chooseRoute, createGenerations, getGeneration, previewChained } from "./generations";
import { provider } from "./providers";
import { llmBackends, probeOllama } from "./providers/llm";
import { fetchRemote } from "./remote-fetch";
import { engineMode, getSetting } from "./settings";
import { fileUrl, saveFile } from "./storage";

/**
 * Faceless Studio and the Explainer on the server: channels (genre, saved style, narrator, aspect,
 * subtitles), episodes (topic → script → review → render), the render itself as chained generations
 * (createPipeline over the graph from src/lib/catalog/faceless.ts), retries, block changes from the
 * timeline editor (re-run that block's steps and everything after them) with Undo, voice previews,
 * topic suggestions, link summaries and estimates.
 *
 * Writing a script runs in this process (the install's LLM through the "llm" provider, or the offline
 * writer); a restart while it writes leaves the episode "write-failed" with a Try again. Rendering lives
 * in the generations table, so it survives restarts like any chained job.
 */

export class FacelessError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Rows

interface ChannelRow {
  id: string;
  name: string;
  idea: string;
  genre: string;
  avatar_url: string | null;
  reference_json: string | null;
  settings_json: string;
  created_at: number;
  updated_at: number;
}

interface EpisodeRow {
  id: string;
  channel_id: string | null;
  kind: "faceless" | "explainer";
  title: string;
  topic: string;
  status: EpisodeStatus;
  error: string | null;
  settings_json: string;
  script_json: string;
  plan_json: string | null;
  sources_json: string | null;
  favorite: number;
  created_at: number;
  updated_at: number;
}

const toChannel = (r: ChannelRow): FacelessChannel => ({
  id: r.id,
  name: r.name,
  idea: r.idea,
  genre: genreInfo(r.genre).id,
  avatarUrl: r.avatar_url,
  reference: r.reference_json ? (JSON.parse(r.reference_json) as ChannelReference) : null,
  settings: JSON.parse(r.settings_json) as ChannelSettings,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toEpisode = (r: EpisodeRow): FacelessEpisode => ({
  id: r.id,
  channelId: r.channel_id,
  kind: r.kind,
  title: r.title,
  topic: r.topic,
  status: r.status,
  error: r.error,
  settings: JSON.parse(r.settings_json) as EpisodeSettings,
  script: JSON.parse(r.script_json) as EpisodeScript,
  plan: r.plan_json ? (JSON.parse(r.plan_json) as EpisodePlan) : null,
  sources: r.sources_json ? (JSON.parse(r.sources_json) as ExplainerSource[]) : [],
  favorite: !!r.favorite,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function updateEpisodeRow(id: string, fields: Partial<EpisodeRow>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE faceless_episodes SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`)
    .run({ ...fields, __now: Date.now(), __id: id });
}

const episodeRow = (id: string) => db().prepare("SELECT * FROM faceless_episodes WHERE id = ?").get(id) as EpisodeRow | undefined;

function mustEpisode(id: string): FacelessEpisode {
  const r = episodeRow(id);
  if (!r) throw new FacelessError("Episode not found", 404);
  return toEpisode(r);
}

// ---------------------------------------------------------------------------
// The LLM (the install's own: Claude or Ollama for the cloud engine, Ollama only for the open one)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One answer from the engine's text model, or null (no LLM, AI helper off, demo mode on, or it failed: `onError` hears why). */
export async function askLlm(engine: Engine, system: string, user: string, onError?: (msg: string) => void): Promise<string | null> {
  if (getSetting("demoMode") === "on") return null;
  const model = getModel(ENGINE_MODELS[engine].write);
  const route = model?.routes.find((r) => r.op === "write");
  if (!model || !route) return null;
  await probeOllama();
  if (!llmBackends(route).length) return null;
  const llm = provider("llm");
  try {
    const { externalId } = await llm.submit({ generationId: `faceless_${nanoid(6)}`, model, route, input: { prompt: user, extra: { system } } });
    const ctx = { externalId, meta: {}, route, model, createdAt: Date.now() };
    const deadline = Date.now() + 8 * 60_000;
    while (Date.now() < deadline) {
      await sleep(350);
      const r = await llm.poll(ctx);
      if (r.state === "succeeded") return r.outputs[0]?.text?.trim() || null;
      if (r.state === "failed") {
        onError?.(r.error);
        return null;
      }
    }
    await llm.cancel?.(ctx);
    onError?.("The LLM took too long");
  } catch (e) {
    onError?.((e as Error).message);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Channels

const ChannelDefaults = (engine: Engine, genre: FacelessGenre): ChannelSettings => {
  const s = defaultSettings(engine, genreInfo(genre));
  return { engine, styleId: s.styleId, styleRefs: [], voice: s.voice, aspect: s.aspect, subtitles: s.subtitles, music: s.music, animation: s.animation, length: s.length };
};

export function listChannels(): FacelessChannel[] {
  const rows = db().prepare("SELECT * FROM faceless_channels ORDER BY updated_at DESC").all() as ChannelRow[];
  const counts = new Map(
    (db().prepare("SELECT channel_id, COUNT(*) AS n FROM faceless_episodes WHERE channel_id IS NOT NULL GROUP BY channel_id").all() as { channel_id: string; n: number }[]).map((r) => [r.channel_id, r.n]),
  );
  return rows.map((r) => {
    const c = toChannel(r);
    // The newest episode with a finished picture: its first scene is the cover.
    const latest = db().prepare("SELECT * FROM faceless_episodes WHERE channel_id = ? AND plan_json IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(r.id) as EpisodeRow | undefined;
    const ep = latest && toEpisode(latest);
    const still = ep?.plan ? getGeneration(ep.plan.ids[`still-${ep.script.blocks[0]?.id}`] ?? "") : null;
    return { ...c, episodes: counts.get(r.id) ?? 0, cover: still?.status === "succeeded" ? still : null };
  });
}

export function getChannel(id: string): FacelessChannel | null {
  const r = db().prepare("SELECT * FROM faceless_channels WHERE id = ?").get(id) as ChannelRow | undefined;
  return r ? toChannel(r) : null;
}

/** Title and thumbnail of a YouTube link (oEmbed, through the SSRF-safe fetch); the thumbnail is saved as an upload. */
async function readReference(url: string): Promise<ChannelReference> {
  const kind = youtubeKind(url);
  if (!kind) throw new FacelessError(YOUTUBE_ERROR);
  const ref: ChannelReference = { url: url.trim(), kind };
  try {
    const res = await fetchRemote(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(ref.url)}`, { maxBytes: 256 * 1024, timeoutMs: 8000 });
    const j = JSON.parse(res.data.toString("utf8")) as { title?: string; author_name?: string; thumbnail_url?: string };
    ref.title = j.title?.slice(0, 200);
    ref.author = j.author_name?.slice(0, 120);
    if (j.thumbnail_url) {
      const img = await fetchRemote(j.thumbnail_url, { maxBytes: 4 * 1024 * 1024, timeoutMs: 8000 });
      const type = img.contentType?.startsWith("image/") ? img.contentType : "image/jpeg";
      ref.thumbnail = saveFile({ data: img.data, contentType: type, name: "reference-thumbnail.jpg", source: "upload" }).url;
    }
  } catch {
    // Saved as a plain link: the look can't be matched without the thumbnail, the script still gets the link.
  }
  return ref;
}

export async function createChannel(input: { idea: string; genre: FacelessGenre; engine: Engine; reference?: string; name?: string }): Promise<FacelessChannel> {
  const idea = input.idea.trim();
  if (!idea) throw new FacelessError("Describe the channel first");
  const reference = input.reference?.trim() ? await readReference(input.reference) : null;
  let name = input.name?.trim() || null;
  if (!name) {
    const answer = await askLlm(
      input.engine,
      "You name YouTube channels. Reply with the name only: 2–4 words, memorable, no quotes, no emoji.",
      `Channel idea: ${idea}\nGenre: ${genreInfo(input.genre).label}`,
    );
    name = answer?.split("\n")[0].replace(/^["'“”]+|["'“”.]+$/g, "").trim().slice(0, 60) || null;
  }
  const now = Date.now();
  const row: ChannelRow = {
    id: nanoid(10),
    name: name || channelName(idea),
    idea: idea.slice(0, 500),
    genre: input.genre,
    avatar_url: null,
    reference_json: reference ? JSON.stringify(reference) : null,
    settings_json: JSON.stringify(ChannelDefaults(input.engine, input.genre)),
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(`INSERT INTO faceless_channels (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  return toChannel(row);
}

export async function updateChannel(
  id: string,
  patch: { name?: string; idea?: string; genre?: FacelessGenre; avatarUrl?: string | null; reference?: string | null; settings?: Partial<ChannelSettings> },
): Promise<FacelessChannel> {
  const cur = getChannel(id);
  if (!cur) throw new FacelessError("Channel not found", 404);
  const fields: Partial<ChannelRow> = {};
  if (patch.name !== undefined) fields.name = patch.name.trim().slice(0, 60) || cur.name;
  if (patch.idea !== undefined) fields.idea = patch.idea.trim().slice(0, 500) || cur.idea;
  if (patch.genre) fields.genre = patch.genre;
  if (patch.avatarUrl !== undefined) fields.avatar_url = patch.avatarUrl;
  if (patch.reference !== undefined) fields.reference_json = patch.reference ? JSON.stringify(await readReference(patch.reference)) : null;
  if (patch.settings) fields.settings_json = JSON.stringify({ ...cur.settings, ...patch.settings });
  const keys = Object.keys(fields);
  if (keys.length) {
    db()
      .prepare(`UPDATE faceless_channels SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`)
      .run({ ...fields, __now: Date.now(), __id: id });
  }
  return getChannel(id)!;
}

/** Deletes the channel and its episodes; their videos stay in the Library. */
export function deleteChannel(id: string): void {
  if (!getChannel(id)) throw new FacelessError("Channel not found", 404);
  db().transaction(() => {
    db().prepare("DELETE FROM faceless_episodes WHERE channel_id = ?").run(id);
    db().prepare("DELETE FROM faceless_channels WHERE id = ?").run(id);
  })();
}

/** A channel avatar in the channel's style (one picture generation). */
export function makeAvatar(id: string): Generation {
  const c = getChannel(id);
  if (!c) throw new FacelessError("Channel not found", 404);
  const style = getStyle(c.settings.styleId);
  const engine = c.settings.engine;
  const [g] = createGenerations({
    feature: "faceless-avatar",
    modelId: ENGINE_MODELS[engine].still,
    prompt: `A round channel avatar for a YouTube channel called “${c.name}” (${c.idea}): one bold, simple central emblem, centred on a plain background. Style: ${style.look}. No text or letters.`,
    params: { aspectRatio: "1:1", numOutputs: 1 },
    title: `${c.name} · avatar`,
  });
  return g;
}

// ---------------------------------------------------------------------------
// Topics

export async function suggestTopics(input: { idea: string; genre: FacelessGenre; engine: Engine; avoid?: string[]; count?: number; round?: number; reference?: string }): Promise<{ topics: TopicIdea[]; offline: boolean }> {
  const count = Math.max(4, Math.min(6, input.count ?? 5));
  const genre = genreInfo(input.genre);
  const answer = await askLlm(input.engine, topicsSystem, topicsBrief({ idea: input.idea, genre, count, avoid: input.avoid, reference: input.reference }));
  const topics = answer ? parseTopics(answer).slice(0, count) : [];
  if (topics.length >= 3) return { topics, offline: false };
  return { topics: offlineTopics(input.idea, genre.id, count, input.round ?? 0), offline: true };
}

// ---------------------------------------------------------------------------
// Episodes: create, write, review

declare global {
  var __fuobeFacelessWriting: Map<string, Promise<void>> | undefined;
}
const writing = () => (globalThis.__fuobeFacelessWriting ??= new Map<string, Promise<void>>());

export interface EpisodeInput {
  kind: "faceless" | "explainer";
  channelId?: string | null;
  topic: string;
  settings: EpisodeSettings;
  /** A pasted script (skips the writer). */
  script?: string;
  sources?: ExplainerSource[];
  /** Explainer: render as soon as the script is written (no review step). */
  autoRender?: boolean;
}

function cleanSettings(s: EpisodeSettings): EpisodeSettings {
  const mode = engineMode();
  if (mode !== "both" && s.engine !== mode) {
    throw new FacelessError(mode === "open" ? "This install is set to open source only (Settings → Engine mode)" : "This install is set to paid cloud APIs only (Settings → Engine mode)");
  }
  return {
    ...s,
    styleRefs: s.styleRefs.slice(0, 3),
    elements: [...new Set(s.elements)].slice(0, 8),
    length: Math.max(15, Math.min(600, Math.round(s.length))),
  };
}

export function createEpisode(input: EpisodeInput): FacelessEpisode {
  const topic = input.topic.trim();
  const pasted = input.script?.trim() ?? "";
  if (!topic && !pasted && !input.sources?.length) throw new FacelessError(input.kind === "explainer" ? "Add a prompt, or attach a file or link" : "Add a topic, or bring your own script");
  if (pasted.length > MAX_SCRIPT) throw new FacelessError("That script is too long to narrate. Shorten it and try again.");
  const channel = input.channelId ? getChannel(input.channelId) : null;
  if (input.channelId && !channel) throw new FacelessError("Channel not found", 404);
  const settings = cleanSettings(input.settings);
  const sources = (input.sources ?? []).slice(0, 3);
  settings.sourceImages = sources.filter((s): s is Extract<ExplainerSource, { kind: "image" }> => s.kind === "image").map((s) => s.url);
  const now = Date.now();
  const title = (topic || pasted).replace(/\s+/g, " ").slice(0, 80) || "Untitled episode";
  const row: EpisodeRow = {
    id: nanoid(10),
    channel_id: channel?.id ?? null,
    kind: input.kind,
    title,
    topic: topic.slice(0, 5000),
    status: "writing",
    error: null,
    settings_json: JSON.stringify(settings),
    script_json: JSON.stringify({ blocks: [], source: pasted ? "pasted" : "ai" } satisfies EpisodeScript),
    plan_json: null,
    sources_json: JSON.stringify(sources),
    favorite: 0,
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(`INSERT INTO faceless_episodes (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  if (channel) {
    // The channel remembers the latest look and voice.
    void updateChannel(channel.id, {
      settings: { engine: settings.engine, styleId: settings.styleId, styleRefs: settings.styleRefs, voice: settings.voice, aspect: settings.aspect, subtitles: settings.subtitles, music: settings.music, animation: settings.animation, length: settings.length },
    });
  }
  startWriting(row.id, pasted, !!input.autoRender);
  return toEpisode(row);
}

/** Write (or split) the script in the background; the episode moves to review, or straight to rendering. */
function startWriting(id: string, pasted: string, autoRender: boolean): Promise<void> {
  const job = (async () => {
    try {
      await writeScript(id, pasted);
    } catch (e) {
      updateEpisodeRow(id, { status: "write-failed", error: (e as Error).message || "Couldn't write the script" });
      return;
    }
    if (!autoRender) return;
    try {
      renderEpisode(id);
    } catch (e) {
      // The script is there: show it with what's in the way (a missing voice, an engine that isn't connected).
      updateEpisodeRow(id, { status: "review", error: (e as Error).message });
    }
  })().finally(() => writing().delete(id));
  writing().set(id, job);
  return job;
}

/** Wait for a script that's being written (tests, and the API's `?wait=1`). */
export const scriptWritten = (id: string) => writing().get(id) ?? Promise.resolve();

async function writeScript(id: string, pasted: string): Promise<void> {
  const ep = mustEpisode(id);
  const genre = genreInfo(ep.channelId ? (getChannel(ep.channelId)?.genre ?? "education") : "education");
  const channel = ep.channelId ? getChannel(ep.channelId) : null;
  const s = ep.settings;
  const style = getStyle(s.styleId);
  const auto = ep.kind === "explainer" && s.auto;
  const scenes = blockCount(auto ? AUTO_SECONDS : s.length);
  const handles = new Set(s.elements.map((h) => h.toLowerCase()));
  const elements = listElements()
    .filter((e) => e.kind !== "voice" && handles.has(e.handle.toLowerCase()))
    .map((e) => ({ handle: e.handle, kind: e.kind, description: e.description }));
  const textSources = ep.sources.flatMap((x) => (x.kind === "text" ? [`${x.name}: ${x.text.slice(0, 6000)}`] : x.kind === "link" ? [`${x.title ?? x.url} (${x.url}): ${x.text.slice(0, 6000)}`] : []));
  let failure = "";
  const onError = (m: string) => (failure = m);
  let script: EpisodeScript;
  if (pasted) {
    const blocks = splitScript(pasted);
    const answer = await askLlm(s.engine, visualsSystem, visualsBrief(blocks, style.name, ep.topic || pasted.slice(0, 200)), onError);
    const visuals = answer ? parseVisuals(answer, blocks.length) : null;
    script = {
      source: "pasted",
      blocks: visuals ? blocks.map((b, i) => ({ ...b, visual: visuals[i].visual, motion: visuals[i].motion || b.motion })) : blocks,
      ...(!visuals && { offline: true, note: failure ? `Pictures planned offline (${failure}).` : "Pictures planned from your words — connect Claude or Ollama in Settings for better scenes." }),
    };
  } else {
    const topic = ep.topic || textSources[0]?.slice(0, 300) || "this topic";
    const brief = scriptBrief({
      topic,
      genre: ep.kind === "explainer" ? { ...genre, label: "Explainer", hint: "Explain it clearly to someone new to it", tone: genre.tone } : genre,
      scenes,
      wordsPerScene: wordsFor(10),
      channel: channel ? `${channel.name} — ${channel.idea}` : undefined,
      styleName: style.name,
      elements,
      reference: channel?.reference ? [channel.reference.title, channel.reference.author && `by ${channel.reference.author}`].filter(Boolean).join(" ") || channel.reference.url : undefined,
      sources: textSources,
      auto,
    });
    const answer = await askLlm(s.engine, scriptSystem, brief, onError);
    const parsed = answer ? parseScript(answer) : null;
    if (parsed?.blocks.length) {
      script = { source: "ai", title: parsed.title ?? undefined, blocks: parsed.blocks };
    } else {
      const blocks = offlineScript(topic, ep.kind === "explainer" ? "education" : genre.id, scenes);
      if (elements.length) for (const b of blocks) b.visual = `${b.visual}, with ${elements.map((e) => `@${e.handle}`).join(" and ")}`;
      script = { source: "ai", blocks, offline: true, note: failure ? `${OFFLINE_NOTE} (${failure})` : OFFLINE_NOTE };
    }
  }
  if (!episodeRow(id)) return;
  updateEpisodeRow(id, {
    status: "review",
    error: null,
    title: (script.title || ep.title).slice(0, 120),
    script_json: JSON.stringify(script),
  });
}

/** Write the script again (after a failure, or for a fresh draft). */
export function rewriteEpisode(id: string): FacelessEpisode {
  const ep = mustEpisode(id);
  if (ep.status === "rendering" || ep.status === "done") throw new FacelessError("This episode is already rendered — change scenes in the timeline instead", 409);
  if (writing().has(id)) return ep;
  updateEpisodeRow(id, { status: "writing", error: null });
  startWriting(id, ep.script.source === "pasted" ? ep.script.blocks.map((b) => b.narration).join(" ") : "", false);
  return mustEpisode(id);
}

export function updateEpisode(id: string, patch: { title?: string; favorite?: boolean; blocks?: Partial<ScriptBlock>[]; settings?: Partial<EpisodeSettings> }): FacelessEpisode {
  const ep = mustEpisode(id);
  const fields: Partial<EpisodeRow> = {};
  if (patch.title !== undefined) fields.title = patch.title.trim().slice(0, 120) || ep.title;
  if (patch.favorite !== undefined) fields.favorite = patch.favorite ? 1 : 0;
  if (patch.blocks || patch.settings) {
    if (ep.status !== "review" && ep.status !== "write-failed") throw new FacelessError("The script can only change before the episode renders — use the timeline editor", 409);
    if (patch.blocks) {
      const blocks = normalizeBlocks(patch.blocks);
      if (narrationText(blocks).length > MAX_SCRIPT) throw new FacelessError("That script is too long to narrate. Shorten it and try again.");
      fields.script_json = JSON.stringify({ ...ep.script, blocks });
      fields.status = "review";
    }
    if (patch.settings) fields.settings_json = JSON.stringify(cleanSettings({ ...ep.settings, ...patch.settings }));
  }
  updateEpisodeRow(id, fields);
  return mustEpisode(id);
}

export function deleteEpisode(id: string): void {
  mustEpisode(id);
  db().prepare("DELETE FROM faceless_episodes WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Rendering

/**
 * A voice to clone when an open-source narrator has no sample and the narration would only run as a
 * demo anyway (no ComfyUI): a short tone saved once, so demo mode stays clickable end to end.
 */
function demoVoice(): string {
  const found = db().prepare("SELECT rel_path FROM assets WHERE name = 'fuobe-demo-voice.wav' LIMIT 1").get() as { rel_path: string } | undefined;
  if (found) return fileUrl(found.rel_path);
  const rate = 16000;
  const n = rate * 2;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.2 * 32767 * Math.min(1, i / 800, (n - i) / 800)), 44 + i * 2);
  return saveFile({ data: buf, contentType: "audio/wav", name: "fuobe-demo-voice.wav", source: "upload" }).url;
}

/** Whether a model's operation would run as a demo right now. */
function runsAsDemo(modelId: string, op: GenerationRequest["op"]): boolean {
  const m = getModel(modelId);
  if (!m || !op) return true;
  try {
    return chooseRoute(routesFor(m, op)).demo;
  } catch {
    return false;
  }
}

function graphInput(ep: FacelessEpisode, blocks = ep.script.blocks, stillEdits?: StillEdits): GraphInput {
  const genre = genreInfo(ep.channelId ? getChannel(ep.channelId)?.genre : "education");
  const s = ep.settings;
  const narration = ENGINE_MODELS[s.engine].narration;
  let fallbackVoice: string | undefined;
  if (s.engine === "open" && s.voice?.kind !== "sample") {
    if (!runsAsDemo(narration, "tts")) throw new FacelessError("Pick the narrator's voice: record or upload 10–60 s of speech, or use one of your saved voices (open-source narration clones a voice)");
    fallbackVoice = demoVoice();
  }
  return { feature: ep.kind, title: ep.title, genre, settings: s, blocks, stillEdits, fallbackVoice };
}

function buildGraph(ep: FacelessEpisode, blocks = ep.script.blocks, stillEdits?: StillEdits): GraphStep[] {
  try {
    return buildEpisodeGraph(graphInput(ep, blocks, stillEdits), getModel);
  } catch (e) {
    if (e instanceof FacelessError) throw e;
    throw new FacelessError((e as Error).message, 422);
  }
}

/**
 * Cloud episodes with a music bed are mixed by the open mixer (the cloud soundtrack tool takes one
 * track): it must run the way the rest does.
 */
function checkMusicMix(ep: FacelessEpisode, graph: GraphStep[]): void {
  if (ep.settings.engine !== "cloud" || !ep.settings.music) return;
  const mix = graph.find((s) => s.key === "mix")!;
  if (engineMode() === "cloud") throw new FacelessError("A music bed is mixed under the voice by the open-source mixer, and this install is set to cloud APIs only — turn music off", 422);
  const mixDemo = runsAsDemo(mix.request.modelId, "mux");
  const videoDemo = runsAsDemo(graph.find((s) => s.part === "clip")!.request.modelId, "i2v");
  if (mixDemo && !videoDemo) throw new FacelessError("A music bed is mixed under the voice by ComfyUI (the cloud soundtrack tool takes one track) — start ComfyUI, or turn music off", 422);
}

function toPipelineSteps(graph: GraphStep[]) {
  return graph.map((s) => ({ key: s.key, request: { ...s.request, step: s.request.step ?? { label: s.label, index: 0, of: 1 } }, after: s.after, chain: s.chain }));
}

/** Start the render: every step as a chained generation (validated as a whole before anything is created). */
export function renderEpisode(id: string): FacelessEpisode {
  const ep = mustEpisode(id);
  if (ep.status === "writing") throw new FacelessError("The script is still being written", 409);
  if (ep.status === "rendering") throw new FacelessError("This episode is already rendering", 409);
  if (ep.plan) throw new FacelessError(ep.status === "done" ? "This episode is done — change scenes in the timeline" : "This episode already rendered — use Retry", 409);
  const blocks = normalizeBlocks(ep.script.blocks);
  if (!blocks.length) throw new FacelessError("The script has no scenes yet");
  const ready = { ...ep, script: { ...ep.script, blocks } };
  const graph = buildGraph(ready, blocks);
  checkMusicMix(ready, graph);
  let pipeline: ReturnType<typeof createPipeline>;
  try {
    pipeline = createPipeline(toPipelineSteps(graph));
  } catch (e) {
    throw new FacelessError((e as Error).message, 422);
  }
  const plan: EpisodePlan = {
    batchId: pipeline.batchId,
    ids: Object.fromEntries(Object.entries(pipeline.byKey).map(([k, g]) => [k, g.id])),
    changes: [],
  };
  updateEpisodeRow(id, { status: "rendering", error: null, plan_json: JSON.stringify(plan), script_json: JSON.stringify(ready.script) });
  return mustEpisode(id);
}

/**
 * Create the `rerun` steps of a graph again, waiting on the new ones or on the current generations of
 * the steps that are kept. Everything is previewed first, so a bad step creates nothing.
 */
function relaunch(graph: GraphStep[], ids: Record<string, string>, rerun: string[], batchId: string): Record<string, string> {
  const todo = new Set(rerun);
  const steps = graph.filter((s) => todo.has(s.key));
  for (const s of graph) if (!todo.has(s.key) && !ids[s.key]) throw new FacelessError(`“${s.label}” has no result to reuse — try again`, 409);
  const previews = steps.map((s) => {
    try {
      return { key: s.key, label: s.label, ...previewChained({ ...s.request, ...(s.chain && { chain: s.chain }) }, s.after?.length ?? 0) };
    } catch (e) {
      throw new FacelessError(`${s.label}: ${(e as Error).message}`, 422);
    }
  });
  const demo = previews.find((p) => p.demo);
  const real = previews.find((p) => !p.demo);
  if (demo && real) throw new FacelessError(`${demo.label} would run as a demo (${demo.model.name} isn't connected) while ${real.label} runs for real — connect it in Settings, or turn on demo mode`, 422);
  const next = { ...ids };
  const made: Generation[] = [];
  try {
    for (const s of steps) {
      const after = s.after ?? [];
      const [g] = createGenerations({ ...s.request, ...(s.chain && { chain: s.chain }), step: s.request.step ?? { label: s.label, index: 0, of: 1 } }, { batchId, ...(after.length && { dependsOn: after.map((k) => next[k]) }) });
      next[s.key] = g.id;
      made.push(g);
    }
  } catch (e) {
    for (const g of made) void cancelGeneration(g.id);
    throw new FacelessError((e as Error).message, 422);
  }
  return next;
}

const statusMap = (ids: Record<string, string>) =>
  Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, getGeneration(id)?.status])) as Record<string, string | undefined>;

/** Redo the steps that failed (and what waited on them); finished steps are kept. */
export function retryEpisode(id: string): FacelessEpisode {
  const ep = mustEpisode(id);
  if (!ep.plan) return renderEpisode(id);
  const graph = buildGraph(ep, ep.script.blocks, ep.plan.stillEdits);
  const status = statusMap(ep.plan.ids);
  if (Object.values(status).some((s) => s === "queued" || s === "running")) {
    // Steps still waiting on a failed one fail on the runner's next tick; retry those too.
    const live = graph.filter((s) => status[s.key] === "queued" || status[s.key] === "running");
    if (live.some((s) => !s.after?.length || s.after.some((a) => status[a] !== "failed" && status[a] !== "canceled"))) throw new FacelessError("Still rendering — retry once it stops", 409);
  }
  const plan = planRetry(graph, Object.fromEntries(Object.entries(status).map(([k, v]) => [k, v === "queued" || v === "running" ? "failed" : v])));
  if (!plan.rerun.length) return ep;
  for (const k of plan.rerun) if (ep.plan.ids[k]) void cancelGeneration(ep.plan.ids[k]);
  const ids = relaunch(graph, ep.plan.ids, plan.rerun, ep.plan.batchId);
  updateEpisodeRow(id, { status: "rendering", error: null, plan_json: JSON.stringify({ ...ep.plan, ids } satisfies EpisodePlan) });
  return mustEpisode(id);
}

// ---------------------------------------------------------------------------
// The timeline editor

export interface ChangeInput {
  blocks: string[];
  part: ChangePart;
  /** Picture / motion: what to change. */
  instruction?: string;
  /** Narration: the block's new lines (one per block). */
  narration?: string[];
}

/** The blocks, picture edits and graph a change would render. */
function changed(ep: FacelessEpisode, c: ChangeInput) {
  if (!ep.plan) throw new FacelessError("Render the episode first", 409);
  const ids = c.blocks.filter((b) => ep.script.blocks.some((x) => x.id === b));
  if (!ids.length) throw new FacelessError("Pick a scene to change");
  const instruction = c.instruction?.trim() ?? "";
  let blocks = ep.script.blocks;
  const stillEdits: StillEdits = { ...ep.plan.stillEdits };
  if (c.part === "narration") {
    if (!c.narration || c.narration.length !== ids.length || c.narration.some((n) => !n.trim())) throw new FacelessError("Write the new lines for each scene");
    // The block keeps its length (its clips are reused); lines that no longer fit are flagged in the editor.
    blocks = blocks.map((b) => (ids.includes(b.id) ? { ...b, narration: c.narration![ids.indexOf(b.id)].replace(/\s+/g, " ").trim() } : b));
  } else {
    if (!instruction) throw new FacelessError(c.part === "picture" ? "Describe what to change in the picture" : "Describe the new movement");
    if (c.part === "motion") blocks = blocks.map((b) => (ids.includes(b.id) ? { ...b, motion: instruction } : b));
    if (c.part === "picture") {
      for (const b of ids) {
        const still = getGeneration(ep.plan.ids[`still-${b}`] ?? "");
        const source = still?.status === "succeeded" ? still.outputs.find((o) => o.kind === "image")?.url : undefined;
        if (source) stillEdits[b] = { source, instruction };
        else delete stillEdits[b];
      }
      // A picture that never rendered is made again from its description plus the change.
      blocks = blocks.map((b) => (ids.includes(b.id) && !stillEdits[b.id] ? { ...b, visual: `${b.visual}. ${instruction}` } : b));
    }
  }
  const graph = buildGraph(ep, blocks, stillEdits);
  // Steps that failed earlier are redone with the change, so the new version can finish.
  const status = statusMap(ep.plan.ids);
  const broken = graph.filter((s) => !status[s.key] || status[s.key] === "failed" || status[s.key] === "canceled").map((s) => s.key);
  return { graph, blocks, stillEdits, plan: planRerun(graph, [...changedKeys(graph, ids, c.part), ...broken]), ids };
}

export function previewChange(id: string, c: ChangeInput): ChangePreview {
  const ep = mustEpisode(id);
  const { graph, plan } = changed(ep, c);
  const est = estimateGraph(graph, getModel, plan.rerun);
  const demo = plan.rerun.some((k) => {
    const s = graph.find((x) => x.key === k)!;
    try {
      return previewChained({ ...s.request, ...(s.chain && { chain: s.chain }) }, s.after?.length ?? 0).demo;
    } catch {
      return false;
    }
  });
  return { rerun: plan.rerun, labels: plan.rerun.map((k) => graph.find((s) => s.key === k)!.label), costUsd: est.unknown ? null : est.total, demo };
}

/** Re-run what the change touches (that block's steps, the joins after it, the mix, the subtitles); Undo keeps the version before. */
export function applyChange(id: string, c: ChangeInput): FacelessEpisode {
  const ep = mustEpisode(id);
  if (ep.status === "rendering") throw new FacelessError("Wait for the current render to finish before changing scenes", 409);
  const { graph, blocks, stillEdits, plan, ids } = changed(ep, c);
  const est = estimateGraph(graph, getModel, plan.rerun);
  const next = relaunch(graph, ep.plan!.ids, plan.rerun, ep.plan!.batchId);
  const final = getGeneration(ep.plan!.ids[finalKey(graph)] ?? "");
  const updated: EpisodePlan = {
    ...ep.plan!,
    ids: next,
    stillEdits,
    previous: { ids: ep.plan!.ids, blocks: ep.script.blocks, stillEdits: ep.plan!.stillEdits },
    lastFinal: final?.status === "succeeded" ? final.id : ep.plan!.lastFinal,
    changes: [...ep.plan!.changes, { at: Date.now(), blocks: ids, part: c.part, instruction: c.part === "narration" ? (c.narration ?? []).join(" / ") : (c.instruction ?? ""), costUsd: est.unknown ? null : est.total }].slice(-50),
  };
  updateEpisodeRow(id, { status: "rendering", error: null, plan_json: JSON.stringify(updated), script_json: JSON.stringify({ ...ep.script, blocks }) });
  return mustEpisode(id);
}

/** Back to the version before the last change (its generations are still there; nothing is refunded). */
export function undoChange(id: string): FacelessEpisode {
  const ep = mustEpisode(id);
  const prev = ep.plan?.previous;
  if (!prev) throw new FacelessError("Nothing to undo", 409);
  for (const [k, gid] of Object.entries(ep.plan!.ids)) if (prev.ids[k] !== gid) void cancelGeneration(gid);
  const plan: EpisodePlan = { ...ep.plan!, ids: prev.ids, stillEdits: prev.stillEdits, previous: undefined, lastFinal: undefined };
  updateEpisodeRow(id, { status: "rendering", plan_json: JSON.stringify(plan), script_json: JSON.stringify({ ...ep.script, blocks: prev.blocks }) });
  return mustEpisode(id);
}

// ---------------------------------------------------------------------------
// Reading

function finalOf(ep: FacelessEpisode): Generation | null {
  if (!ep.plan) return null;
  const key = ep.plan.ids.captions ? "captions" : "mix";
  const g = getGeneration(ep.plan.ids[key] ?? "");
  return g?.status === "succeeded" ? g : null;
}

/** The episode's status from its generations (saved when it changes). */
function settle(ep: FacelessEpisode, gens: Map<string, Generation | null>): EpisodeStatus {
  if (ep.status === "writing" && !writing().has(ep.id)) {
    // A restart while the script was being written.
    updateEpisodeRow(ep.id, { status: "write-failed", error: "Interrupted while writing the script — try again" });
    return "write-failed";
  }
  if (!ep.plan || ep.status === "writing" || ep.status === "write-failed" || ep.status === "review") return ep.status;
  const list = Object.entries(ep.plan.ids).map(([k, id]) => [k, gens.get(id) ?? null] as const);
  const final = list.find(([k]) => k === (ep.plan!.ids.captions ? "captions" : "mix"))?.[1];
  const active = list.some(([, g]) => g && (g.status === "queued" || g.status === "running"));
  const broken = list.find(([, g]) => !g || g.status === "failed" || g.status === "canceled");
  const status: EpisodeStatus = final?.status === "succeeded" ? "done" : !active && broken ? "failed" : "rendering";
  const error = status === "failed" ? (broken?.[1]?.error ?? "A step was deleted — retry to make it again") : null;
  if (status !== ep.status || error !== ep.error) updateEpisodeRow(ep.id, { status, error });
  return status;
}

const stepProgress = (g: Generation | null) => (!g ? 0 : g.status === "succeeded" ? 1 : g.status === "running" ? Math.max(0.05, Math.min(0.95, g.progress ?? 0.1)) : 0);

export function episodeView(id: string): EpisodeView {
  const ep = mustEpisode(id);
  const gens = new Map<string, Generation | null>();
  for (const gid of Object.values(ep.plan?.ids ?? {})) gens.set(gid, getGeneration(gid));
  const status = settle(ep, gens);
  const current = { ...ep, status, error: status === ep.status ? ep.error : (episodeRow(id)?.error ?? null) };
  let graph: GraphStep[] = [];
  try {
    if (current.script.blocks.length) graph = buildEpisodeGraph({ ...graphInputSafe(current), blocks: current.script.blocks, stillEdits: ep.plan?.stillEdits }, getModel);
  } catch {
    graph = [];
  }
  const steps = graph.map((s) => ({ key: s.key, part: s.part, block: s.block, label: s.label, generation: ep.plan?.ids[s.key] ? (gens.get(ep.plan.ids[s.key]) ?? null) : null }));
  const final = finalOf(current);
  const previousFinal = !final && ep.plan?.lastFinal ? getGeneration(ep.plan.lastFinal) : null;
  const spent = [...gens.values()].reduce((n, g) => n + (g && g.status !== "failed" && g.status !== "canceled" ? (g.costUsd ?? 0) : 0), 0);
  return {
    episode: current,
    channel: current.channelId ? getChannel(current.channelId) : null,
    steps,
    final,
    previousFinal: previousFinal?.status === "succeeded" ? previousFinal : null,
    progress: steps.length && ep.plan ? steps.reduce((n, s) => n + stepProgress(s.generation), 0) / steps.length : 0,
    spentUsd: Math.round(spent * 100) / 100,
    estimate: graph.length ? estimateGraph(graph, getModel) : null,
  };
}

/** The graph input for reading (never throws for a missing open voice: the view just shows the plan). */
function graphInputSafe(ep: FacelessEpisode): GraphInput {
  try {
    return graphInput(ep);
  } catch {
    return { feature: ep.kind, title: ep.title, genre: genreInfo(ep.channelId ? getChannel(ep.channelId)?.genre : "education"), settings: ep.settings, blocks: ep.script.blocks, fallbackVoice: "/api/files/placeholder.wav" };
  }
}

function toCard(r: EpisodeRow): EpisodeCard {
  const ep = toEpisode(r);
  const ids = Object.values(ep.plan?.ids ?? {});
  const gens = new Map(ids.map((id) => [id, getGeneration(id)] as const));
  const status = ep.plan ? settle(ep, gens) : settle(ep, new Map());
  const final = ep.plan ? (gens.get(ep.plan.ids.captions ?? ep.plan.ids.mix ?? "") ?? null) : null;
  const firstStill = ep.plan ? (gens.get(ep.plan.ids[`still-${ep.script.blocks[0]?.id}`] ?? "") ?? null) : null;
  return {
    id: ep.id,
    channelId: ep.channelId,
    kind: ep.kind,
    title: ep.title,
    status,
    styleId: ep.settings.styleId,
    aspect: ep.settings.aspect,
    seconds: totalSeconds(ep.script.blocks) || ep.settings.length,
    favorite: ep.favorite,
    poster: final?.status === "succeeded" ? final : null,
    still: firstStill?.status === "succeeded" ? firstStill : null,
    updating: status === "rendering" && !!ep.plan?.lastFinal,
    progress: ids.length ? [...gens.values()].reduce((n, g) => n + stepProgress(g ?? null), 0) / ids.length : 0,
    createdAt: ep.createdAt,
  };
}

export function listEpisodes(o: { channelId?: string; kind?: "faceless" | "explainer"; q?: string; liked?: boolean; limit?: number }): EpisodeCard[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (o.channelId) {
    where.push("channel_id = ?");
    args.push(o.channelId);
  }
  if (o.kind) {
    where.push("kind = ?");
    args.push(o.kind);
  }
  if (o.liked) where.push("favorite = 1");
  const q = o.q?.trim();
  if (q) {
    where.push("(title LIKE ? OR topic LIKE ?)");
    args.push(`%${q}%`, `%${q}%`);
  }
  const rows = db()
    .prepare(`SELECT * FROM faceless_episodes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`)
    .all(...args, Math.max(1, Math.min(o.limit ?? 60, 200))) as EpisodeRow[];
  return rows.map(toCard);
}

// ---------------------------------------------------------------------------
// Estimates, voices, links

/** What an episode would cost and whether it would run as a demo, before or after the script exists. */
export function estimateEpisode(input: { kind: "faceless" | "explainer"; settings: EpisodeSettings; blocks?: Partial<ScriptBlock>[]; genre?: FacelessGenre }): EstimateResult {
  const settings = { ...input.settings, styleRefs: input.settings.styleRefs.slice(0, 3) };
  const blocks = input.blocks?.length ? normalizeBlocks(input.blocks) : placeholderBlocks(settings.auto ? AUTO_SECONDS : settings.length);
  const seconds = totalSeconds(blocks);
  const fake: FacelessEpisode = {
    id: "estimate",
    channelId: null,
    kind: input.kind,
    title: "Estimate",
    topic: "",
    status: "review",
    error: null,
    settings,
    script: { blocks, source: "ai" },
    plan: null,
    sources: [],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
  };
  let graph: GraphStep[];
  try {
    graph = buildEpisodeGraph({ ...graphInputSafe(fake), genre: genreInfo(input.genre) }, getModel);
  } catch (e) {
    return { estimate: { total: 0, parts: {}, unknown: true }, demo: true, seconds, blocks: blocks.length, error: (e as Error).message };
  }
  let error: string | undefined;
  let demo = false;
  try {
    cleanSettings(settings);
    checkMusicMix(fake, graph);
    if (settings.engine === "open" && settings.voice?.kind !== "sample" && !runsAsDemo(ENGINE_MODELS.open.narration, "tts")) {
      error = "Pick the narrator's voice: record or upload 10–60 s of speech, or use one of your saved voices";
    }
  } catch (e) {
    error = (e as Error).message;
  }
  // Every distinct model once is enough to know the mode (and to catch a step the install can't run).
  const seen = new Set<string>();
  for (const s of graph) {
    const k = `${s.request.modelId}:${s.part}`;
    if (seen.has(k)) continue;
    seen.add(k);
    try {
      const p = previewChained({ ...s.request, ...(s.chain && { chain: s.chain }) }, s.after?.length ?? 0);
      demo ||= p.demo;
    } catch (e) {
      error ??= `${s.label}: ${(e as Error).message}`;
    }
  }
  return { estimate: estimateGraph(graph, getModel), demo, seconds, blocks: blocks.length, ...(error && { error }) };
}

/** A short sample of a premade narrator (one cheap speech generation, reused once made). */
export function voicePreview(voice: NarratorVoice & { kind: "preset" }): Generation {
  const modelId = ENGINE_MODELS.cloud.narration;
  const model = getModel(modelId)!;
  const v = model.options.voices?.find((x) => x.id === voice.id);
  if (!v) throw new FacelessError("Unknown voice");
  const existing = db()
    .prepare(
      "SELECT g.id FROM generations g LEFT JOIN generation_trash t ON t.generation_id = g.id WHERE t.deleted_at IS NULL AND g.feature = 'faceless-voice' AND g.model_id = ? AND json_extract(g.request_json, '$.params.voice') = ? AND g.status IN ('queued', 'running', 'succeeded') ORDER BY g.created_at DESC LIMIT 1",
    )
    .get(modelId, v.id) as { id: string } | undefined;
  const found = existing && getGeneration(existing.id);
  if (found) return found;
  return createGenerations({ feature: "faceless-voice", modelId, op: "tts", prompt: previewLine(v.name), params: { voice: v.id }, title: `${v.name} · narrator sample` })[0];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Readable text of an HTML page: title plus paragraphs, scripts and styles dropped. */
export function pageText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ?? null;
  const body = html
    .replace(/<(head|script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) =>
      e.startsWith("#x") ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith("#") ? String.fromCodePoint(Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2)
    .join("\n");
  const decode = (s: string) => s.replace(/&(\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m).replace(/\s+/g, " ").trim();
  return { title: title ? decode(title) : null, text: body };
}

/** A link source for the Explainer: fetched with the SSRF-safe fetch, then summarised for the writer. */
export async function summarizeLink(url: string, engine: Engine): Promise<Extract<ExplainerSource, { kind: "link" }>> {
  let res: Awaited<ReturnType<typeof fetchRemote>>;
  try {
    res = await fetchRemote(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 15_000 });
  } catch (e) {
    throw new FacelessError((e as Error).message || "Couldn't open that link", 422);
  }
  const type = res.contentType ?? "";
  if (!/^text\/|html|xml|json/.test(type)) throw new FacelessError("That link isn't a web page or text — upload the file instead", 422);
  const raw = res.data.toString("utf8");
  const { title, text } = /html|xml/.test(type) ? pageText(raw) : { title: null, text: raw };
  if (text.length < 40) throw new FacelessError("That page has no readable text", 422);
  const summary = await askLlm(
    engine,
    "You summarise web pages for a video script writer. Reply with the key facts, numbers, names and explanations as short plain sentences (at most 250 words). No preamble.",
    `Page: ${title ?? url}\n\n${text.slice(0, 24_000)}`,
  );
  return { kind: "link", url: res.url, title: title?.slice(0, 160), text: (summary ?? text).slice(0, 6000) };
}

// ---------------------------------------------------------------------------
// Request schemas and the route helper (src/app/api/faceless/**, src/app/api/explainer/**)

const FileUrl = z.string().startsWith("/api/files/").max(500);
export const VoiceSchema = z.union([
  z.object({ kind: z.literal("preset"), id: z.string().min(1).max(80), name: z.string().max(80).optional() }),
  z.object({ kind: z.literal("sample"), url: FileUrl, name: z.string().max(120).optional() }),
]);
export const GenreSchema = z.enum(["education", "history", "kids", "storytelling"]);
export const EngineSchema = z.enum(["cloud", "open"]);

export const SettingsSchema = z.object({
  engine: EngineSchema,
  length: z.number().int().min(15).max(600),
  animation: z.enum(["animated", "frames"]),
  aspect: z.enum(["16:9", "9:16"]),
  subtitles: z.boolean(),
  music: z.boolean(),
  styleId: z.string().min(1).max(60),
  styleRefs: z.array(FileUrl).max(3, "Up to 3 style references"),
  voice: VoiceSchema.nullable(),
  elements: z.array(z.string().max(60)).max(8),
  videoModel: z.string().max(60).optional(),
  resolution: z.string().max(10).optional(),
  auto: z.boolean().optional(),
});

export const BlockSchema = z.object({
  id: z.string().max(40).optional(),
  narration: z.string().max(2000),
  visual: z.string().max(1200),
  motion: z.string().max(400).optional(),
  seconds: z.number().optional(),
});

export const SourceSchema = z.union([
  z.object({ kind: z.literal("image"), url: FileUrl, name: z.string().max(200).optional() }),
  z.object({ kind: z.literal("text"), name: z.string().max(200), text: z.string().min(1).max(20_000) }),
  z.object({ kind: z.literal("link"), url: z.string().url().max(2000), title: z.string().max(200).optional(), text: z.string().min(1).max(8000) }),
]);

export const ChangeSchema = z.object({
  blocks: z.array(z.string().max(40)).min(1).max(12),
  part: z.enum(["picture", "motion", "narration"]),
  instruction: z.string().max(1000).optional(),
  narration: z.array(z.string().max(2000)).max(12).optional(),
  apply: z.boolean().optional(),
});

/** Parse a JSON body; a schema's own message (e.g. "Up to 3 style references") wins over the generic one. */
export async function body<S extends z.ZodType>(request: Request, schema: S, message: string): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const custom = parsed.error.issues.find((i) => i.message && !/^(Invalid|Expected|Too|Unrecognized)/.test(i.message))?.message;
    throw new FacelessError(custom ?? message, 400);
  }
  return parsed.data;
}

/** Turn thrown errors into the API's `{ error }` responses. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof FacelessError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[faceless]", e);
    return Response.json({ error: (e as Error).message || "Something went wrong" }, { status: 500 });
  }
}
