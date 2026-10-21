import type { Cue } from "@/lib/cues";
import type { ChainSlot, Engine, Generation, GenerationRequest } from "@/lib/catalog/types";
import { languageByCode, supportsTarget, type DubLanguage, type DubRoute } from "./languages";
import { timelineFor } from "./timeline";

/**
 * Translate & dub, planned as plain data (client and server). Two ways to dub:
 *
 * - One shot (cloud): HeyGen Translate or ElevenLabs Dubbing take the video and return it dubbed.
 * - Step by step (both engines), as two pipelines with a review in between:
 *     prepare: voice stem (+ background on the open engine) → timed transcript → translation per language
 *     review:  the person edits the translated lines (nothing is spoken yet)
 *     voice:   speech in the cloned voice → lips re-synced → the new voice over the background
 *
 * The new voice follows the reviewed timing: the lines are grouped into phrases (lines less than
 * PHRASE_GAP apart are spoken in one take), each phrase is spoken on its own and placed at its cue's
 * start on a silent track exactly as long as the source (the "timeline" step), so pauses are kept, the
 * lip re-sync covers the whole clip and the dubbed video is as long as the original.
 *
 * Open engine: MelBand RoFormer splits voice and background and Qwen3-ASR 1.7B times the voice stem, in
 * one job (oss-voice-separate); the local LLM translates the cues (oss-text-llm); Chatterbox Multilingual
 * speaks each phrase in the cloned voice; the audio-timeline workflow lays them out; InfiniteTalk
 * re-syncs the lips and the mux mixes the voice over the background stem.
 * Cloud: ElevenLabs Voice Isolation (the clean voice to clone), Scribe v2 on it (transcript), Claude or
 * Ollama (translation), ElevenLabs v4 speaks each phrase, fal's compose lays them out over a blank still
 * (its soundtrack is read back as audio), Chatterbox voice conversion turns the track into the speaker's
 * voice and Sync Lipsync 3 re-syncs the lips. The cloud result carries the dubbed voice only (that route
 * has no background stem) — the music and effects are kept by the open route and the one-shot models.
 */

export const DUB_FEATURE = "dub";

export const ONE_SHOT_MODELS = ["heygen-translate", "heygen-translate-fast", "elevenlabs-dubbing"] as const;
export type OneShotModel = (typeof ONE_SHOT_MODELS)[number];

export const DUB_STEP_MODELS = {
  cloud: {
    voice: "elevenlabs-voice-isolation",
    words: "scribe-v2",
    translate: "text-llm",
    speech: "elevenlabs-v4",
    timeline: "compose-timeline",
    soundtrack: "extract-soundtrack",
    clone: "chatterbox-vc-cloud",
    lips: "sync-lipsync-3",
    mux: "merge-audio-video",
  },
  // The stems step also times the voice (Qwen3-ASR 1.7B + forced aligner inside the same workflow).
  open: { stems: "oss-voice-separate", translate: "oss-text-llm", speech: "oss-chatterbox", timeline: "oss-audio-timeline", lips: "oss-infinitetalk-v2v", mux: "oss-mux" },
} as const;

/** The ElevenLabs voice the cloud route speaks with before it's converted into the speaker's own voice. */
export const CLOUD_BASE_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George

/** A 64×64 black PNG: the picture fal's compose renders the cloud voice track over (only its soundtrack is kept). */
export const BLANK_FRAME = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAAAAACPAi4CAAAAG0lEQVR42u3BgQAAAADDoPlT3+AEVQEAAAB8AxBAAAG9PLePAAAAAElFTkSuQmCC";

export interface DubStep {
  key: string;
  request: GenerationRequest;
  after?: string | string[];
  chain?: ChainSlot[];
}

export const translateKey = (code: string) => `translate:${code}`;

const step = (label: string, index: number, of: number) => ({ label, index, of });

function targetsFor(route: DubRoute, codes: string[]): DubLanguage[] {
  const out: DubLanguage[] = [];
  for (const code of codes) {
    const lang = languageByCode(code);
    if (!lang) throw new Error(`Unknown language “${code}”`);
    if (!supportsTarget(route, lang)) throw new Error(`${lang.name} isn't available ${route === "open" ? "on the open engine (Chatterbox speaks 23 languages)" : "on this model"}`);
    if (!out.includes(lang)) out.push(lang);
  }
  if (!out.length) throw new Error("Pick at least one language to dub into");
  return out;
}

