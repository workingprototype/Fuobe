import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import {
  ANIMATION_STYLES,
  animationFrom,
  animationStyle,
  briefCostUsd,
  briefLook,
  CF_LENGTH_VALUES,
  claudeMessage,
  defaultBrief,
  episodeTopic,
  MAX_CLAUDE_MESSAGE,
  mcpCommand,
  noMediaMessage,
  offlineBrief,
  offlineSeries,
  pageMedia,
  parseBrief,
  parseSeries,
  PRESETS,
  referenceLink,
  sceneSecondsFor,
  scenesFor,
  secondsFrom,
  seriesPrice,
  seriesSettings,
  speechRate,
  styleFor,
  voiceForTone,
} from "@/lib/catalog/content-factory";
import { buildEpisodeGraph, genreInfo, getStyle, placeholderBlocks, scriptBrief, STYLES, type ScriptBlock } from "@/lib/catalog/faceless";

// What reference-brief-gemma4's instruction asks Gemma 4 for (workflows/comfyui/manifest.json), as a model writes it.
const GEMMA = `Here is the brief:
\`\`\`json
{
  "format": "'what if' explainer",
  "hook": "A shocking image and the question 'What if…?' in the first second",
  "pacing": 2.5,
  "shots": [
    {"seconds": 2, "visual": "a city skyline", "camera": "aerial pull-back", "on_screen_text": "WHAT IF"},
    {"seconds": 3, "visual": "a car", "camera": "low angle tracking shot", "on_screen_text": ""},
    {"seconds": 2, "visual": "people", "camera": "aerial pull-back", "on_screen_text": ""}
  ],
  "visual_style": {"medium": "glossy 3D render", "palette": "saturated teal and orange", "lighting": "golden hour", "texture": "smooth plastic"},
  "animation_style": "Seamless motion video",
  "narration": {"voice": "male", "tone": "excited, curious", "words per minute": 180, "language": "English"},
  "music": {"genre": "electronic", "energy": "high"},
  "captions": {"style": "big bold word-by-word karaoke", "position": "center"},
  "topic_ideas": ["What if the Sun went out", "What if we could breathe underwater", "What if the Earth stopped spinning", "What if trees could walk", "What if it rained upwards"]
}
\`\`\``;

