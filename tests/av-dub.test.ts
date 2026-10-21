import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { cueReducer, cueProblems, formatCueTime, normalizeCues, parseCueTime } from "@/lib/av/cue-edit";
import { BLANK_FRAME, crowdedLines, dubPhrases, languageStage, oneShotRequests, PHRASE_MAX, prepareSteps, priceLine, reviewCues, spokenText, voiceSteps, type DubSessionView } from "@/lib/av/dub";
import { DUB_LANGUAGES, supportsTarget } from "@/lib/av/languages";
import { getModel } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";

vi.setConfig({ testTimeout: 120_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-av-dub-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const dub = await import("@/server/dub");
const { saveFile } = await import("@/server/storage");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function settle(id: string, ms = 100_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const clip = () => saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples/demo-landscape.mp4")), contentType: "video/mp4", source: "upload" }).url;

describe("dub languages", () => {
  it("name each language the way its model expects", () => {
    const heygen = new Set(getModel("heygen-translate")!.options.languages);
    const eleven = new Set(getModel("elevenlabs-dubbing")!.options.languages);
    const chatterbox = new Set(getModel("oss-chatterbox")!.options.languages);
    for (const l of DUB_LANGUAGES) {
      if (l.heygen) expect(heygen.has(l.heygen), l.heygen).toBe(true);
      if (l.eleven) expect(eleven.has(l.eleven), l.eleven).toBe(true);
      if (l.chatterbox) expect(chatterbox.has(l.chatterbox), l.chatterbox).toBe(true);
    }
    // Every Chatterbox language is a dub target on the open engine.
    expect(DUB_LANGUAGES.filter((l) => supportsTarget("open", l))).toHaveLength(23);
  });
});

describe("dub pipeline DAGs", () => {
  const video = "/api/files/uploads/clip.mp4";

  it("open: one job splits the stems and times the voice → one translation per language from its cues", () => {
    const steps = prepareSteps({ engine: "open", video, source: "en", targets: ["es", "de"] });
    expect(steps.map((s) => [s.key, s.request.modelId, s.request.op, s.after ?? null])).toEqual([
      ["stems", "oss-voice-separate", "separate-audio", null],
      ["translate:es", "oss-text-llm", "translate", "stems"],
      ["translate:de", "oss-text-llm", "translate", "stems"],
    ]);
    // No second, weaker ASR pass: the stems workflow already runs Qwen3-ASR 1.7B + the forced aligner.
    expect(getModel("oss-voice-separate")!.routes[0].endpoint).toBe("dub-prepare-separate-transcribe");
    expect(steps[0].request.params?.sourceLanguage).toBe("en");
    expect(steps[1].chain).toEqual([{ slot: "prompt" }]);
    expect(steps[1].request.params).toEqual({ targetLanguage: "Spanish", sourceLanguage: "English" });
    expect(steps[1].request.step).toMatchObject({ index: 1, of: 3 });
    expect(() => prepareSteps({ engine: "open", video, targets: ["th"] })).toThrow(/Thai isn't available on the open engine/);
  });

  it("cloud: isolated voice → Scribe → translations", () => {
    const steps = prepareSteps({ engine: "cloud", video, targets: ["fr"] });
    expect(steps.map((s) => [s.key, s.request.modelId, s.after ?? null])).toEqual([
      ["voice", "elevenlabs-voice-isolation", null],
      ["words", "scribe-v2", "voice"],
      ["translate:fr", "text-llm", "words"],
    ]);
    expect(steps[0].request.inputs).toEqual({ video });
    expect(steps[1].request.params).toBeUndefined(); // "auto" = detect
  });

  // Speech starts at 2 s, pauses at 7–12 s and ends at 26 s of a 30 s clip.
  const cues = [
    { start: 2, end: 4, text: "Hola a todos" },
    { start: 4.2, end: 7, text: "  bienvenidos  " },
    { start: 12, end: 15, text: "Esto es una prueba" },
    { start: 24, end: 26, text: "Adiós" },
  ];

  it("flags takes whose words won't fit before the next one starts", () => {
    const tight = [
      { start: 0, end: 1, text: "Una frase demasiado larga para un segundo, de verdad que sí" },
      { start: 1.6, end: 3, text: "Corta" },
      { start: 10, end: 12, text: "Bien" },
    ];
    expect(crowdedLines(tight, 14)).toEqual([0]);
    expect(crowdedLines(cues, 30)).toEqual([]);
  });

  it("phrases: lines a breath apart are one take, pauses split takes, lines past the end are dropped", () => {
    expect(dubPhrases(cues)).toEqual([
      { start: 2, end: 7, text: "Hola a todos bienvenidos" },
      { start: 12, end: 15, text: "Esto es una prueba" },
      { start: 24, end: 26, text: "Adiós" },
    ]);
    // A long run of speech still re-syncs every PHRASE_MAX seconds.
    const run = Array.from({ length: 10 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.9, text: `line ${i}` }));
    const takes = dubPhrases(run);
    expect(takes.length).toBe(2);
    expect(takes.every((p) => p.end - p.start <= PHRASE_MAX)).toBe(true);
    expect(dubPhrases([...cues, { start: 31, end: 32, text: "after the end" }, { start: 20, end: 21, text: "  " }], 30).map((p) => p.text)).toEqual(["Hola a todos bienvenidos", "Esto es una prueba", "Adiós"]);
  });

  it("open voice: each take in the cloned voice → placed at its cue on a track as long as the video → lips → over the background", () => {
    const steps = voiceSteps({ engine: "open", video, lang: "es", cues, voiceRef: "/v.wav", background: "/bg.wav", duration: 30 });
    expect(steps.map((s) => [s.key, s.request.modelId, s.request.op, s.after ?? null])).toEqual([
      ["line:0", "oss-chatterbox", "tts", null],
      ["line:1", "oss-chatterbox", "tts", null],
      ["line:2", "oss-chatterbox", "tts", null],
      ["track", "oss-audio-timeline", "timeline", ["line:0", "line:1", "line:2"]],
      ["lips", "oss-infinitetalk-v2v", "lipsync", "track"],
      ["film", "oss-mux", "mux", ["lips", "track"]],
    ]);
    expect(steps[0].request).toMatchObject({ prompt: "Hola a todos bienvenidos", inputs: { voiceAudio: "/v.wav" }, params: { targetLanguage: "Spanish (es)" } });
    const track = steps[3];
    expect(track.chain).toEqual([{ slot: "audios" }, { slot: "audios" }, { slot: "audios" }]);
    // The voice keeps the source's length and every take starts at its cue (each may play until the next one).
    expect(track.request.params).toEqual({
      duration: 30,
      extra: { timeline: { length: 30, clips: [{ start: 2, duration: 10 }, { start: 12, duration: 12 }, { start: 24, duration: 6 }] } },
    });
    // Lip re-sync gets no time span: InfiniteTalk runs as long as its voice, which is now the whole clip.
    expect(steps[4].request.params).toBeUndefined();
    expect(steps[5].chain).toEqual([{ slot: "video" }, { slot: "audio" }]);
    expect(steps[5].request.inputs).toEqual({ audio2: "/bg.wav" });
    // Without lip re-sync the new voice goes over the original picture.
    const flat = voiceSteps({ engine: "open", video, lang: "es", cues, voiceRef: "/v.wav", background: "/bg.wav", lipsync: false, duration: 30 });
    expect(flat.map((s) => s.key)).toEqual(["line:0", "line:1", "line:2", "track", "film"]);
    expect(flat.at(-1)!.request.inputs).toEqual({ video, audio2: "/bg.wav" });
    // Unknown length (a WebM the server can't read): a second past the last line.
    expect(voiceSteps({ engine: "open", video, lang: "es", cues, voiceRef: "/v.wav" })[3].request.params?.duration).toBe(27);
  });

  it("cloud voice: ElevenLabs takes → compose on the timeline → its soundtrack → their voice → Sync lipsync", () => {
    const steps = voiceSteps({ engine: "cloud", video, lang: "ja", cues, voiceRef: "/v.mp3", duration: 30 });
    expect(steps.map((s) => [s.key, s.request.modelId, s.request.op, s.after ?? null])).toEqual([
      ["line:0", "elevenlabs-v4", "tts", null],
      ["line:1", "elevenlabs-v4", "tts", null],
      ["line:2", "elevenlabs-v4", "tts", null],
      ["track", "compose-timeline", "timeline", ["line:0", "line:1", "line:2"]],
      ["soundtrack", "extract-soundtrack", "separate-audio", "track"],
      ["clone", "chatterbox-vc-cloud", "voice-change", "soundtrack"],
      ["film", "sync-lipsync-3", "lipsync", "clone"],
    ]);
    expect(steps[3].request.inputs).toEqual({ images: [BLANK_FRAME] });
    expect(steps[3].request.params?.extra?.timeline).toEqual({ length: 30, clips: [{ start: 2, duration: 10 }, { start: 12, duration: 12 }, { start: 24, duration: 6 }] });
    expect(steps[4].chain).toEqual([{ slot: "video" }]);
    expect(steps[5].request.inputs).toEqual({ voiceAudio: "/v.mp3" });
    expect(steps[6].request).toMatchObject({ inputs: { video }, params: { duration: 30 } });
    const flat = voiceSteps({ engine: "cloud", video, lang: "ja", cues, voiceRef: "/v.mp3", lipsync: false, duration: 30 });
    expect(flat.at(-1)!.request.modelId).toBe("merge-audio-video");
    expect(() => voiceSteps({ engine: "cloud", video, lang: "ja", cues: [{ start: 0, end: 1, text: " " }], voiceRef: "/v" })).toThrow(/no lines to speak/);
    expect(() => voiceSteps({ engine: "cloud", video, lang: "ja", cues: [{ start: 40, end: 41, text: "late" }], voiceRef: "/v", duration: 30 })).toThrow(/after the end of the video/);
  });

  it("the cloud track is a fal compose timeline over the blank still", () => {
    const steps = voiceSteps({ engine: "cloud", video, lang: "ja", cues, voiceRef: "/v.mp3", duration: 30 });
    const route = getModel("compose-timeline")!.routes[0];
    const payload = buildPayload(route.map!, { images: ["https://fal.media/still.png"], audios: ["https://a/0.mp3", "https://a/1.mp3", "https://a/2.mp3"], extra: steps[3].request.params?.extra });
    expect(payload).toEqual({
      tracks: [
        { id: "picture", type: "image", keyframes: [{ url: "https://fal.media/still.png", timestamp: 0, duration: 30000 }] },
        {
          id: "voice",
          type: "audio",
          keyframes: [
            { url: "https://a/0.mp3", timestamp: 2000, duration: 10000 },
            { url: "https://a/1.mp3", timestamp: 12000, duration: 12000 },
            { url: "https://a/2.mp3", timestamp: 24000, duration: 6000 },
          ],
        },
      ],
    });
    expect(() => buildPayload(route.map!, { images: ["x"], audios: ["a"], extra: {} })).toThrow(/start times/);
  });

  it("one shot: HeyGen display names, ElevenLabs codes", () => {
    expect(oneShotRequests({ model: "heygen-translate", video, targets: ["es", "he"] }).map((r) => r.request.params?.targetLanguage)).toEqual(["Spanish", "Hebrew (Israel)"]);
    const eleven = oneShotRequests({ model: "elevenlabs-dubbing", video, source: "en", targets: ["pt"] })[0].request;
    expect(eleven).toMatchObject({ modelId: "elevenlabs-dubbing", op: "dub", params: { targetLanguage: "pt", sourceLanguage: "en" } });
    expect(() => oneShotRequests({ model: "elevenlabs-dubbing", video, targets: ["he"] })).toThrow(/isn't available on this model/);
  });

  it("spoken text is the reviewed lines, trimmed", () => {
    expect(spokenText(cues)).toBe("Hola a todos\nbienvenidos\nEsto es una prueba\nAdiós");
  });
});

describe("cue edit reducer", () => {
  const base = normalizeCues([
    { start: 2, end: 4, text: "second line" },
    { start: 0, end: 2.5, text: "first line here" },
  ]);

  it("sorts and removes overlaps", () => {
    expect(base).toEqual([
      { start: 0, end: 2, text: "first line here" },
      { start: 2, end: 4, text: "second line" },
    ]);
  });

  it("edits text and keeps timings between the neighbours", () => {
    expect(cueReducer(base, { type: "text", index: 1, text: "changed" })[1].text).toBe("changed");
    expect(cueReducer(base, { type: "time", index: 1, start: 1 })[1]).toEqual({ start: 2, end: 4, text: "second line" });
    expect(cueReducer(base, { type: "time", index: 0, end: 9 })[0].end).toBe(2);
    expect(cueReducer(base, { type: "time", index: 1, end: 2.05 })[1]).toEqual({ start: 2, end: 2.2, text: "second line" });
  });

  it("splits at the nearest space and shares the time by length", () => {
    const out = cueReducer(base, { type: "split", index: 0, caret: 6 });
    expect(out.map((c) => c.text)).toEqual(["first", "line here", "second line"]);
    expect(out[0].start).toBe(0);
    expect(out[1].end).toBe(2);
    expect(out[0].end).toBeCloseTo(2 * (5 / 14), 2);
    // A single word can't be split.
    expect(cueReducer([{ start: 0, end: 1, text: "word" }], { type: "split", index: 0 })).toHaveLength(1);
  });

  it("merges with the next line, removes, inserts in a gap and shifts", () => {
    expect(cueReducer(base, { type: "merge", index: 0 })).toEqual([{ start: 0, end: 4, text: "first line here second line" }]);
    expect(cueReducer(base, { type: "remove", index: 0 })).toHaveLength(1);
    expect(cueReducer(base, { type: "insert", index: 1 })[2]).toEqual({ start: 4, end: 6, text: "" });
    // No room between two touching cues.
    expect(cueReducer(base, { type: "insert", index: 0 })).toHaveLength(2);
    expect(cueReducer(base, { type: "shift", seconds: -5 })[0].start).toBe(0);
    expect(cueReducer(base, { type: "shift", seconds: 1.5 })[1]).toEqual({ start: 3.5, end: 5.5, text: "second line" });
  });

  it("reports problems and reads times back", () => {
    expect(cueProblems([{ start: 0, end: 1, text: "" }], 10)).toEqual(["1 empty line"]);
    expect(cueProblems([{ start: 12, end: 13, text: "late" }], 10)).toEqual(["A line starts after the end of the video"]);
    expect(formatCueTime(62.5)).toBe("1:02.5");
    expect(parseCueTime("1:02.5")).toBe(62.5);
    expect(parseCueTime("abc")).toBeNull();
  });
});

describe("dub sessions (demo mode)", () => {
  async function prepared(engine: "open" | "cloud") {
    const s = dub.createDubSession({ engine, mode: "steps", video: clip(), title: "My clip", source: "en", targets: ["es"] });
    for (const id of Object.values(s.prepare!)) expect((await settle(id)).status).toBe("succeeded");
    return dub.dubView(dub.getDubSession(s.id)!);
  }

  it.each(["open", "cloud"] as const)("%s: prepare, review, edit and voice a language", async (engine) => {
    const view = await prepared(engine);
    expect(languageStage(view, "es")).toBe("review");
    const lines = reviewCues(view, "es")!;
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].text).toMatch(/^\[Spanish\]/);
    // Edits are saved per language and spoken as edited.
    const edited = cueReducer(lines, { type: "text", index: 0, text: "Hola, esto es una prueba" });
    const saved = dub.saveDubDraft(view.id, "es", edited);
    expect(reviewCues(saved, "es")![0].text).toBe("Hola, esto es una prueba");
    const voiced = dub.voiceDub(view.id, "es");
    const run = voiced.voices!.es[0];
    expect(Object.keys(run.ids)).toEqual(engine === "open" ? ["line:0", "track", "lips", "film"] : ["line:0", "track", "soundtrack", "clone", "film"]);
    expect(voiced.generations[run.ids["line:0"]].request.prompt).toContain("Hola, esto es una prueba");
    // The voice track is exactly as long as the source (read from its MP4 header when the session was made).
    expect(view.duration).toBeGreaterThan(1);
    expect(voiced.generations[run.ids.track].request.params?.duration).toBe(view.duration);
    expect((voiced.generations[run.ids.track].request.params?.extra?.timeline as { length: number }).length).toBe(view.duration);
    if (engine === "open") {
      // The background stem rides along to the mix.
      expect(voiced.generations[run.ids.film].request.inputs?.audio2).toMatch(/^\/api\/files\//);
      expect(voiced.generations[run.ids["line:0"]].request.inputs?.voiceAudio).toMatch(/^\/api\/files\//);
    }
    expect(languageStage(voiced, "es")).toBe("voicing");
    expect((await settle(run.ids.film)).status).toBe("succeeded");
    expect(languageStage(dub.dubView(dub.getDubSession(view.id)!), "es")).toBe("done");
    // All steps share the session's batch (one stack in the Library).
    expect(new Set(Object.values(dub.dubView(dub.getDubSession(view.id)!).generations).map((g) => g.batchId))).toEqual(new Set([view.batchId]));
  });

  it("refuses to voice before the translation is ready, and one-shot on the open engine", () => {
    const s = dub.createDubSession({ engine: "open", mode: "steps", video: clip(), targets: ["fr"] });
    expect(() => dub.voiceDub(s.id, "fr")).toThrow(/isn't ready yet/);
    expect(() => dub.createDubSession({ engine: "open", mode: "oneshot", video: clip(), targets: ["fr"] })).toThrow(/cloud service/);
  });

  it("one shot (cloud): one dub job per language", async () => {
    const s = dub.createDubSession({ engine: "cloud", mode: "oneshot", model: "heygen-translate", video: clip(), targets: ["es", "fr"] });
    expect(Object.keys(s.oneshot!)).toEqual(["es", "fr"]);
    const g = await settle(s.oneshot!.es);
    expect(g.request.params?.targetLanguage).toBe("Spanish");
    expect(languageStage(dub.dubView(dub.getDubSession(s.id)!) as DubSessionView, "es")).toBe("done");
    expect(dub.listDubSessions().map((x) => x.id)).toContain(s.id);
  });

  it("prices the voice before it runs: per-minute steps for the video's length, unpriced ones named", () => {
    setSetting("falKey", "test-key");
    try {
      const lines = [
        { start: 2, end: 4, text: "Hola a todos" },
        { start: 12, end: 15, text: "Esto es una prueba" },
      ];
      const steps = voiceSteps({ engine: "cloud", video: "/api/files/uploads/clip.mp4", lang: "es", cues: lines, voiceRef: "/api/files/uploads/voice.mp3", duration: 30 });
      const p = dub.priceSteps("cloud", steps, 30);
      expect(p.demo).toBe(false);
      expect(p.steps).toBe(6);
      // Sync Lipsync 3 at $8 a minute is $4 for 30 s, ElevenLabs $0.08 a take; compose, soundtrack and voice conversion add cents.
      expect(p.costUsd).toBeCloseTo(4 + 2 * 0.08 + 2 * 0.006 + 0.0075, 2);
      expect(p.unpriced).toEqual([]);
      expect(priceLine(p)).toBe("≈ $4.18");
      // Without lip re-sync it's the takes and cents.
      expect(dub.priceSteps("cloud", voiceSteps({ engine: "cloud", video: "/api/files/uploads/clip.mp4", lang: "es", cues: lines, voiceRef: "/v.mp3", duration: 30, lipsync: false }), 30).costUsd).toBeLessThan(0.2);
      // A model without a listed price is named next to the estimate.
      expect(priceLine({ engine: "cloud", costUsd: 0.5, unpriced: ["Claude"], demo: false, steps: 3 })).toBe("≈ $0.50 + Claude");
    } finally {
      setSetting("falKey", "");
    }
    expect(priceLine({ engine: "open", costUsd: 0, unpriced: [], demo: false, steps: 4 })).toBe("Free on your GPU");
    expect(priceLine({ engine: "cloud", costUsd: 0, unpriced: [], demo: true, steps: 4 })).toBe("Demo · free");
  });

  it("removing a dub stops the steps that haven't finished (nothing more is spent)", async () => {
    const s = dub.createDubSession({ engine: "cloud", mode: "steps", video: clip(), targets: ["es"] });
    const ids = Object.values(s.prepare!);
    expect(dub.deleteDubSession(s.id)).toBe(true);
    expect(dub.getDubSession(s.id)).toBeNull();
    for (const id of ids) expect(["canceled", "succeeded"]).toContain((await settle(id)).status);
    expect(ids.some((id) => gens.getGeneration(id)!.status === "canceled")).toBe(true);
  });
});