export interface PrepareInput {
  engine: Engine;
  video: string;
  /** ISO code of the spoken language, or "auto". */
  source?: string;
  targets: string[];
  title?: string;
}

/** Step 1 (both engines): the voice to clone, the timed transcript and one translation per target language. */
export function prepareSteps(o: PrepareInput): DubStep[] {
  const targets = targetsFor(o.engine === "open" ? "open" : "cloud-steps", o.targets);
  const source = o.source && o.source !== "auto" ? o.source : undefined;
  const from = languageByCode(source)?.name;
  const n = targets.length + 2;
  const base = { feature: DUB_FEATURE, ...(o.title && { batchTitle: o.title }) };
  const translate = (lang: DubLanguage, i: number, after: string, of = n): DubStep => ({
    key: translateKey(lang.code),
    after,
    chain: [{ slot: "prompt" }],
    request: {
      ...base,
      modelId: o.engine === "open" ? DUB_STEP_MODELS.open.translate : DUB_STEP_MODELS.cloud.translate,
      op: "translate",
      params: { targetLanguage: lang.name, ...(from && { sourceLanguage: from }) },
      step: step(`Translate · ${lang.name}`, i, of),
    },
  });
  const lang = source ? { params: { sourceLanguage: source } } : {};
  // The transcript is made from the clean voice stem (music and effects removed), so the timings follow the speech.
  if (o.engine === "open") {
    // One job splits the stems and times the voice stem (Qwen3-ASR 1.7B); the translations read its cues.
    const m = targets.length + 1;
    return [
      { key: "stems", request: { ...base, modelId: DUB_STEP_MODELS.open.stems, op: "separate-audio", inputs: { video: o.video }, ...lang, step: step("Voice, background and transcript", 0, m) } },
      ...targets.map((l, i) => translate(l, i + 1, "stems", m)),
    ];
  }
  return [
    { key: "voice", request: { ...base, modelId: DUB_STEP_MODELS.cloud.voice, op: "separate-audio", inputs: { video: o.video }, step: step("Clean voice", 0, n) } },
    { key: "words", after: "voice", chain: [{ slot: "audio" }], request: { ...base, modelId: DUB_STEP_MODELS.cloud.words, op: "transcribe", ...lang, step: step("Transcript", 1, n) } },
    ...targets.map((l, i) => translate(l, i + 2, "words")),
  ];
}

export interface VoiceInput {
  engine: Engine;
  video: string;
  lang: string;
  /** The reviewed lines, in order. */
  cues: Cue[];
  /** The clean voice to clone (the voice stem / isolated voice). */
  voiceRef: string;
  /** Open engine: the background stem mixed back under the new voice. */
  background?: string;
  /** Re-sync the lips (default on). Off: the new voice is laid over the original picture. */
  lipsync?: boolean;
  /** Length of the source video (seconds): the voice track is exactly this long. Unknown: a second past the last line. */
  duration?: number;
  title?: string;
}

