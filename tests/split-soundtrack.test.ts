import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLOUD_ONLY_PROBLEM,
  CLOUD_SPLIT_PROBLEM,
  clampDb,
  dbLabel,
  dbsChannelsFor,
  dbsModelFor,
  dbToGain,
  DBS_SPEED,
  durationWords,
  encodeWav,
  headroomGain,
  hostPick,
  mixName,
  ORIGINAL_MIX,
  planRemux,
  planSplit,
  presetOf,
  PRESETS,
  setLevel,
  setMute,
  setSolo,
  splitTime,
  STEMS,
  stemGains,
  type Mix,
} from "@/lib/av/split";
import { getModel } from "@/lib/catalog";
import { HUB_MODES, modeHref } from "@/lib/hubs";

// Audio → Split soundtrack (DBS D1): the planner, the mixer maths and the API in demo mode.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-split-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: the open model runs on the demo provider.
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const gens = await import("@/server/generations");
const route = await import("@/app/api/audio-tools/route");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A 16-bit WAV of a tone with `channels` channels, saved as an upload. */
function upload(seconds: number, channels = 2, name = "film.wav"): string {
  const rate = 8000;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2 * channels);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2 * channels, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2 * channels, 28);
  buf.writeUInt16LE(2 * channels, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2 * channels, 40);
  return saveFile({ data: buf, contentType: "audio/wav", name, source: "upload" }).url;
}

