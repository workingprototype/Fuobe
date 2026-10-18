import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { cueReducer, cueProblems, formatCueTime, normalizeCues, parseCueTime } from "@/lib/av/cue-edit";
import { languageStage, oneShotRequests, prepareSteps, reviewCues, spokenText, voiceSteps, type DubSessionView } from "@/lib/av/dub";
import { DUB_LANGUAGES, supportsTarget } from "@/lib/av/languages";
import { getModel } from "@/lib/catalog";

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

  it("open: stems → transcript of the voice stem → one translation per language", () => {
    const steps = prepareSteps({ engine: "open", video, source: "en", targets: ["es", "de"] });
    expect(steps.map((s) => [s.key, s.request.modelId, s.request.op, s.after ?? null])).toEqual([
      ["stems", "oss-voice-separate", "separate-audio", null],
      ["words", "oss-qwen3-asr", "transcribe", "stems"],
      ["translate:es", "oss-text-llm", "translate", "words"],
      ["translate:de", "oss-text-llm", "translate", "words"],
    ]);
    expect(steps[1].chain).toEqual([{ slot: "audio", stem: "voice" }]);
    expect(steps[1].request.params?.sourceLanguage).toBe("en");
    expect(steps[2].chain).toEqual([{ slot: "prompt" }]);
    expect(steps[2].request.params).toEqual({ targetLanguage: "Spanish", sourceLanguage: "English" });
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

  const cues = [
    { start: 0, end: 2, text: "Hola a todos" },
    { start: 2.2, end: 4, text: "  bienvenidos  " },
  ];

  it("open voice: cloned speech → lip re-sync → mixed over the background", () => {
    const steps = voiceSteps({ engine: "open", video, lang: "es", cues, voiceRef: "/v.wav", background: "/bg.wav" });
    expect(steps.map((s) => [s.key, s.request.modelId, s.request.op, s.after ?? null])).toEqual([
      ["speech", "oss-chatterbox", "tts", null],
      ["lips", "oss-infinitetalk-v2v", "lipsync", "speech"],
      ["film", "oss-mux", "mux", ["lips", "speech"]],
    ]);
    expect(steps[0].request).toMatchObject({ prompt: "Hola a todos\nbienvenidos", inputs: { voiceAudio: "/v.wav" }, params: { targetLanguage: "Spanish (es)" } });
    expect(steps[2].chain).toEqual([{ slot: "video" }, { slot: "audio" }]);
    expect(steps[2].request.inputs).toEqual({ audio2: "/bg.wav" });
    // Without lip re-sync the new voice goes over the original picture.
    const flat = voiceSteps({ engine: "open", video, lang: "es", cues, voiceRef: "/v.wav", background: "/bg.wav", lipsync: false });
    expect(flat.map((s) => s.key)).toEqual(["speech", "film"]);
    expect(flat[1].request.inputs).toEqual({ video, audio2: "/bg.wav" });
  });

  it("cloud voice: ElevenLabs speech → converted to the speaker's voice → Sync lipsync", () => {
    const steps = voiceSteps({ engine: "cloud", video, lang: "ja", cues, voiceRef: "/v.mp3" });
    expect(steps.map((s) => [s.key, s.request.modelId, s.request.op])).toEqual([
      ["speech", "elevenlabs-v4", "tts"],
      ["clone", "chatterbox-vc-cloud", "voice-change"],
      ["film", "sync-lipsync-3", "lipsync"],
    ]);
    expect(steps[1].request.inputs).toEqual({ voiceAudio: "/v.mp3" });
    expect(voiceSteps({ engine: "cloud", video, lang: "ja", cues, voiceRef: "/v.mp3", lipsync: false })[2].request.modelId).toBe("merge-audio-video");
    expect(() => voiceSteps({ engine: "cloud", video, lang: "ja", cues: [{ start: 0, end: 1, text: " " }], voiceRef: "/v" })).toThrow(/no lines to speak/);
  });

  it("one shot: HeyGen display names, ElevenLabs codes", () => {
    expect(oneShotRequests({ model: "heygen-translate", video, targets: ["es", "he"] }).map((r) => r.request.params?.targetLanguage)).toEqual(["Spanish", "Hebrew (Israel)"]);
    const eleven = oneShotRequests({ model: "elevenlabs-dubbing", video, source: "en", targets: ["pt"] })[0].request;
    expect(eleven).toMatchObject({ modelId: "elevenlabs-dubbing", op: "dub", params: { targetLanguage: "pt", sourceLanguage: "en" } });
    expect(() => oneShotRequests({ model: "elevenlabs-dubbing", video, targets: ["he"] })).toThrow(/isn't available on this model/);
  });

  it("spoken text is the reviewed lines, trimmed", () => {
    expect(spokenText(cues)).toBe("Hola a todos\nbienvenidos");
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
    expect(Object.keys(run.ids)).toEqual(engine === "open" ? ["speech", "lips", "film"] : ["speech", "clone", "film"]);
    expect(voiced.generations[run.ids.speech].request.prompt).toContain("Hola, esto es una prueba");
    if (engine === "open") {
      // The background stem rides along to the mix.
      expect(voiced.generations[run.ids.film].request.inputs?.audio2).toMatch(/^\/api\/files\//);
      expect(voiced.generations[run.ids.speech].request.inputs?.voiceAudio).toMatch(/^\/api\/files\//);
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
});
