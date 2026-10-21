import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import {
  blockCount,
  blockShots,
  buildEpisodeGraph,
  changedKeys,
  channelName,
  defaultSettings,
  descendants,
  ENGINE_MODELS,
  estimateGraph,
  EXPLAINER_STYLE_IDS,
  explainerSeconds,
  FACELESS_LENGTHS,
  FACELESS_STYLE_IDS,
  finalKey,
  foldJoins,
  GENRES,
  genreInfo,
  getStyle,
  narrationText,
  normalizeBlocks,
  offlineScript,
  offlineTopics,
  parseScript,
  parseTopics,
  parseVisuals,
  placeholderBlocks,
  planBlocks,
  planRerun,
  planRetry,
  secondsFor,
  shotsFor,
  splitScript,
  STYLES,
  stepCostUsd,
  subjectOf,
  totalSeconds,
  wordCount,
  youtubeKind,
  ANIMATION_MODES,
  filmSeconds,
  musicLength,
  plannedTiming,
  sceneSpans,
  sceneTiming,
  spokenTimes,
  styleRefLimit,
  withTiming,
  type EpisodeSettings,
  type GraphInput,
  type ScriptBlock,
  type TimedText,
} from "@/lib/catalog/faceless";

const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/higgsfield-marketing-agents.json"), "utf8"));

const block = (i: number, words = 20, seconds?: number): ScriptBlock => {
  const narration = Array.from({ length: words }, (_, w) => `w${i}x${w}`).join(" ");
  return { id: `b${i}`, narration, visual: `Scene ${i}`, motion: "slow push-in", seconds: seconds ?? secondsFor(narration) };
};

const graphFor = (s: Partial<EpisodeSettings>, blocks: ScriptBlock[], extra: Partial<GraphInput> = {}) => {
  const settings = { ...defaultSettings(s.engine ?? "cloud", genreInfo("education")), ...s };
  return buildEpisodeGraph({ feature: "faceless", title: "How tides work", genre: genreInfo("education"), settings, blocks, fallbackVoice: "/api/files/uploads/demo-voice.wav", ...extra }, getModel);
};

describe("research data", () => {
  it("has the 12 Faceless styles and the 22 Explainer styles in Higgsfield's order", () => {
    const names = (ids: string[]) => ids.map((id) => getStyle(id).name);
    expect(names(FACELESS_STYLE_IDS)).toEqual(research.faceless.styles.map((s: { name: string }) => s.name));
    expect(names(EXPLAINER_STYLE_IDS)).toEqual(research.explainer.styles);
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(STYLES.length);
    for (const s of STYLES) expect(s.look.length).toBeGreaterThan(40);
  });

  it("has the 4 genres with their one-liners, and the offered lengths", () => {
    expect(GENRES.map((g) => [g.label, g.hint])).toEqual(research.faceless.genres.map((g: { label: string; hint: string }) => [g.label, g.hint]));
    expect(FACELESS_LENGTHS).toEqual(research.faceless.settings.length.seconds);
    for (const g of GENRES) expect(FACELESS_STYLE_IDS).toContain(g.style);
  });

  it("only uses models and voices the catalog has", () => {
    for (const engine of ["cloud", "open"] as const) {
      const m = ENGINE_MODELS[engine];
      for (const id of [m.still, m.styleStill, m.editStill, m.video, ...m.videoChoices, m.narration, m.cloneNarration, m.longNarration, m.music, m.join, m.mux, m.mixMusic, m.levelMusic, m.captions, m.align, m.sourceStill, m.upscale, m.write].filter(Boolean)) {
        expect(getModel(id!), id).toBeTruthy();
      }
    }
    const voices = getModel("elevenlabs-v4")!.options.voices!.map((v) => v.id);
    for (const g of GENRES) expect(voices).toContain(g.voice);
    expect(voices).toContain("XrExE9yKIg1WjnnlVkGX");
  });
});

