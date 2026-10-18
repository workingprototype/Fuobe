import type { Cue } from "@/lib/cues";
import type { ChainSlot, Engine, Generation, GenerationRequest } from "@/lib/catalog/types";
import { languageByCode, supportsTarget, type DubLanguage, type DubRoute } from "./languages";

/**
 * Translate & dub, planned as plain data (client and server). Two ways to dub:
 *
 * - One shot (cloud): HeyGen Translate or ElevenLabs Dubbing take the video and return it dubbed.
 * - Step by step (both engines), as two pipelines with a review in between:
 *     prepare: voice stem (+ background on the open engine) → timed transcript → translation per language
 *     review:  the person edits the translated lines (nothing is spoken yet)
 *     voice:   speech in the cloned voice → lips re-synced → the new voice over the background
 *
 * Open engine: MelBand RoFormer splits voice and background (oss-voice-separate), Qwen3-ASR times the
 * voice stem, the local LLM translates the cues (oss-text-llm), Chatterbox Multilingual speaks in the
 * cloned voice, InfiniteTalk re-syncs the lips and the mux mixes the voice over the background stem.
 * Cloud: ElevenLabs Voice Isolation (the clean voice to clone), Scribe v2 on it (transcript), Claude or Ollama
 * (translation), ElevenLabs v4 speaks it and Chatterbox voice conversion turns it into the speaker's voice,
 * Sync Lipsync 3 re-syncs the lips. No cloud model in the catalog mixes two audio tracks (fal's
 * merge-audio-video takes one), so the cloud result carries the dubbed voice only — the background
 * music and effects are kept by the open route and by the one-shot models.
 */

export const DUB_FEATURE = "dub";

export const ONE_SHOT_MODELS = ["heygen-translate", "heygen-translate-fast", "elevenlabs-dubbing"] as const;
export type OneShotModel = (typeof ONE_SHOT_MODELS)[number];

export const DUB_STEP_MODELS = {
  cloud: { voice: "elevenlabs-voice-isolation", words: "scribe-v2", translate: "text-llm", speech: "elevenlabs-v4", clone: "chatterbox-vc-cloud", lips: "sync-lipsync-3", mux: "merge-audio-video" },
  open: { stems: "oss-voice-separate", words: "oss-qwen3-asr", translate: "oss-text-llm", speech: "oss-chatterbox", lips: "oss-infinitetalk-v2v", mux: "oss-mux" },
} as const;

/** The ElevenLabs voice the cloud route speaks with before it's converted into the speaker's own voice. */
export const CLOUD_BASE_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George

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
  const translate = (lang: DubLanguage, i: number, after: string): DubStep => ({
    key: translateKey(lang.code),
    after,
    chain: [{ slot: "prompt" }],
    request: {
      ...base,
      modelId: o.engine === "open" ? DUB_STEP_MODELS.open.translate : DUB_STEP_MODELS.cloud.translate,
      op: "translate",
      params: { targetLanguage: lang.name, ...(from && { sourceLanguage: from }) },
      step: step(`Translate · ${lang.name}`, i, n),
    },
  });
  const lang = source ? { params: { sourceLanguage: source } } : {};
  // The transcript is made from the clean voice stem (music and effects removed), so the timings follow the speech.
  if (o.engine === "open") {
    return [
      { key: "stems", request: { ...base, modelId: DUB_STEP_MODELS.open.stems, op: "separate-audio", inputs: { video: o.video }, step: step("Voice and background", 0, n) } },
      { key: "words", after: "stems", chain: [{ slot: "audio", stem: "voice" }], request: { ...base, modelId: DUB_STEP_MODELS.open.words, op: "transcribe", ...lang, step: step("Transcript", 1, n) } },
      ...targets.map((l, i) => translate(l, i + 2, "words")),
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
  title?: string;
}

/** The words the voice speaks: the reviewed lines, one per line. */
export function spokenText(cues: Cue[]): string {
  return cues
    .map((c) => c.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Step 2: speak the reviewed translation in the cloned voice, re-sync the lips and put the new voice on the video. */
export function voiceSteps(o: VoiceInput): DubStep[] {
  const lang = languageByCode(o.lang);
  if (!lang) throw new Error(`Unknown language “${o.lang}”`);
  const text = spokenText(o.cues);
  if (!text) throw new Error("There are no lines to speak — write at least one");
  const lips = o.lipsync !== false;
  const base = { feature: DUB_FEATURE, ...(o.title && { batchTitle: o.title }) };
  const tag = (label: string) => `${label} · ${lang.name}`;
  if (o.engine === "open") {
    if (!supportsTarget("open", lang)) throw new Error(`${lang.name} isn't available on the open engine`);
    const m = DUB_STEP_MODELS.open;
    const n = lips ? 3 : 2;
    const steps: DubStep[] = [
      {
        key: "speech",
        request: { ...base, modelId: m.speech, op: "tts", prompt: text, inputs: { voiceAudio: o.voiceRef }, params: { targetLanguage: lang.chatterbox }, step: step(tag("Voice"), 0, n) },
      },
    ];
    if (lips) {
      steps.push({ key: "lips", after: "speech", chain: [{ slot: "audio" }], request: { ...base, modelId: m.lips, op: "lipsync", inputs: { video: o.video }, step: step(tag("Lips"), 1, n) } });
    }
    steps.push({
      key: "film",
      after: lips ? ["lips", "speech"] : "speech",
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
  const n = 3;
  const steps: DubStep[] = [
    { key: "speech", request: { ...base, modelId: m.speech, op: "tts", prompt: text, params: { voice: CLOUD_BASE_VOICE }, step: step(tag("Speech"), 0, n) } },
    { key: "clone", after: "speech", chain: [{ slot: "audio" }], request: { ...base, modelId: m.clone, op: "voice-change", inputs: { voiceAudio: o.voiceRef }, step: step(tag("Their voice"), 1, n) } },
  ];
  steps.push(
    lips
      ? { key: "film", after: "clone", chain: [{ slot: "audio" }], request: { ...base, modelId: m.lips, op: "lipsync", inputs: { video: o.video }, step: step(tag("Dubbed video"), 2, n) } }
      : { key: "film", after: "clone", chain: [{ slot: "audio" }], request: { ...base, modelId: m.mux, op: "mux", inputs: { video: o.video }, step: step(tag("Dubbed video"), 2, n) } },
  );
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
