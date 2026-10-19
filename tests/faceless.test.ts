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
  type EpisodeSettings,
  type GraphInput,
  type ScriptBlock,
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
      for (const id of [m.still, m.styleStill, m.editStill, m.video, ...m.videoChoices, m.narration, m.cloneNarration, m.longNarration, m.music, m.join, m.mux, m.mixMusic, m.captions, m.write, m.transcribe].filter(Boolean)) {
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
    expect(g.find((s) => s.key === "music")!.request).toMatchObject({ modelId: "oss-ace-step", op: "music", params: { duration: 60, extra: { lyrics: "[Instrumental]" } } });
    const mix = g.find((s) => s.key === "mix")!;
    expect(mix).toMatchObject({ after: ["join", "narration", "music"], chain: [{ slot: "video" }, { slot: "audio" }, { slot: "audio2" }] });
    expect(mix.request).toMatchObject({ modelId: "oss-mux", params: { extra: { backgroundVolumeDb: -14 } } });
    expect(g.find((s) => s.key === "words")!.request).toMatchObject({ modelId: "oss-qwen3-asr", op: "transcribe" });
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
    // A cloud episode with music mixes on the open mixer (the cloud tool takes one track).
    const music = graphFor({ engine: "cloud", music: true }, six);
    expect(music.find((s) => s.key === "mix")!.request.modelId).toBe("oss-mux");
    expect(music.find((s) => s.key === "music")!.request).toMatchObject({ modelId: "sonilo-music", params: { duration: 60 } });
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
    expect(voice.rerun).toEqual(["narration", "mix", "words", "captions"]);
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
    expect(e.total).toBeGreaterThan(6.9);
    expect(e.total).toBeLessThan(7.2);
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