describe("parseBrief: the LLM's answer, tolerantly", () => {
  it("reads the Gemma 4 graph's keys in fences", () => {
    const r = parseBrief(GEMMA)!;
    expect(r).not.toBeNull();
    const b = r.brief;
    expect(b.format).toMatch(/what if/i);
    expect(b.shotSeconds).toBe(2.5);
    expect(b.shots).toEqual(["aerial pull-back", "low angle tracking shot"]);
    expect(b.look).toMatch(/glossy 3D render.*golden hour/);
    expect(b.styleId).toBe("colorful-3d");
    expect(b.animation).toBe("seamless");
    expect(b.voice).toEqual({ tone: "excited, curious, male", wordsPerMinute: 180, language: "English" });
    expect(b.music.energy).toBe("high");
    expect(b.captions).toMatchObject({ position: "center", words: 1 });
    expect(b.topics).toHaveLength(5);
    expect(r.missing).toEqual([]);
  });

  it("takes camelCase keys, words for numbers and plain strings", () => {
    const r = parseBrief(
      JSON.stringify({
        Format: "Top-5 countdown",
        hookStructure: "Number one first, then count down",
        pace: "fast cuts, 2-3 seconds per shot",
        shotTypes: "close-up; wide shot, POV",
        look: "Watercolour paintings, muted palette",
        animationStyle: "Frame by frame",
        voice: "Calm documentary narrator",
        music: "lo-fi ambient piano",
        subtitles: "white sentences at the top",
        topics: [{ title: "Top 5 lost cities" }, "Top 5 strange laws"],
      }),
    )!;
    expect(r.brief.pacing).toBe("fast cuts, 2-3 seconds per shot");
    expect(r.brief.shotSeconds).toBe(2.5);
    expect(r.brief.shots).toEqual(["close-up", "wide shot", "POV"]);
    expect(r.brief.styleId).toBe("watercolor-chronicle");
    expect(r.brief.animation).toBe("frame-by-frame");
    expect(r.brief.voice.tone).toBe("Calm documentary narrator");
    expect(r.brief.music).toEqual({ mood: "lo-fi ambient piano", energy: "low" });
    expect(r.brief.captions).toMatchObject({ position: "top", words: 6 });
    expect(r.brief.topics).toEqual(["Top 5 lost cities", "Top 5 strange laws"]);
  });

  it("fills what's missing from the base and says which fields", () => {
    const base = { ...defaultBrief(), aspect: "16:9" as const };
    const r = parseBrief('{"hook": "Start with the answer", "pacing": {"average_shot_seconds": "4", "description": "steady"}}', base)!;
    expect(r.brief.hook).toBe("Start with the answer");
    expect(r.brief.shotSeconds).toBe(4);
    expect(r.brief.pacing).toBe("steady");
    expect(r.brief.aspect).toBe("16:9");
    expect(r.brief.look).toBe(base.look);
    expect(r.missing).toEqual(expect.arrayContaining(["format", "shots", "look", "animation", "voice", "music", "captions", "topics"]));
  });

  it("clamps silly numbers and keeps a known style id", () => {
    const r = parseBrief('{"format": "x", "pacing": 0.1, "style_id": "pixel-art", "captions": "none"}')!;
    expect(r.brief.shotSeconds).toBe(1);
    expect(r.brief.styleId).toBe("pixel-art");
    expect(r.brief.captions.style).toMatch(/No on-screen captions/);
    expect(parseBrief('{"format": "x", "pacing": 60}')!.brief.shotSeconds).toBe(12);
  });

  it("is null for prose, demo text, arrays of nothing and near-empty objects", () => {
    expect(parseBrief("Demo script for: a reference\n\nHOOK — Open on the most striking image")).toBeNull();
    expect(parseBrief("")).toBeNull();
    expect(parseBrief("[]")).toBeNull();
    expect(parseBrief('{"unrelated": 1}')).toBeNull();
  });

  it("reads a brief nested under a key, and the first item of an array", () => {
    expect(parseBrief('{"brief": {"format": "Myth", "hook": "A god"}}')!.brief.format).toBe("Myth");
    expect(parseBrief('[{"format": "Fable", "hook": "Once"}]')!.brief.format).toBe("Fable");
  });

  it("secondsFrom and animationFrom understand the usual wordings", () => {
    expect(secondsFrom("about 4 seconds")).toBe(4);
    expect(secondsFrom("1.5–2.5 s")).toBe(2);
    expect(secondsFrom("rapid")).toBe(1.5);
    expect(secondsFrom("slow and lingering")).toBe(6);
    expect(secondsFrom("no idea")).toBeNull();
    expect(animationFrom("Scene by scene video")).toBe("scene-by-scene");
    expect(animationFrom("Ken Burns over stills")).toBe("frame-by-frame");
    expect(animationFrom("fully animated cartoon")).toBe("fully-animated");
    expect(animationFrom("")).toBeNull();
  });

  it("maps a look to the nearest Faceless style, and every preset to a real one", () => {
    expect(styleFor("stick figure doodles")).toBe("stickman-cartoon");
    expect(styleFor("3D papercraft origami")).toBe("3d-papercraft");
    expect(styleFor("photorealistic cinematic")).toBe("studio-3d");
    expect(styleFor("anime 2D")).toBe("2d-illustrator");
    expect(styleFor("nothing in particular", "hand-drawn")).toBe("hand-drawn");
    const ids = new Set(STYLES.map((s) => s.id));
    for (const p of PRESETS) {
      expect(ids.has(p.brief.styleId), p.id).toBe(true);
      expect(ANIMATION_STYLES.some((a) => a.id === p.brief.animation)).toBe(true);
      expect(p.examples.length).toBeGreaterThan(0);
    }
  });
});