describe("blocks", () => {
  it("splits a length into 10-second blocks", () => {
    expect(planBlocks(60)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(planBlocks(25)).toEqual([9, 8, 8]);
    expect(planBlocks(15)).toEqual([8, 7]);
    expect(planBlocks(600)).toHaveLength(60);
    expect(blockCount(300)).toBe(30);
    expect(blockCount(5)).toBe(1);
  });

  it("times a block from its lines and splits lines that don't fit", () => {
    expect(secondsFor("one two three four five")).toBe(3);
    expect(secondsFor(block(1, 20).narration)).toBe(9);
    expect(secondsFor(block(1, 40).narration)).toBe(10);
    const long = normalizeBlocks([{ narration: "First sentence is here and it goes on for a while. " + "More words ".repeat(20) + "end.", visual: "A lighthouse", motion: "" }]);
    expect(long.length).toBeGreaterThan(1);
    expect(long[0].visual).toBe("A lighthouse");
    expect(long.every((b) => b.seconds <= 10 && wordCount(b.narration) <= 24)).toBe(true);
  });

  it("splits a pasted script into blocks that each fit 10 seconds, keeping every word", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} has exactly seven words.`).join(" ");
    const blocks = splitScript(text);
    expect(blocks.length).toBeGreaterThanOrEqual(9);
    expect(blocks.every((b) => wordCount(b.narration) <= 23)).toBe(true);
    expect(blocks.map((b) => b.narration).join(" ")).toBe(text);
    expect(totalSeconds(blocks)).toBe(blocks.reduce((n, b) => n + b.seconds, 0));
  });

  it("covers a block with the fewest shots the video model can make", () => {
    expect(shotsFor(10, undefined, [3, 10])).toEqual([10]);
    expect(shotsFor(7, undefined, [3, 10])).toEqual([7]);
    expect(shotsFor(10, [3, 5])).toEqual([5, 5]);
    expect(shotsFor(8, [3, 5])).toEqual([5, 3]);
    expect(shotsFor(4, [3, 5])).toEqual([5]);
    expect(shotsFor(7, [4, 5, 6, 8, 10, 12, 30])).toEqual([8]);
    expect(blockShots(10, getModel("oss-wan22-14b-fast"))).toEqual([5, 5]);
    expect(blockShots(10, getModel("gemini-omni-flash"))).toEqual([10]);
  });
});

describe("render graph", () => {
  const six = Array.from({ length: 6 }, (_, i) => block(i));

  it("cloud, fully animated: still → Gemini Omni Flash clip per block → join → voice-over → subtitles", () => {
    const g = graphFor({ engine: "cloud", animation: "animated", music: false }, six);
    const parts = g.map((s) => s.part);
    expect(parts.filter((p) => p === "still")).toHaveLength(6);
    expect(parts.filter((p) => p === "clip")).toHaveLength(6);
    const clip = g.find((s) => s.part === "clip")!;
    expect(clip.request).toMatchObject({ modelId: "gemini-omni-flash", op: "i2v", params: { resolution: "720p", duration: 9, aspectRatio: "16:9" } });
    expect(clip.after).toEqual(["still-b0"]);
    expect(clip.chain).toEqual([{ slot: "images", position: "first" }]);
    const join = g.find((s) => s.key === "join")!;
    expect(join.request.modelId).toBe("join-clips");
    expect(join.after).toHaveLength(6);
    const mix = g.find((s) => s.key === "mix")!;
    expect(mix.request.modelId).toBe("merge-audio-video");
    expect(mix.after).toEqual(["join", "narration"]);
    expect(mix.label).toBe("Mixing");
    // ElevenLabs forced alignment reads the known script with the recording.
    expect(g.find((s) => s.key === "words")!.request).toMatchObject({ modelId: "elevenlabs-align", op: "transcribe", prompt: narrationText(six) });
    const narration = g.find((s) => s.key === "narration")!;
    expect(narration.request).toMatchObject({ modelId: "elevenlabs-v4", op: "tts", params: { voice: "Xb7hH8MSUJpSbSDYk0k2" } });
    expect(narration.request.prompt).toBe(narrationText(six));
    expect(g.find((s) => s.key === "captions")!.request).toMatchObject({ modelId: "auto-subtitle", title: "How tides work" });
    expect(g.find((s) => s.key === "captions")!.after).toEqual(["mix"]);
    expect(finalKey(g)).toBe("captions");
    expect(g.every((s) => s.request.feature === "faceless" && s.request.batchTitle === "How tides work")).toBe(true);
  });

  it("cloud, frame by frame: a slow camera over each still at a cheaper quality", () => {
    const g = graphFor({ engine: "cloud", animation: "frames", music: false }, six);
    const clip = g.find((s) => s.part === "clip")!;
    expect(clip.request.params?.resolution).toBe("360p");
    expect(clip.request.prompt).toMatch(/slow push-in.*doesn't change/i);
    const animated = estimateGraph(graphFor({ engine: "cloud", animation: "animated", music: false }, six), getModel);
    const frames = estimateGraph(g, getModel);
    expect(frames.parts.clip).toBeLessThan(animated.parts.clip!);
    expect(frames.total).toBeLessThan(animated.total);
  });

  it("open: Wan 2.2 Lightning in 5-second shots, joins folded 4 at a time, Chatterbox, music under the voice, Qwen3-ASR timed burn-in", () => {
    const g = graphFor({ engine: "open", animation: "animated", music: true, voice: null }, six);
    const clips = g.filter((s) => s.part === "clip");
    expect(clips).toHaveLength(12);
    expect(clips[0].request).toMatchObject({ modelId: "oss-wan22-14b-fast", params: { duration: 5, resolution: "480p" } });
    expect(clips[1].request.prompt).toMatch(/keeps moving/);
    const joins = g.filter((s) => s.part === "join");
    // 12 clips → 3 joins of 4 → the final join of 3.
    expect(joins.map((j) => j.after!.length)).toEqual([4, 4, 4, 3]);
    expect(joins.every((j) => j.request.modelId === "oss-join-clips")).toBe(true);
    const narration = g.find((s) => s.key === "narration")!;
    expect(narration.request).toMatchObject({ modelId: "oss-chatterbox", inputs: { voiceAudio: "/api/files/uploads/demo-voice.wav" } });
    // The bed is as long as the film (60 s of 5-second shots) plus a second.
    expect(g.find((s) => s.key === "music")!.request).toMatchObject({ modelId: "oss-ace-step", op: "music", params: { duration: 61, extra: { lyrics: "[Instrumental]" } } });
    const mix = g.find((s) => s.key === "mix")!;
    expect(mix).toMatchObject({ after: ["join", "narration", "music"], chain: [{ slot: "video" }, { slot: "audio" }, { slot: "audio2" }] });
    expect(mix.request).toMatchObject({ modelId: "oss-mux", params: { extra: { backgroundVolumeDb: -14 } } });
    // Qwen3-ASR times the narration (the scenes are cut to it) and its lines are burned in.
    const words = g.find((s) => s.key === "words")!;
    expect(words).toMatchObject({ after: ["narration"], chain: [{ slot: "audio" }], request: { modelId: "oss-qwen3-asr", op: "transcribe" } });
    expect(words.request.prompt).toBeUndefined();
    expect(g.find((s) => s.key === "captions")).toMatchObject({ after: ["mix", "words"], chain: [{ slot: "video" }, { slot: "prompt" }], request: { modelId: "oss-captions-burnin" } });
    expect(estimateGraph(g, getModel).total).toBe(0);
  });

  it("follows the voice, style references and the music choice", () => {
    const sample = graphFor({ engine: "cloud", voice: { kind: "sample", url: "/api/files/uploads/me.wav" } }, six);
    expect(sample.find((s) => s.key === "narration")!.request).toMatchObject({ modelId: "chatterbox-cloud", inputs: { voiceAudio: "/api/files/uploads/me.wav" } });
    const refs = graphFor({ engine: "cloud", styleRefs: ["/api/files/a.png", "/api/files/b.png"] }, six);
    const still = refs.find((s) => s.part === "still")!;
    expect(still.request.inputs?.images).toEqual(["/api/files/a.png", "/api/files/b.png"]);
    expect(still.request.prompt).toMatch(/style of the reference images/);
    const openRefs = graphFor({ engine: "open", styleRefs: ["/api/files/a.png", "/api/files/b.png", "/api/files/c.png"] }, six);
    expect(openRefs.find((s) => s.part === "still")!.request).toMatchObject({ modelId: "oss-style-qwen-edit", inputs: { images: ["/api/files/a.png", "/api/files/b.png"] } });
    // A cloud episode with music: the Sonilo bed (as long as the film) is levelled to -28 LUFS, then fal's
    // compose lays the voice and the bed on the film in one pass — no ComfyUI needed.
    const music = graphFor({ engine: "cloud", music: true }, six);
    expect(music.find((s) => s.key === "music")!.request).toMatchObject({ modelId: "sonilo-music", params: { duration: 55 } });
    expect(music.find((s) => s.key === "level")).toMatchObject({
      part: "music",
      after: ["music"],
      chain: [{ slot: "audio" }],
      request: { modelId: "ffmpeg-loudnorm", op: "level", params: { extra: { integrated_loudness: -28 } } },
    });
    const composed = music.find((s) => s.key === "mix")!;
    expect(composed).toMatchObject({ label: "Mixing voice and music", after: ["join", "narration", "level"], chain: [{ slot: "video" }, { slot: "audio" }, { slot: "audio2" }] });
    expect(composed.request).toMatchObject({ modelId: "ffmpeg-compose", op: "mux", params: { duration: 54 } });
    expect(music.every((s) => getModel(s.request.modelId)!.engine === "cloud")).toBe(true);
    // No subtitles: the mix is the final step and carries the title.
    const plain = graphFor({ engine: "cloud", subtitles: false, music: false }, six);
    expect(finalKey(plain)).toBe("mix");
    expect(plain.find((s) => s.key === "mix")!.request.title).toBe("How tides work");
    // A long script goes to the narration model without the 5,000-character limit.
    const long = graphFor({ engine: "cloud" }, Array.from({ length: 40 }, (_, i) => block(i, 24)));
    expect(narrationText(Array.from({ length: 40 }, (_, i) => block(i, 24))).length).toBeGreaterThan(5000);
    expect(long.find((s) => s.key === "narration")!.request.modelId).toBe("elevenlabs-multilingual-v2");
  });

  it("builds a picture edit for a block the timeline editor changes", () => {
    const g = graphFor({ engine: "open" }, six, { stillEdits: { b2: { source: "/api/files/outputs/still.png", instruction: "make it night" } } });
    expect(g.find((s) => s.key === "still-b2")!.request).toMatchObject({ modelId: "oss-qwen-edit", op: "edit", inputs: { images: ["/api/files/outputs/still.png"] } });
    expect(g.find((s) => s.key === "still-b2")!.request.prompt).toMatch(/^make it night\. Keep everything else/);
  });

  it("folds long films so a change re-runs only its branch", () => {
    expect(foldJoins(["a"], 4)).toEqual([]);
    expect(foldJoins(["a", "b"], 4)).toEqual([[{ key: "join", after: ["a", "b"] }]]);
    const levels = foldJoins(Array.from({ length: 30 }, (_, i) => `c${i}`), 24);
    expect(levels.map((l) => l.map((j) => j.after.length))).toEqual([[24, 6], [2]]);
    expect(levels[1][0]).toEqual({ key: "join", after: ["join-1-1", "join-1-2"] });
    const open = foldJoins(Array.from({ length: 60 }, (_, i) => `c${i}`), 4);
    expect(open.map((l) => l.length)).toEqual([15, 4, 1]);
    expect(open[2][0].key).toBe("join");
  });
});

describe("timeline re-runs and retries", () => {
  const blocks = Array.from({ length: 12 }, (_, i) => block(i));
  const g = graphFor({ engine: "open", music: true }, blocks);

  it("a picture change re-runs that block's still and clips, the joins up its branch, the mix and the subtitles", () => {
    const plan = planRerun(g, changedKeys(g, ["b3"], "picture"));
    expect(plan.rerun.filter((k) => k.startsWith("still-"))).toEqual(["still-b3"]);
    expect(plan.rerun.filter((k) => k.startsWith("clip-"))).toEqual(["clip-b3-1", "clip-b3-2"]);
    // 24 clips → 6 joins of 4 → 2 joins → final: b3's clips are in the first join of each level.
    expect(plan.rerun.filter((k) => k.startsWith("join"))).toEqual(["join-1-2", "join-2-1", "join"]);
    expect(plan.rerun).toEqual(expect.arrayContaining(["mix", "captions"]));
    expect(plan.rerun).not.toContain("narration");
    expect(plan.rerun).not.toContain("words");
    expect(plan.reuse).toContain("still-b4");
    expect(plan.rerun.length + plan.reuse.length).toBe(g.length);
  });

  it("a motion change keeps the still; a narration change re-voices, re-times the captions and re-mixes", () => {
    const motion = planRerun(g, changedKeys(g, ["b0"], "motion"));
    expect(motion.rerun).not.toContain("still-b0");
    expect(motion.rerun).toContain("clip-b0-1");
    const voice = planRerun(g, changedKeys(g, ["b0"], "narration"));
    expect(voice.rerun).toEqual(["narration", "words", "mix", "captions"]);
  });

  it("a retry redoes failed steps and what waits on them, and keeps what finished", () => {
    const status: Record<string, string> = Object.fromEntries(g.map((s) => [s.key, "succeeded"]));
    status["clip-b5-2"] = "failed";
    for (const k of descendants(g, ["clip-b5-2"])) status[k] = "failed";
    const plan = planRetry(g, status);
    expect(plan.rerun[0]).toBe("clip-b5-2");
    expect(plan.rerun).not.toContain("still-b5");
    expect(plan.rerun).not.toContain("narration");
    expect(planRetry(g, Object.fromEntries(g.map((s) => [s.key, "succeeded"]))).rerun).toEqual([]);
  });
});

describe("cost", () => {
  it("prices narration per thousand characters and video per second at its resolution", () => {
    const tts = getModel("elevenlabs-v4")!;
    expect(stepCostUsd(tts, { feature: "x", modelId: tts.id, prompt: "a".repeat(2500) })).toBe(0.24);
    const gemini = getModel("gemini-omni-flash")!;
    expect(stepCostUsd(gemini, { feature: "x", modelId: gemini.id, params: { duration: 10, resolution: "720p" } })).toBe(1);
    expect(stepCostUsd(gemini, { feature: "x", modelId: gemini.id, params: { duration: 10, resolution: "360p" } })).toBe(0.3);
    expect(stepCostUsd(getModel("auto-subtitle"), { feature: "x", modelId: "auto-subtitle" }, 120)).toBe(0.06);
    expect(stepCostUsd(getModel("oss-wan22-14b-fast"), { feature: "x", modelId: "oss-wan22-14b-fast" })).toBe(0);
  });

  it("estimates a one-minute cloud episode by parts", () => {
    const g = graphFor({ engine: "cloud", animation: "animated", music: false }, placeholderBlocks(60));
    const e = estimateGraph(g, getModel);
    expect(e.parts.still).toBeCloseTo(0.9, 5);
    expect(e.parts.clip).toBeCloseTo(6, 5);
    // Forced alignment: $0.22 per started hour of audio.
    expect(e.parts.words).toBeCloseTo(0.22, 5);
    expect(e.total).toBeGreaterThan(7.1);
    expect(e.total).toBeLessThan(7.4);
    expect(e.unknown).toBe(false);
    // Only what a change re-runs.
    const one = estimateGraph(g, getModel, ["still-p0", "clip-p0-1"]);
    expect(one.total).toBeCloseTo(1.15, 5);
  });
});

describe("writing", () => {
  it("reads the LLM's script, topics and visuals, with or without code fences", () => {
    const script = parseScript('Here you go:\n```json\n{"title":"Tides","scenes":[{"narration":"The moon pulls the sea.","visual":"The moon over the ocean","motion":"waves rise"}]}\n```');
    expect(script?.title).toBe("Tides");
    expect(script?.blocks[0]).toMatchObject({ narration: "The moon pulls the sea.", visual: "The moon over the ocean", motion: "waves rise" });
    // Prose instead of JSON becomes a pasted script.
    const prose = parseScript("The moon pulls the sea towards it. Twice a day, the water rises and falls along every coast.");
    expect(prose?.blocks.length).toBe(1);
    expect(parseScript("{}")).toBeNull();
    expect(parseTopics('{"topics":[{"title":"Why the sea is salty","hook":"It came from rocks."},{"title":""}]}')).toEqual([{ title: "Why the sea is salty", hook: "It came from rocks." }]);
    expect(parseVisuals('{"scenes":[{"n":1,"visual":"A","motion":"m"},{"n":2,"visual":"B"}]}', 2)).toEqual([
      { visual: "A", motion: "m" },
      { visual: "B", motion: "" },
    ]);
    expect(parseVisuals('{"scenes":[{"n":1,"visual":"A"}]}', 2)).toBeNull();
  });

  it("writes offline: channel names, topics and a script of the asked length", () => {
    expect(subjectOf("Channel about survival in the wild")).toBe("survival in the wild");
    expect(channelName("Channel about the rise and fall of empires")).toBe("The Rise and Fall of Empires");
    const topics = offlineTopics("Channel about ancient civilizations", "history", 5);
    expect(topics).toHaveLength(5);
    expect(topics[0].title).toMatch(/ancient civilizations/);
    expect(new Set(offlineTopics("x", "kids", 5, 5).map((t) => t.title)).size).toBe(5);
    // A template that would repeat the channel's own words is skipped.
    const empires = offlineTopics("Channel about the rise and fall of empires", "history", 5);
    expect(empires).toHaveLength(5);
    expect(empires.some((t) => /rise and fall of the rise and fall/i.test(t.title))).toBe(false);
    expect(subjectOf("The untold beginning of Rome")).toBe("the untold beginning of Rome");
    expect(subjectOf("Explain how dinosaurs went extinct, for kids")).toBe("how dinosaurs went extinct, for kids");
    const script = offlineScript("how volcanoes erupt", "education", 6);
    expect(script).toHaveLength(6);
    expect(script.every((b) => b.seconds <= 10 && b.narration && b.visual)).toBe(true);
  });

  it("checks reference links and explainer durations", () => {
    expect(youtubeKind("https://www.youtube.com/@kurzgesagt")).toBe("channel");
    expect(youtubeKind("https://youtu.be/dQw4w9WgXcQ")).toBe("video");
    expect(youtubeKind("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("video");
    expect(youtubeKind("https://youtube.com/playlist?list=PL123")).toBe("playlist");
    expect(youtubeKind("https://vimeo.com/123")).toBeNull();
    expect(youtubeKind("not a link")).toBeNull();
    expect(explainerSeconds("auto")).toBeNull();
    expect(explainerSeconds(45)).toBe(45);
    expect(() => explainerSeconds(14)).toThrow(/between 15 and 600/);
    expect(() => explainerSeconds(30.5)).toThrow(/whole number/);
  });
});

/** Word timings as a forced aligner gives them: every word at `pace` seconds a word, a pause between blocks. */
function aligned(blocks: ScriptBlock[], pace: number, pause = 0.4, lead = 0.15): TimedText[] {
  const cues: TimedText[] = [];
  let t = lead;
  for (const b of blocks) {
    for (const w of b.narration.split(/\s+/).filter(Boolean)) {
      cues.push({ start: t, end: t + pace * 0.9, text: w });
      t += pace;
    }
    t += pause;
  }
  return cues;
}

describe("timing: every scene cut to its spoken lines", () => {
  const six = Array.from({ length: 6 }, (_, i) => block(i));
  const gemini = getModel("gemini-omni-flash");
  const wan = getModel("oss-wan22-14b-fast");

  it("finds where each block's lines start, from forced-alignment words or ASR phrases", () => {
    const words = aligned(six, 0.5);
    const t = spokenTimes(six, words)!;
    expect(t.starts[0]).toBeCloseTo(0.15);
    // 20 words × 0.5 s, then a 0.4 s pause, per block.
    expect(t.starts[1]).toBeCloseTo(0.15 + 10.4);
    expect(t.starts[5]).toBeCloseTo(0.15 + 5 * 10.4);
    expect(t.end).toBeCloseTo(words[words.length - 1].end);
    // Phrase cues (five words each, as ASR and caption grouping give them): the same starts, interpolated.
    const phrases: TimedText[] = [];
    for (let i = 0; i < words.length; i += 5) phrases.push({ start: words[i].start, end: words[i + 4].end, text: words.slice(i, i + 5).map((w) => w.text).join(" ") });
    const p = spokenTimes(six, phrases)!;
    six.forEach((_, i) => expect(Math.abs(p.starts[i]! - t.starts[i]!)).toBeLessThan(0.5));
    // An ASR that mishears some words and hears one that isn't there still lines up.
    const heard = words.map((w, i) => (i % 9 === 4 ? { ...w, text: "mmm," } : w));
    heard.splice(30, 0, { start: heard[30].start, end: heard[30].start + 0.1, text: "uh" });
    const asr = spokenTimes(six, heard)!;
    six.forEach((_, i) => expect(Math.abs(asr.starts[i]! - t.starts[i]!)).toBeLessThan(0.6));
  });

  it("refuses timings that aren't this narration (a demo transcript, nothing)", () => {
    const demo = [
      { start: 0, end: 2.3, text: "This is a demo transcript." },
      { start: 2.5, end: 4.8, text: "Connect a speech-to-text provider in Settings," },
      { start: 5, end: 7.3, text: "or start ComfyUI, to transcribe your clip for real." },
    ];
    expect(spokenTimes(six, demo)).toBeNull();
    expect(spokenTimes(six, [])).toBeNull();
  });

  it("cuts each scene to its lines, the next scene absorbing a shot's rounding (Gemini: any whole second)", () => {
    // A slow narrator: about 11 s a block where 9 s were planned.
    const t = spokenTimes(six, aligned(six, 0.53))!;
    const timing = sceneTiming(six, t, gemini);
    const secs = six.map((b) => timing[b.id]);
    expect(secs.every((s) => Number.isInteger(s) && s >= 3)).toBe(true);
    let film = 0;
    six.forEach((b, i) => {
      // Each scene starts in the film within a rounding of where its lines start.
      if (i > 0) expect(Math.abs(film - t.starts[i]!)).toBeLessThan(0.75);
      film += timing[b.id];
    });
    expect(film).toBeGreaterThanOrEqual(t.end);
    expect(film).toBeLessThan(t.end + 2);
    // The graph makes exactly those lengths (a scene over 10 s takes two shots), and the timeline shows them.
    const g = graphFor({ engine: "cloud", music: false }, withTiming(six, timing));
    expect(sceneSpans(g, 6).map((s) => s.seconds)).toEqual(secs);
    expect(g.filter((s) => s.part === "clip").length).toBeGreaterThan(6);
    expect(g.find((s) => s.key === "mix")!.seconds).toBe(film);
  });

  it("doesn't drift with Wan's 3- and 5-second shots either", () => {
    const t = spokenTimes(six, aligned(six, 0.42))!;
    const timing = sceneTiming(six, t, wan);
    let film = 0;
    six.forEach((b, i) => {
      if (i > 0) expect(Math.abs(film - t.starts[i]!)).toBeLessThan(2.5);
      film += timing[b.id];
    });
    expect(Math.abs(film - t.end)).toBeLessThan(3.5);
    // Planned lengths as film: a 9-second block is 5 + 5 on Wan.
    expect(plannedTiming(six, wan)).toEqual(Object.fromEntries(six.map((b) => [b.id, 10])));
  });

  it("gives a block the same shots planned or timed (the graph derives them from its length)", () => {
    for (const m of [gemini, wan, getModel("seedance-2-5")]) {
      for (let s = 3; s <= 25; s++) expect(blockShots(filmSeconds(s, m), m)).toEqual(blockShots(s, m));
    }
  });

  it("keeps the scenes that moved a second or less when a narration change is re-timed", () => {
    const before = sceneTiming(six, spokenTimes(six, aligned(six, 0.5))!, gemini);
    // Scene 3's lines get twice as long; the new take reads the rest at nearly the same pace.
    const changed = six.map((b, i) => (i === 2 ? { ...b, narration: `${b.narration} ${b.narration}` } : b));
    const after = sceneTiming(changed, spokenTimes(changed, aligned(changed, 0.505))!, gemini, before);
    expect(after.b0).toBe(before.b0);
    expect(after.b1).toBe(before.b1);
    expect(after.b2).toBeGreaterThan(before.b2 + 5);
    expect(six.filter((b) => after[b.id] !== before[b.id]).length).toBeLessThanOrEqual(3);
  });

  it("lets a scene without lines keep its own length, out of the scene before it", () => {
    const blocks = [block(0), { ...block(1, 0), seconds: 4 }, block(2)];
    const t = spokenTimes(blocks, aligned(blocks, 0.5))!;
    expect(t.starts[1]).toBeNull();
    const timing = sceneTiming(blocks, t, gemini);
    expect(timing.b1).toBe(4);
    expect(Math.abs(timing.b0 + timing.b1 - t.starts[2]!)).toBeLessThan(1);
  });
});

describe("pictures from sources, style references, music length, frame pricing", () => {
  const six = Array.from({ length: 6 }, (_, i) => block(i));
  const [a, b, c, x] = ["/api/files/uploads/a.png", "/api/files/uploads/b.png", "/api/files/uploads/c.png", "/api/files/uploads/x.png"];

  it("draws open pictures from attached images with a multi-image edit model", () => {
    const g = graphFor({ engine: "open", voice: null, sourceImages: [a, b] }, six);
    const still = g.find((s) => s.part === "still")!;
    expect(still.request).toMatchObject({ modelId: "oss-qwen-edit", op: "edit", inputs: { images: [a, b] } });
    expect(still.request.prompt).toMatch(/attached source pictures/);
    expect(still.request.prompt).toMatch(/Style: /);
    // Style references win over the sources; the open style model reads two of them.
    const refs = graphFor({ engine: "open", voice: null, styleRefs: [a, b, c], sourceImages: [x] }, six);
    expect(refs.find((s) => s.part === "still")!.request).toMatchObject({ modelId: "oss-style-qwen-edit", inputs: { images: [a, b] } });
    expect(styleRefLimit("open", getModel)).toBe(2);
    expect(styleRefLimit("cloud", getModel)).toBe(3);
    // The cloud picture model reads the references and the sources.
    const cloud = graphFor({ engine: "cloud", styleRefs: [a], sourceImages: [x] }, six);
    expect(cloud.find((s) => s.part === "still")!.request).toMatchObject({ modelId: "nano-banana-pro", inputs: { images: [a, x] } });
  });

  it("makes the music bed as long as the film, up to what the model makes", () => {
    expect(musicLength(getModel("sonilo-music"), 300)).toBe(301);
    expect(musicLength(getModel("sonilo-music"), 700)).toBe(600);
    expect(musicLength(getModel("oss-ace-step"), 300)).toBe(240);
    expect(musicLength(getModel("elevenlabs-music"), 50)).toBe(60);
  });

  it("makes Frame by frame cheaper with Seedance 2.5 too, and says what it saves on each engine", () => {
    const priced = (animation: "animated" | "frames") => estimateGraph(graphFor({ engine: "cloud", music: false, videoModel: "seedance-2-5", animation }, placeholderBlocks(300)), getModel);
    expect(priced("frames").parts.clip).toBeLessThan(priced("animated").parts.clip! * 0.6);
    const frames = ANIMATION_MODES.find((m) => m.id === "frames")!;
    expect(frames.copy).toMatch(/lighter on credits/);
    expect(frames.openCopy).not.toMatch(/credits/);
  });
});

describe("offline topic suggestions", () => {
  it("brings new topics every round until the templates run out", () => {
    for (const g of GENRES) {
      const first = offlineTopics("Channel about volcanoes", g.id, 5);
      const second = offlineTopics("Channel about volcanoes", g.id, 5, 1, first.map((t) => t.title));
      expect(second).toHaveLength(5);
      expect(second.filter((t) => first.some((f) => f.title === t.title))).toEqual([]);
      const third = offlineTopics("Channel about volcanoes", g.id, 5, 2, [...first, ...second].map((t) => t.title));
      expect(third).toHaveLength(5);
      expect(third.filter((t) => ![...first, ...second].some((f) => f.title === t.title)).length).toBeGreaterThanOrEqual(2);
      // Without the list of shown titles, rounds page through the templates.
      const paged = offlineTopics("Channel about volcanoes", g.id, 5, 1);
      expect(paged.filter((t) => first.some((f) => f.title === t.title))).toEqual([]);
    }
  });
});