/** The words the voice speaks: the reviewed lines, one per line. */
export function spokenText(cues: Cue[]): string {
  return cues
    .map((c) => c.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Lines closer than this (seconds) are one breath: spoken in one take, so the speech flows. */
export const PHRASE_GAP = 0.4;
/** A take this long (seconds) starts a new phrase anyway, so long speech re-syncs to the cues often. */
export const PHRASE_MAX = 12;

/** One take of the new voice: it starts at `start`; `end` is where its lines end in the source. */
export interface DubPhrase {
  start: number;
  end: number;
  text: string;
}

/**
 * The reviewed lines as takes: lines less than PHRASE_GAP apart join (up to PHRASE_MAX seconds), empty
 * lines are skipped and lines at or past the end of the video (when its length is known) are dropped.
 */
export function dubPhrases(cues: Cue[], length?: number): DubPhrase[] {
  const lines = cues
    .map((c) => ({ start: Math.max(0, c.start), end: Math.max(c.start, c.end), text: c.text.replace(/\s+/g, " ").trim() }))
    .filter((c) => c.text && (!length || c.start < length))
    .sort((a, b) => a.start - b.start);
  const out: DubPhrase[] = [];
  for (const c of lines) {
    const last = out.at(-1);
    if (last && c.start - last.end < PHRASE_GAP && c.end - last.start <= PHRASE_MAX) {
      last.end = Math.max(last.end, c.end);
      last.text = `${last.text} ${c.text}`;
    } else out.push({ ...c });
  }
  return out;
}

/** The voice track's length: the video's, else a second past the last line. */
export function trackLength(phrases: DubPhrase[], duration?: number): number {
  if (duration && duration > 0) return duration;
  return Math.ceil(((phrases.at(-1)?.end ?? 0) + 1) * 10) / 10;
}

/**
 * Step 2: speak the reviewed translation in the cloned voice, one take per phrase, and lay the takes on
 * the video's timeline; then re-sync the lips and put the new voice on the video. Step keys: "line:0…"
 * (the takes), "track" (the voice track, as long as the video), cloud "soundtrack" + "clone", open "lips",
 * and "film" (the dubbed video).
 */
export function voiceSteps(o: VoiceInput): DubStep[] {
  const lang = languageByCode(o.lang);
  if (!lang) throw new Error(`Unknown language “${o.lang}”`);
  if (o.engine === "open" && !supportsTarget("open", lang)) throw new Error(`${lang.name} isn't available on the open engine`);
  const phrases = dubPhrases(o.cues, o.duration);
  if (!phrases.length) throw new Error(o.cues.some((c) => c.text.trim()) ? "Every line starts after the end of the video — check the times" : "There are no lines to speak — write at least one");
  const length = trackLength(phrases, o.duration);
  const timeline = timelineFor(
    phrases.map((p) => p.start),
    length,
  );
  const lips = o.lipsync !== false;
  const base = { feature: DUB_FEATURE, ...(o.title && { batchTitle: o.title }) };
  const tag = (label: string) => `${label} · ${lang.name}`;
  const k = phrases.length;
  const lineKeys = phrases.map((_, i) => `line:${i}`);
  // Every take at its cue time over silence as long as the video.
  const track = (modelId: string, of: number, inputs?: GenerationRequest["inputs"]): DubStep => ({
    key: "track",
    after: lineKeys,
    chain: lineKeys.map(() => ({ slot: "audios" as const })),
    request: { ...base, modelId, op: "timeline", ...(inputs && { inputs }), params: { duration: length, extra: { timeline } }, step: step(tag("Voice on the timeline"), k, of) },
  });
  if (o.engine === "open") {
    const m = DUB_STEP_MODELS.open;
    const n = k + (lips ? 3 : 2);
    const steps: DubStep[] = phrases.map((p, i) => ({
      key: lineKeys[i],
      request: { ...base, modelId: m.speech, op: "tts", prompt: p.text, inputs: { voiceAudio: o.voiceRef }, params: { targetLanguage: lang.chatterbox }, step: step(tag(`Line ${i + 1} of ${k}`), i, n) },
    }));
    steps.push(track(m.timeline, n));
    if (lips) {
      steps.push({ key: "lips", after: "track", chain: [{ slot: "audio" }], request: { ...base, modelId: m.lips, op: "lipsync", inputs: { video: o.video }, step: step(tag("Lips"), k + 1, n) } });
    }
    steps.push({
      key: "film",
      after: lips ? ["lips", "track"] : "track",
      chain: lips ? [{ slot: "video" }, { slot: "audio" }] : [{ slot: "audio" }],
      request: {
        ...base,
        modelId: m.mux,
        op: "mux",
        inputs: { ...(lips ? {} : { video: o.video }), ...(o.background && { audio2: o.background }) },
        // The background stem sits a little under the new voice.
        ...(o.background && { params: { extra: { backgroundVolumeDb: -3 } } }),
        step: step(tag("Dubbed video"), n - 1, n),
      },
    });
    return steps;
  }
  const m = DUB_STEP_MODELS.cloud;
  const n = k + 4;
  // Seconds of media the per-second and per-minute steps bill for (their price estimate).
  const timed = { params: { duration: length } };
  const steps: DubStep[] = phrases.map((p, i) => ({
    key: lineKeys[i],
    request: { ...base, modelId: m.speech, op: "tts", prompt: p.text, params: { voice: CLOUD_BASE_VOICE }, step: step(tag(`Line ${i + 1} of ${k}`), i, n) },
  }));
  // fal's compose renders a video: the track goes over a blank still and its soundtrack is read back as audio.
  steps.push(track(m.timeline, n, { images: [BLANK_FRAME] }));
  steps.push({ key: "soundtrack", after: "track", chain: [{ slot: "video" }], request: { ...base, modelId: m.soundtrack, op: "separate-audio", ...timed, step: step(tag("Voice track"), k + 1, n) } });
  steps.push({ key: "clone", after: "soundtrack", chain: [{ slot: "audio" }], request: { ...base, modelId: m.clone, op: "voice-change", inputs: { voiceAudio: o.voiceRef }, ...timed, step: step(tag("Their voice"), k + 2, n) } });
  const film = lips ? { modelId: m.lips, op: "lipsync" as const } : { modelId: m.mux, op: "mux" as const };
  steps.push({ key: "film", after: "clone", chain: [{ slot: "audio" }], request: { ...base, ...film, inputs: { video: o.video }, ...timed, step: step(tag("Dubbed video"), k + 3, n) } });
  return steps;
}

/** One-shot cloud dubs: one job per language. */
export function oneShotRequests(o: { model: OneShotModel; video: string; source?: string; targets: string[]; title?: string }): { lang: DubLanguage; request: GenerationRequest }[] {
  const targets = targetsFor(o.model, o.targets);
  const source = o.source && o.source !== "auto" ? o.source : undefined;
  return targets.map((lang, i) => ({
    lang,
    request: {
      feature: DUB_FEATURE,
      ...(o.title && { batchTitle: o.title }),
      modelId: o.model,
      op: "dub",
      inputs: { video: o.video },
      params: {
        targetLanguage: o.model === "elevenlabs-dubbing" ? lang.eleven : lang.heygen,
        ...(o.model === "elevenlabs-dubbing" && source && { sourceLanguage: source }),
      },
      step: { label: `Dub · ${lang.name}`, index: i, of: targets.length },
    },
  }));
}

// ---------------------------------------------------------------------------
// Sessions (stored by the server, shown by the studio)

export interface DubVoiceRun {
  /** Generation id per step key ("speech", "clone", "lips", "film"). */
  ids: Record<string, string>;
  at: number;
  lipsync: boolean;
}

export interface DubSession {
  id: string;
  title: string;
  engine: Engine;
  mode: "oneshot" | "steps";
  video: string;
  source: string;
  targets: string[];
  model?: OneShotModel;
  /** Length of the source video (seconds), when known: the dubbed voice track is made this long. */
  duration?: number;
  batchId: string;
  /** Step mode: the prepare pipeline's generation ids by step key. */
  prepare?: Record<string, string>;
  /** Reviewed lines per language (saved as the person edits). */
  drafts?: Record<string, Cue[]>;
  /** Voice runs per language, newest last. */
  voices?: Record<string, DubVoiceRun[]>;
  /** One-shot jobs per language. */
  oneshot?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export type DubStage = "preparing" | "review" | "voicing" | "done" | "failed";

/** What a dub step (prepare or voice) costs before it runs. */
export interface DubPrice {
  engine: Engine;
  /** What the priced steps cost together (USD); 0 on the open engine. */
  costUsd: number;
  /** Models with no listed price (ElevenLabs speech per character, the LLM's tokens): not in costUsd. */
  unpriced: string[];
  /** The steps would run as a demo (no key / no GPU): free. */
  demo: boolean;
  steps: number;
}

/** The price as one short line: "≈ $8.13 + ElevenLabs v4", "Demo · free", "Free on your GPU". */
export function priceLine(p: DubPrice): string {
  if (p.demo) return "Demo · free";
  if (p.engine === "open") return "Free on your GPU";
  const usd = p.costUsd > 0 && p.costUsd < 0.01 ? "< $0.01" : `≈ $${p.costUsd.toFixed(2)}`;
  return p.unpriced.length ? `${usd} + ${p.unpriced.join(" + ")}` : usd;
}

/** Characters a voice speaks per second, about (used to flag lines that won't fit before the next one). */
const SPOKEN_CPS = 16;

/** Takes whose words likely run past the next take's start (it would be cut there): their first line's index. */
export function crowdedLines(cues: Cue[], duration?: number): number[] {
  const phrases = dubPhrases(cues, duration);
  const length = trackLength(phrases, duration);
  const out: number[] = [];
  phrases.forEach((p, i) => {
    const room = (i + 1 < phrases.length ? phrases[i + 1].start : length) - p.start;
    if (p.text.length / SPOKEN_CPS > room + 0.25) {
      const first = cues.findIndex((c) => Math.max(0, c.start) === p.start && c.text.trim());
      if (first >= 0) out.push(first);
    }
  });
  return out;
}

/** A session with its generations, as the studio shows it. */
export interface DubSessionView extends DubSession {
  generations: Record<string, Generation>;
}

const done = (g?: Generation) => g?.status === "succeeded";
const broken = (g?: Generation) => g?.status === "failed" || g?.status === "canceled";

/** The translated lines of a language: the saved draft, else the translation step's cues. */
export function reviewCues(s: DubSessionView, code: string): Cue[] | null {
  if (s.drafts?.[code]) return s.drafts[code];
  const g = s.generations[s.prepare?.[translateKey(code)] ?? ""];
  const out = g?.outputs.find((o) => o.kind === "text");
  const cues = out?.meta?.cues;
  if (Array.isArray(cues) && cues.length) return (cues as Cue[]).map((c) => ({ start: c.start, end: c.end, text: c.text }));
  if (typeof out?.text === "string" && out.text.trim()) {
    // A translation without timings (plain text): one line per cue, spread evenly is the best we can do.
    const lines = out.text.split("\n").filter((l) => l.trim());
    return lines.map((text, i) => ({ start: i * 3, end: i * 3 + 2.8, text }));
  }
  return null;
}

/** The stage of one language: still preparing, ready for review, being voiced, done or failed. */
export function languageStage(s: DubSessionView, code: string): DubStage {
  if (s.mode === "oneshot") {
    const g = s.generations[s.oneshot?.[code] ?? ""];
    return done(g) ? "done" : broken(g) ? "failed" : "voicing";
  }
  const prepIds = Object.entries(s.prepare ?? {}).filter(([k]) => !k.startsWith("translate:") || k === translateKey(code)).map(([, id]) => s.generations[id]);
  if (prepIds.some(broken)) return "failed";
  if (!prepIds.every(done)) return "preparing";
  const run = s.voices?.[code]?.at(-1);
  if (!run) return "review";
  const film = s.generations[run.ids.film];
  const all = Object.values(run.ids).map((id) => s.generations[id]);
  if (all.some(broken)) return "failed";
  return done(film) ? "done" : "voicing";
}

/** The clean voice to clone and (open engine) the background, from the finished prepare step. */
export function prepareMedia(s: DubSessionView): { voice?: string; background?: string } {
  const g = s.generations[s.prepare?.[s.engine === "open" ? "stems" : "voice"] ?? ""];
  const audio = (g?.outputs ?? []).filter((o) => o.kind === "audio");
  const stem = (names: string[]) => audio.find((o) => typeof o.meta?.stem === "string" && names.includes(String(o.meta.stem).toLowerCase()))?.url;
  if (s.engine === "open") return { voice: stem(["voice", "vocals", "speech", "target"]) ?? audio[0]?.url, background: stem(["background", "accompaniment", "instrumental", "residual", "no_vocals"]) };
  return { voice: audio[0]?.url };
}

/** The finished dub of a language, if any. */
export function dubResult(s: DubSessionView, code: string): Generation | undefined {
  const id = s.mode === "oneshot" ? s.oneshot?.[code] : s.voices?.[code]?.at(-1)?.ids.film;
  const g = id ? s.generations[id] : undefined;
  return done(g) ? g : undefined;
}