describe("offline brief", () => {
  it("takes the clip's shape and the narrator's pace", () => {
    const cues = Array.from({ length: 8 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, text: "one two three four five six seven" }));
    expect(speechRate(cues)).toBe(210);
    const b = offlineBrief({ seconds: 30, width: 1920, height: 1080, cues });
    expect(b.aspect).toBe("16:9");
    expect(b.voice).toMatchObject({ wordsPerMinute: 210, tone: expect.stringMatching(/fast/i) });
    expect(offlineBrief({ seconds: 200 }).shotSeconds).toBe(5);
    expect(offlineBrief().aspect).toBe("9:16");
    expect(speechRate([{ start: 0, end: 1, text: "hi" }])).toBeNull();
  });
});

describe("the reference link guard", () => {
  it("takes one TikTok, Instagram or YouTube video, a video file or a page", () => {
    expect(referenceLink("https://www.tiktok.com/@someone/video/7312345678901234567")).toMatchObject({ platform: "tiktok" });
    expect(referenceLink("https://vm.tiktok.com/ZMabc123/")).toMatchObject({ platform: "tiktok" });
    expect(referenceLink("instagram.com/reel/C1a2b3c4d5/")).toEqual({ url: "https://instagram.com/reel/C1a2b3c4d5/", platform: "instagram" });
    expect(referenceLink("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ platform: "youtube" });
    expect(referenceLink("https://cdn.example.com/clips/ref.MP4?x=1")).toMatchObject({ platform: "direct" });
    expect(referenceLink("https://example.com/post/1")).toMatchObject({ platform: "web" });
  });

  it("refuses profiles, other schemes, credentials and local hosts before anything is fetched", () => {
    const err = (s: string) => (referenceLink(s) as { error?: string }).error;
    expect(err("https://www.tiktok.com/@someone")).toMatch(/one TikTok video/);
    expect(err("https://www.instagram.com/someone/")).toMatch(/one Instagram reel/);
    expect(err("ftp://example.com/a.mp4")).toMatch(/web link/);
    expect(err("file:///etc/passwd")).toMatch(/web link/);
    expect(err("https://user:pw@example.com/a.mp4")).toMatch(/user name or password/);
    expect(err("http://localhost:3000/api/files/x.mp4")).toMatch(/public link/);
    expect(err("http://nas.local/a.mp4")).toMatch(/public link/);
    expect(err("http://intranet/a.mp4")).toMatch(/public link/);
    expect(err("not a link")).toMatch(/doesn't look like a link/);
    expect(err("")).toMatch(/Paste a link/);
    expect(err(`https://example.com/${"a".repeat(2100)}`)).toMatch(/too long/);
  });

  it("says to upload when a platform keeps its video", () => {
    expect(noMediaMessage("tiktok")).toMatch(/TikTok doesn't hand.*upload it here/);
    expect(noMediaMessage("web")).toMatch(/Upload the clip/);
  });

  it("finds a page's own video, title and picture", () => {
    const html = `<html><head><title>Ignored</title>
      <meta property="og:title" content="A &amp; B">
      <meta content="https://cdn.example.com/v/clip.mp4?sig=1&amp;t=2" property="og:video:secure_url">
      <meta property="og:image" content="/thumb.jpg"></head></html>`;
    expect(pageMedia(html, "https://example.com/p/1")).toEqual({ video: "https://cdn.example.com/v/clip.mp4?sig=1&t=2", title: "A & B", image: "https://example.com/thumb.jpg" });
    expect(pageMedia('<video controls src="media/a.webm"></video>', "https://example.com/x/").video).toBe("https://example.com/x/media/a.webm");
    // A player page isn't the file.
    expect(pageMedia('<meta property="og:video" content="https://www.youtube.com/embed/abc">', "https://youtube.com").video).toBeNull();
    expect(pageMedia('<meta property="og:video" content="javascript:alert(1)">', "https://example.com").video).toBeNull();
    expect(pageMedia("<p>nothing</p>", "https://example.com")).toEqual({ video: null, title: null, image: null });
  });
});

describe("series planning", () => {
  it("reads the planner's answer tolerantly", () => {
    const r = parseSeries('Sure! {"name": "Sky Roads", "episodes": [{"title": "Day one", "synopsis": "Cars lift off."}, {"name": "Traffic in the clouds", "summary": "Jams at 3,000 m."}, "The crash"]}')!;
    expect(r.name).toBe("Sky Roads");
    expect(r.episodes).toEqual([
      { title: "Day one", synopsis: "Cars lift off." },
      { title: "Traffic in the clouds", synopsis: "Jams at 3,000 m." },
      { title: "The crash", synopsis: "" },
    ]);
    expect(parseSeries('[{"title": "Only"}]')!.episodes).toHaveLength(1);
    expect(parseSeries("no json")).toBeNull();
    expect(parseSeries('{"episodes": []}')).toBeNull();
  });

  it("plans offline: one video is the prompt, a series continues after earlier episodes", () => {
    expect(offlineSeries("What if cars could fly", "storytelling", 1)).toEqual([{ title: "What if cars could fly", synopsis: "" }]);
    const three = offlineSeries("What if cars could fly", "storytelling", 3);
    expect(three.map((e) => e.title)).toEqual(["What if cars could fly: The beginning", "What if cars could fly: The first change", "What if cars could fly: The turning point"]);
    expect(offlineSeries("What if cars could fly", "storytelling", 1, 3)[0].title).toMatch(/Into the unknown/);
    expect(new Set(offlineSeries("Volcanoes", "education", 10).map((e) => e.title)).size).toBe(10);
  });

  it("tells each episode's writer where it sits in the series", () => {
    expect(episodeTopic("What if cats ruled the world", { title: "x", synopsis: "" }, { number: 1, earlier: [], series: false })).toBe("What if cats ruled the world");
    const t = episodeTopic("What if cats ruled the world", { title: "The first decree", synopsis: "Naps become law." }, { number: 2, earlier: ["Day one"], series: true });
    expect(t).toBe("Episode 2 of the series “What if cats ruled the world”: The first decree. Naps become law. Earlier episodes: Day one.");
    expect(episodeTopic("A", { title: "B", synopsis: "" }, { number: 1, earlier: [], series: true })).toMatch(/first episode/);
  });

  it("settings: the style's render mode, the brief's look and pace, a narrator for its tone", () => {
    const voices = getModel("elevenlabs-v4")!.options.voices!;
    const brief = parseBrief(GEMMA)!.brief;
    const genre = genreInfo("storytelling");
    const s = seriesSettings({ engine: "cloud", length: 30, animation: "scene-by-scene", aspect: "9:16", brief, genre, voices });
    expect(s).toMatchObject({ engine: "cloud", length: 30, animation: "frames", aspect: "9:16", styleId: "colorful-3d", subtitles: true, music: true });
    expect(s.voice).toEqual({ kind: "preset", id: voiceForTone("excited, curious, male", voices, genre.voice) });
    expect(s.brief!.sceneSeconds).toBe(sceneSecondsFor(animationStyle("scene-by-scene"), 2.5));
    expect(s.brief!.captions).toEqual({ position: "center", words: 1 });
    expect(s.brief!.script.join("\n")).toMatch(/Hook \(first 3 seconds\)[\s\S]*hard cut[\s\S]*never copy/);
    // Open: no premade voices, and a length outside the list falls back to 30 s.
    const open = seriesSettings({ engine: "open", length: 45, animation: "fully-animated", aspect: "16:9", brief, genre });
    expect(open).toMatchObject({ engine: "open", voice: null, length: 30, animation: "animated" });
    // A voice the user picked wins.
    expect(seriesSettings({ engine: "cloud", length: 60, animation: "seamless", aspect: "9:16", brief, genre, voice: { kind: "preset", id: "abc" } }).voice).toEqual({ kind: "preset", id: "abc" });
    expect(CF_LENGTH_VALUES).toEqual([30, 60, 120, 180, 240, 300]);
  });

  it("voiceForTone matches the voices' own descriptions", () => {
    const voices = [
      { id: "deep", name: "Brian", hint: "Deep, Resonant" },
      { id: "kid", name: "Jessica", hint: "Playful, Bright, Warm" },
      { id: "edu", name: "Alice", hint: "Clear, Engaging Educator" },
    ];
    expect(voiceForTone("Low, grave narrator", voices, "x")).toBe("deep");
    expect(voiceForTone("playful and warm", voices, "x")).toBe("kid");
    expect(voiceForTone("clear explainer", voices, "x")).toBe("edu");
    expect(voiceForTone("zzz", voices, "fallback")).toBe("fallback");
  });

  it("the scene length follows the style and the reference's cut rate", () => {
    for (const a of ANIMATION_STYLES) {
      for (const shot of [1, 2.5, 5, 12]) {
        const s = sceneSecondsFor(a, shot);
        expect(s).toBeGreaterThanOrEqual(4);
        expect(s).toBeLessThanOrEqual(10);
      }
    }
    expect(sceneSecondsFor(animationStyle("scene-by-scene"), 2)).toBeLessThan(sceneSecondsFor(animationStyle("seamless"), 2));
    expect(scenesFor(30, 5)).toBe(6);
    expect(scenesFor(300, 8)).toBe(38);
    expect(placeholderBlocks(30, 5)).toHaveLength(6);
    expect(placeholderBlocks(30)).toHaveLength(3);
  });
});

describe("the brief applied to a Faceless episode", () => {
  const block = (i: number): ScriptBlock => ({ id: `b${i}`, narration: "A short line about flying cars over the city tonight.", visual: "A flying car over a city", motion: "slow push-in", seconds: 5 });
  const brief = parseBrief(GEMMA)!.brief;

  it("reaches the pictures, the motion, the music and the captions", () => {
    for (const engine of ["cloud", "open"] as const) {
      const settings = seriesSettings({ engine, length: 30, animation: "seamless", aspect: "9:16", brief, genre: genreInfo("storytelling"), voice: engine === "open" ? null : undefined, voices: getModel("elevenlabs-v4")!.options.voices });
      const graph = buildEpisodeGraph(
        { feature: "faceless", title: "Flying cars", genre: genreInfo("storytelling"), settings, blocks: [block(0), block(1)], fallbackVoice: "/api/files/uploads/demo-voice.wav" },
        getModel,
      );
      const still = graph.find((s) => s.part === "still")!;
      expect(still.request.prompt).toContain("Look: glossy 3D render");
      expect(still.request.prompt).toContain(getStyle("colorful-3d").look);
      const clip = graph.find((s) => s.part === "clip")!;
      expect(clip.request.prompt).toMatch(/Camera: one continuous camera move/);
      expect(graph.find((s) => s.key === "music")!.request.prompt).toMatch(/^Instrumental background music for a narrated video: electronic, high energy\./);
      const captions = graph.find((s) => s.part === "captions")!.request.params!.extra!;
      expect(captions).toEqual(engine === "open" ? { fontSize: 4, wordsPerCaption: 1, captionPosition: "bottom" } : { words_per_subtitle: 1, position: "center" });
    }
  });

  it("leaves a plain Faceless episode as it was", () => {
    const settings = { ...seriesSettings({ engine: "cloud", length: 60, animation: "fully-animated", aspect: "16:9", brief, genre: genreInfo("education") }), brief: undefined };
    const graph = buildEpisodeGraph({ feature: "faceless", title: "T", genre: genreInfo("education"), settings, blocks: [block(0)] }, getModel);
    expect(graph.find((s) => s.part === "still")!.request.prompt).not.toContain("Look:");
    expect(graph.find((s) => s.part === "clip")!.request.prompt).not.toContain("Camera:");
    expect(graph.find((s) => s.part === "captions")!.request.params!.extra).toEqual({ words_per_subtitle: 5 });
  });

  it("gives the writer the brief and the scene length", () => {
    const look = briefLook(brief, animationStyle("scene-by-scene"));
    const text = scriptBrief({ topic: "Flying cars", genre: genreInfo("storytelling"), scenes: 6, wordsPerScene: 11, style: look.script });
    expect(text).toContain("Write exactly 6 scenes, each at most 11 words of narration (about 5 seconds spoken).");
    expect(text).toMatch(/Follow this style brief:\n- Format: 'what if' explainer\n- Hook/);
    expect(scriptBrief({ topic: "x", genre: genreInfo("education"), scenes: 3, wordsPerScene: 22 })).toContain("(about 10 seconds spoken)");
  });
});

describe("plan prices", () => {
  it("multiplies one episode by the series and adds reading the reference", () => {
    expect(seriesPrice({ total: 4.02, unknown: false }, 3, 0.19)).toEqual({ total: 12.25, perEpisode: 4.02, episodes: 3, analysisUsd: 0.19, unknown: false });
    expect(seriesPrice({ total: 0, unknown: false }, 0)).toMatchObject({ episodes: 1, total: 0 });
    expect(seriesPrice({ total: 1, unknown: true }, 50)).toMatchObject({ episodes: 10, total: 10, unknown: true });
  });

  it("prices reading a reference: frames, transcript and Claude's look at them", () => {
    const one = briefCostUsd({ seconds: 60, framesUsd: 0.001, transcribePerMinute: 0.008 });
    // 20 frames × 1,850 tokens + the text at $4/M in, ~1,800 tokens out at $20/M.
    expect(one).toBeGreaterThan(0.15);
    expect(one).toBeLessThan(0.25);
    expect(briefCostUsd({ seconds: 5 })).toBeLessThan(one);
    expect(briefCostUsd({ seconds: 60, claude: false, transcribePerMinute: 0.008 })).toBe(0.008);
  });
});

describe("Generate in Claude", () => {
  const base = { prompt: "What if cars could fly", brief: PRESETS[0].brief, length: 60, episodes: 3, animation: "fully-animated" as const, genre: genreInfo("storytelling"), aspect: "9:16" as const, engine: "cloud" as const };

  it("asks Claude to plan, price, ask, then run faceless_episode per episode", () => {
    const m = claudeMessage({ ...base, voice: "JBFqnCBsd6RMkjVDRZzb", reference: "“Flying cars” (TikTok)" });
    expect(m).toContain("series of 3 episodes");
    expect(m).toContain("Make a video about: What if cars could fly");
    expect(m).toContain('load_skill "faceless-video"');
    expect(m).toContain("estimate_job");
    expect(m).toMatch(/Run faceless_episode once per episode with style ".+", aspect_ratio "9:16" and voice "JBFqnCBsd6RMkjVDRZzb"/);
    expect(m).toContain("never the reference's people");
    expect(m).not.toContain("voice_sample");
    expect(m).not.toMatch(/\n\n\n/);
    expect(claudeMessage({ ...base, episodes: 1, engine: "open" })).toMatch(/^Make a faceless short-video episode[\s\S]*voice_sample/);
  });

  it("stays within 64 KB however long the prompt is", () => {
    const m = claudeMessage({ ...base, prompt: "flying cars ".repeat(20_000) });
    expect(new TextEncoder().encode(m).length).toBeLessThanOrEqual(MAX_CLAUDE_MESSAGE);
    expect(m).toContain("Run faceless_episode");
  });

  it("builds the claude mcp add line", () => {
    expect(mcpCommand("http://localhost:3000/", false)).toBe("claude mcp add --transport http fuobe http://localhost:3000/api/mcp");
    expect(mcpCommand("https://studio.example.com", true)).toBe('claude mcp add --transport http fuobe https://studio.example.com/api/mcp --header "Authorization: Bearer fuobe_…"');
  });
});