const post = (body: unknown, preview = false) =>
  route.POST(new Request(`http://x/api/audio-tools${preview ? "?preview=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

async function finished(id: string) {
  const deadline = Date.now() + 15_000;
  let g = gens.getGeneration(id)!;
  while (g.status !== "succeeded" && g.status !== "failed" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    g = gens.getGeneration(id)!;
  }
  return g;
}

describe("the DBS model and channels a run gets", () => {
  it("picks DBS-TIGER on a CUDA host and DBS-BSRNN otherwise, unless one is asked for", () => {
    expect(hostPick("cuda")).toBe("best");
    expect(hostPick("cpu")).toBe("fast");
    expect(hostPick("mps")).toBe("fast");
    expect(hostPick(undefined)).toBe("fast");
    expect(dbsModelFor(undefined, "cuda")).toBe("DBS-TIGER-DnR");
    expect(dbsModelFor(undefined, "cpu")).toBe("DBS-BSRNN-DnR");
    expect(dbsModelFor("fast", "cuda")).toBe("DBS-BSRNN-DnR");
    expect(dbsModelFor("best", "cpu")).toBe("DBS-TIGER-DnR");
    expect(dbsModelFor("DBS-TIGER-DnR", "cpu")).toBe("DBS-TIGER-DnR");
    expect(dbsModelFor("something else", "cpu")).toBe("DBS-BSRNN-DnR");
  });

  it("separates the mono mix unless stereo stems are asked for, and every channel of anything over two", () => {
    expect(dbsChannelsFor(undefined, 2)).toBe("mono");
    expect(dbsChannelsFor("mono", 1)).toBe("mono");
    expect(dbsChannelsFor("each channel", 2)).toBe("each channel");
    expect(dbsChannelsFor("stereo")).toBe("each channel");
    // 5.1: the background (original minus mono speech) would take speech out of the LFE and surrounds too.
    expect(dbsChannelsFor("mono", 6)).toBe("each channel");
    expect(dbsChannelsFor(undefined, 3)).toBe("each channel");
  });
});

describe("planSplit", () => {
  it("is one DBS job on the open engine, the host's model unless one is picked", () => {
    const p = planSplit({ engine: "open", media: "/api/files/u/film.wav", kind: "audio", name: "Film", channels: 2, seconds: 20 });
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0].key).toBe("split");
    expect(p.steps[0].request).toEqual({
      modelId: "oss-dbs-separate",
      op: "separate-audio",
      feature: "audio-split",
      batchTitle: "Split · Film",
      title: "Split · Film",
      inputs: { audio: "/api/files/u/film.wav" },
      params: { extra: { channels: "mono", sourceChannels: 2 }, sourceDuration: 20 },
      step: { label: "Dialogue, music, effects", index: 0, of: 1 },
    });
    expect(p).toMatchObject({ length: 20, quality: null, mode: "mono" });
    expect(p.summary).toBe("Splits it into dialogue, music, effects and music & effects.");
    expect(p.notes).toEqual(["Dialogue comes out clean; music and effects can bleed into each other."]);
    // The model the page picked goes as the DBSLoader name.
    expect(planSplit({ engine: "open", media: "/api/files/a.wav", kind: "audio", quality: "best" }).steps[0].request.params?.extra).toEqual({ channels: "mono", separationModel: "DBS-TIGER-DnR" });
    expect(planSplit({ engine: "open", media: "/api/files/a.wav", kind: "audio", quality: "fast" }).steps[0].request.params?.extra?.separationModel).toBe("DBS-BSRNN-DnR");
  });

  it("takes a video's soundtrack (LoadAudio reads it) and does stereo stems on request", () => {
    const p = planSplit({ engine: "open", media: "/api/files/u/clip.mp4", kind: "video", stereo: true });
    expect(p.steps[0].request.inputs).toEqual({ video: "/api/files/u/clip.mp4" });
    expect(p.steps[0].request.title).toBe("Split · video soundtrack");
    expect(p.steps[0].request.params?.extra).toEqual({ channels: "each channel" });
    expect(p.steps[0].request.step?.label).toBe("Dialogue, music, effects · every channel");
    expect(p.mode).toBe("each channel");
    expect(p.summary).toBe("Splits the video's soundtrack into dialogue, music, effects and music & effects, every channel on its own (2 passes).");
    expect(p.length).toBeNull();
  });

  it("splits every channel of a 5.1 file on its own, and says why it takes longer", () => {
    const p = planSplit({ engine: "open", media: "/api/files/a.wav", kind: "audio", channels: 6 });
    expect(p.mode).toBe("each channel");
    expect(p.steps[0].request.params?.extra).toEqual({ channels: "each channel", sourceChannels: 6 });
    expect(p.notes[0]).toBe("This file has 6 channels, so each is split on its own: about 6x the time.");
  });

  it("has no cloud route: DBS isn't hosted, and no other model stands in for it", () => {
    expect(() => planSplit({ engine: "cloud", media: "/api/files/a.wav", kind: "audio" })).toThrow(CLOUD_SPLIT_PROBLEM);
    expect(CLOUD_SPLIT_PROBLEM).toMatch(/runs on your GPU \(open source\)/);
    expect(() => planSplit({ engine: "open", media: "", kind: "video" })).toThrow("Add the video to split");
  });

  it("puts a mix back on its video: the stream-copy mux on the open engine, fal's merge on the cloud", () => {
    const open = planRemux({ engine: "open", video: "/api/files/v.mp4", audio: "/api/files/mix.wav", name: "Trailer" });
    expect(open.steps[0].request).toMatchObject({ modelId: "oss-mux", op: "mux", feature: "audio-split-remux", inputs: { video: "/api/files/v.mp4", audio: "/api/files/mix.wav" }, title: "Remix · Trailer" });
    expect(open.notes).toEqual(["The picture is copied as it is, not re-encoded."]);
    const cloud = planRemux({ engine: "cloud", video: "/api/files/v.mp4", audio: "/api/files/mix.wav" });
    expect(cloud.steps[0].request).toMatchObject({ modelId: "merge-audio-video", op: "mux", title: "Remix · video" });
    // Both models exist and do the mux.
    for (const id of ["oss-mux", "merge-audio-video", "oss-dbs-separate"]) expect(getModel(id)).toBeTruthy();
    expect(getModel("oss-dbs-separate")!.routes[0]).toMatchObject({ op: "separate-audio", provider: "comfyui", endpoint: "separate-soundtrack-dbs" });
  });
});

describe("time on the open engine", () => {
  it("uses the measured CPU speeds (0.27x / 0.09x per pass) and the reference GPU's", () => {
    expect(DBS_SPEED.cpu).toEqual({ fast: 0.27, best: 0.09 });
    // 60 s on a CPU with DBS-BSRNN: about 222 s of work, 3 s to load and save.
    expect(splitTime({ seconds: 60, quality: "fast", mode: "mono", device: "cpu" })).toEqual({ low: 181, high: 359 });
    // Stereo stems: one pass per channel.
    const stereo = splitTime({ seconds: 60, quality: "fast", mode: "each channel", channels: 2, device: "cpu" });
    expect(stereo.high).toBe(Math.round(3 + ((60 * 2) / 0.27) * 1.6));
    expect(splitTime({ seconds: 60, quality: "best", mode: "mono" }).low).toBe(Math.round(3 + (60 / 0.09) * 0.8));
    // A 5.1 file: six passes.
    expect(splitTime({ seconds: 10, quality: "fast", mode: "each channel", channels: 6, device: "cpu" }).low).toBe(Math.round(3 + (60 / 0.27) * 0.8));
    // CUDA: well over real time, a range up to 4x slower than the reference card.
    expect(splitTime({ seconds: 600, quality: "best", mode: "mono", device: "cuda" })).toEqual({ low: 41, high: 154 });
  });

  it("says it in words", () => {
    expect(durationWords({ low: 20, high: 50 })).toBe("under a minute");
    expect(durationWords({ low: 181, high: 359 })).toBe("about 3–6 min");
    expect(durationWords({ low: 120, high: 130 })).toBe("about 2 min");
    expect(durationWords({ low: 7200, high: 10800 })).toBe("about 2–3 h");
  });
});

describe("the mixer", () => {
  it("turns levels into gains: −24…+6 dB in half-dB steps", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
    expect(dbToGain(-12)).toBeCloseTo(0.251, 3);
    expect(dbToGain(-Infinity)).toBe(0);
    expect(clampDb(-40)).toBe(-24);
    expect(clampDb(9)).toBe(6);
    expect(clampDb(-3.3)).toBe(-3.5);
    expect([dbLabel(0), dbLabel(3), dbLabel(-12), dbLabel(-0.2)]).toEqual(["0 dB", "+3 dB", "−12 dB", "0 dB"]);
  });

  it("starts as the original: dialogue plus music & effects, the separate stems muted so nothing plays twice", () => {
    expect(stemGains(ORIGINAL_MIX)).toEqual({ voice: 1, music: 0, effects: 0, background: 1 });
    expect(presetOf(ORIGINAL_MIX)).toBe("original");
    expect(STEMS.map((s) => [s.id, s.label])).toEqual([
      ["voice", "Dialogue"],
      ["music", "Music"],
      ["effects", "Effects"],
      ["background", "Music & effects"],
    ]);
  });

  it("has the presets: no dialogue, dialogue only, music only, music under dialogue at −12 dB", () => {
    const gains = Object.fromEntries(PRESETS.map((p) => [p.id, stemGains(p.mix)]));
    expect(gains["no-dialogue"]).toEqual({ voice: 0, music: 0, effects: 0, background: 1 });
    expect(gains["dialogue-only"]).toEqual({ voice: 1, music: 0, effects: 0, background: 0 });
    expect(gains["music-only"]).toEqual({ voice: 0, music: 1, effects: 0, background: 0 });
    expect(gains["music-under"].voice).toBe(1);
    expect(gains["music-under"].background).toBeCloseTo(0.251, 3);
    expect(PRESETS.map((p) => p.label)).toEqual(["Original", "No dialogue", "Dialogue only", "Music only", "Music under dialogue (−12 dB)"]);
    for (const p of PRESETS) expect(presetOf(p.mix)).toBe(p.id);
  });

  it("never plays music or effects twice: the bed and its two stems take turns", () => {
    let m: Mix = setMute(ORIGINAL_MIX, "music", false);
    expect(stemGains(m)).toEqual({ voice: 1, music: 1, effects: 0, background: 0 });
    m = setMute(m, "effects", false);
    expect(stemGains(m)).toEqual({ voice: 1, music: 1, effects: 1, background: 0 });
    m = setMute(m, "background", false);
    expect(stemGains(m)).toEqual({ voice: 1, music: 0, effects: 0, background: 1 });
    // Moving a muted stem's level unmutes it (and the same rule applies).
    m = setLevel(m, "music", -6);
    expect(m.music).toEqual({ db: -6, mute: false, solo: false });
    expect(m.background.mute).toBe(true);
    expect(presetOf(m)).toBeNull();
    expect(setLevel(ORIGINAL_MIX, "voice", 40).voice.db).toBe(6);
  });

  it("solo plays only the soloed stems; a muted one stays silent", () => {
    let m = setSolo(ORIGINAL_MIX, "voice", true);
    expect(stemGains(m)).toEqual({ voice: 1, music: 0, effects: 0, background: 0 });
    m = setSolo(m, "background", true);
    expect(stemGains(m)).toEqual({ voice: 1, music: 0, effects: 0, background: 1 });
    m = setMute(m, "voice", true);
    expect(stemGains(m).voice).toBe(0);
  });

  it("names a mix for the Library", () => {
    expect(mixName(ORIGINAL_MIX)).toBe("Dialogue + Music & effects");
    expect(mixName(PRESETS.find((p) => p.id === "music-under")!.mix)).toBe("Music under dialogue (−12 dB)");
    expect(mixName(setLevel(PRESETS.find((p) => p.id === "dialogue-only")!.mix, "voice", 3))).toBe("Dialogue +3 dB");
    expect(mixName({ ...ORIGINAL_MIX, voice: { db: 0, mute: true, solo: false }, background: { db: 0, mute: true, solo: false } })).toBe("Silence");
  });

  it("exports a 16-bit WAV kept under full scale", () => {
    expect(headroomGain(0.5)).toBe(1);
    expect(headroomGain(2) * 2).toBeCloseTo(dbToGain(-0.1), 6);
    const wav = encodeWav([Float32Array.from([0, 0.5, -1, 2]), Float32Array.from([1, -0.5, 0, 0])], 44100);
    const d = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect([d.getUint16(22, true), d.getUint32(24, true), d.getUint16(34, true), d.getUint32(40, true)]).toEqual([2, 44100, 16, 4 * 2 * 2]);
    // Interleaved L/R, clipped at full scale.
    expect(Array.from({ length: 8 }, (_, i) => d.getInt16(44 + i * 2, true))).toEqual([0, 32767, 16384, -16384, -32768, 0, 32767, 0]);
  });
});

describe("Split soundtrack in the Audio hub", () => {
  it("is a mode after Transcribe with its own path", () => {
    const ids = HUB_MODES.audio.map((m) => m.id);
    expect(ids.indexOf("split")).toBe(ids.indexOf("transcribe") + 1);
    expect(HUB_MODES.audio.find((m) => m.id === "split")?.label).toBe("Split soundtrack");
    expect(modeHref("audio", "split")).toBe("/audio/split");
  });
});

describe("POST /api/audio-tools split and remux (demo mode)", () => {
  it("prices a split as free with a time estimate, and runs it into four Library stems", async () => {
    const media = upload(6, 2);
    const preview = await (await post({ tool: "split", engine: "open", media, kind: "audio", name: "Film" }, true)).json();
    expect(preview).toMatchObject({ steps: 1, costUsd: 0, demo: true, length: 6, hostPick: "fast" });
    expect(preview.summary).toBe("Splits it into dialogue, music, effects and music & effects.");
    // The header's length beats the browser's; the estimate is the CPU's (no device in demo mode).
    expect(preview.estimate).toEqual(splitTime({ seconds: 6, quality: "fast", mode: "mono", channels: 2 }));
    const best = await (await post({ tool: "split", engine: "open", media, kind: "audio", quality: "best", stereo: true, sourceDuration: 99 }, true)).json();
    expect(best.estimate).toEqual(splitTime({ seconds: 6, quality: "best", mode: "each channel", channels: 2 }));

    const res = await post({ tool: "split", engine: "open", media, kind: "audio", name: "Film" });
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run.result).toMatchObject({ feature: "audio-split", modelId: "oss-dbs-separate", provider: "mock", op: "separate-audio" });
    const g = await finished(run.result.id);
    expect(g.status).toBe("succeeded");
    expect(g.outputs.map((o) => [o.kind, o.meta?.stem])).toEqual([
      ["audio", "voice"],
      ["audio", "music"],
      ["audio", "effects"],
      ["audio", "background"],
    ]);
    expect(g.outputs.every((o) => o.url.startsWith("/api/files/"))).toBe(true);
  });

  it("reads a 5.1 file's channels from its header and splits each one", async () => {
    const media = upload(4, 6, "surround.wav");
    const preview = await (await post({ tool: "split", engine: "open", media, kind: "audio" }, true)).json();
    expect(preview.notes[0]).toBe("This file has 6 channels, so each is split on its own: about 6x the time.");
    const run = await (await post({ tool: "split", engine: "open", media, kind: "audio" })).json();
    expect(run.result.request.params.extra).toEqual({ channels: "each channel", sourceChannels: 6 });
  });

  it("says plainly that the cloud has no split, and refuses on an install set to paid APIs only", async () => {
    const media = upload(3, 2, "a.wav");
    const cloud = await post({ tool: "split", engine: "cloud", media, kind: "audio" }, true);
    expect(cloud.status).toBe(422);
    expect((await cloud.json()).error).toBe(CLOUD_SPLIT_PROBLEM);
    setSetting("engineMode", "cloud");
    try {
      expect((await (await post({ tool: "split", engine: "cloud", media, kind: "audio" }, true)).json()).error).toBe(CLOUD_ONLY_PROBLEM);
      expect((await (await post({ tool: "split", engine: "open", media, kind: "audio" })).json()).error).toBe(CLOUD_ONLY_PROBLEM);
    } finally {
      setSetting("engineMode", "both");
    }
    expect((await (await post({ tool: "split", engine: "open", media: "/etc/passwd", kind: "audio" })).json()).error).toBe("Add the audio or video to split");
    expect((await (await post({ tool: "split", engine: "open", media: "/api/files/uploads/gone.wav", kind: "audio" }, true)).json()).error).toBe("That audio file is gone — add it again");
  });

  it("puts a mix back on the video: free on the open engine, priced on the cloud", async () => {
    const audio = upload(3, 2, "mix.wav");
    const video = saveFile({ data: Buffer.from("not really a video"), contentType: "video/mp4", name: "clip.mp4", source: "upload" }).url;
    const open = await (await post({ tool: "remux", engine: "open", video, audio, name: "Clip" }, true)).json();
    expect(open).toMatchObject({ steps: 1, costUsd: 0, summary: "Puts your mix on the video in place of its sound." });
    const cloud = await (await post({ tool: "remux", engine: "cloud", video, audio }, true)).json();
    expect(cloud.steps).toBe(1);
    const run = await (await post({ tool: "remux", engine: "open", video, audio, name: "Clip" })).json();
    expect(run.result).toMatchObject({ feature: "audio-split-remux", modelId: "oss-mux", op: "mux" });
    expect(run.result.request.inputs).toEqual({ video, audio });
    expect((await (await post({ tool: "remux", engine: "open", video, audio: "/api/files/uploads/gone.wav" }, true)).json()).error).toBe("That mix is gone — export it again");
    expect((await (await post({ tool: "remux", engine: "open", video })).json()).error).toBe("Export the mix first");
  });
});
