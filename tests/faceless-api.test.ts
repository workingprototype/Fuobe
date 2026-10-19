import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EpisodeSettings, EpisodeView, FacelessChannel, FacelessEpisode } from "@/lib/catalog/faceless";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-faceless-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: open models run on the demo provider, and there's no LLM (the offline writer runs).
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const faceless = await import("@/server/faceless");
const channelsRoute = await import("@/app/api/faceless/channels/route");
const channelRoute = await import("@/app/api/faceless/channels/[id]/route");
const topicsRoute = await import("@/app/api/faceless/topics/route");
const episodesRoute = await import("@/app/api/faceless/episodes/route");
const episodeRoute = await import("@/app/api/faceless/episodes/[id]/route");
const actionRoute = await import("@/app/api/faceless/episodes/[id]/[action]/route");
const changeRoute = await import("@/app/api/faceless/episodes/[id]/change/route");
const estimateRoute = await import("@/app/api/faceless/estimate/route");
const voiceRoute = await import("@/app/api/faceless/voices/preview/route");
const explainerRoute = await import("@/app/api/explainer/route");
const linkRoute = await import("@/app/api/explainer/link/route");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const json = (method: string, body?: unknown) =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const cloud: EpisodeSettings = {
  engine: "cloud",
  length: 60,
  animation: "animated",
  aspect: "16:9",
  subtitles: true,
  music: false,
  styleId: "editorial-motion-graphics",
  styleRefs: [],
  voice: { kind: "preset", id: "Xb7hH8MSUJpSbSDYk0k2" },
  elements: [],
};
const open: EpisodeSettings = { ...cloud, engine: "open", music: true, voice: null, aspect: "9:16", animation: "frames" };

async function view(id: string): Promise<EpisodeView> {
  // GET handlers start with connection(), which needs a request scope: read through the server module.
  return JSON.parse(JSON.stringify(faceless.episodeView(id)));
}

/** Wait for an episode to finish rendering (demo jobs: a few seconds per step). */
async function settled(id: string, ms = 90_000): Promise<EpisodeView> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await view(id);
    if (v.episode.status === "done" || v.episode.status === "failed") return v;
    if (Date.now() > until) throw new Error(`timed out: ${v.episode.status} ${Math.round(v.progress * 100)}%`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

let channel: FacelessChannel;

describe("Faceless channels and topics", () => {
  it("creates a channel with a written name, lists it, and saves its look", async () => {
    const res = await channelsRoute.POST(json("POST", { idea: "Channel about the rise and fall of empires", genre: "history", engine: "cloud" }));
    expect(res.status).toBe(201);
    channel = await res.json();
    expect(channel).toMatchObject({ name: "The Rise and Fall of Empires", genre: "history", settings: { styleId: "watercolor-chronicle", voice: { kind: "preset", id: "JBFqnCBsd6RMkjVDRZzb" }, aspect: "16:9", subtitles: true } });
    expect(faceless.listChannels().map((c) => c.id)).toContain(channel.id);
    expect((await channelsRoute.POST(json("POST", { idea: "", genre: "history", engine: "cloud" }))).status).toBe(400);
    const bad = await channelsRoute.POST(json("POST", { idea: "x", genre: "history", engine: "cloud", reference: "https://vimeo.com/1" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("That does not look like a YouTube channel, video or playlist link.");
    const patched = await (await channelRoute.PATCH(json("PATCH", { name: "Empires", settings: { aspect: "9:16" } }), params({ id: channel.id }))).json();
    expect(patched).toMatchObject({ name: "Empires", settings: { aspect: "9:16", styleId: "watercolor-chronicle" } });
    expect((await channelRoute.PATCH(json("PATCH", { name: "x" }), params({ id: "nope" }))).status).toBe(404);
  });

  it("suggests 4–6 topics offline, and new ones on the next round", async () => {
    const first = await (await topicsRoute.POST(json("POST", { channelId: channel.id, engine: "cloud" }))).json();
    expect(first.offline).toBe(true);
    expect(first.topics.length).toBeGreaterThanOrEqual(4);
    expect(first.topics.length).toBeLessThanOrEqual(6);
    expect(first.topics[0].title).toMatch(/rise and fall of empires/i);
    const next = await (await topicsRoute.POST(json("POST", { channelId: channel.id, engine: "cloud", round: 1 }))).json();
    expect(next.topics[0].title).not.toBe(first.topics[0].title);
  });
});

describe("Episodes", () => {
  it("validates lengths, topics and scripts", async () => {
    const bad = await episodesRoute.POST(json("POST", { channelId: channel.id, topic: "x", settings: { ...cloud, length: 90 } }));
    expect((await bad.json()).error).toBe("Choose one of the offered video lengths");
    const empty = await episodesRoute.POST(json("POST", { channelId: channel.id, topic: " ", settings: cloud }));
    expect((await empty.json()).error).toBe("Add a topic, or bring your own script");
    const long = await episodesRoute.POST(json("POST", { channelId: channel.id, topic: "x", script: "word ".repeat(2500), settings: cloud }));
    expect((await long.json()).error).toBe("That script is too long to narrate. Shorten it and try again.");
    const refs = await episodesRoute.POST(json("POST", { channelId: channel.id, topic: "x", settings: { ...cloud, styleRefs: ["/api/files/a.png", "/api/files/b.png", "/api/files/c.png", "/api/files/d.png"] } }));
    expect((await refs.json()).error).toBe("Up to 3 style references");
  });

  it("splits a pasted script into scenes for review, and edits them before rendering", async () => {
    const script = "The Roman Empire did not fall in a day. For centuries it stretched from Britain to Egypt. Then, slowly, the cracks began to show. Armies grew expensive, borders grew long, and emperors came and went. By 476, the western half was gone.";
    const res = await episodesRoute.POST(json("POST", { channelId: channel.id, topic: "How Rome fell", script, settings: cloud }));
    expect(res.status).toBe(201);
    const ep: FacelessEpisode = await res.json();
    expect(ep.status).toBe("writing");
    await faceless.scriptWritten(ep.id);
    const v = await view(ep.id);
    expect(v.episode.status).toBe("review");
    expect(v.episode.script).toMatchObject({ source: "pasted", offline: true });
    expect(v.episode.script.blocks.map((b) => b.narration).join(" ")).toBe(script);
    expect(v.episode.script.blocks.every((b) => b.seconds <= 10 && b.visual)).toBe(true);
    // Review: edit a scene; a scene with too many words is split.
    const blocks = v.episode.script.blocks.map((b, i) => (i === 0 ? { ...b, narration: `${b.narration} ${"and it kept going on ".repeat(8)}` } : b));
    const edited: EpisodeView = await (await episodeRoute.PATCH(json("PATCH", { blocks, title: "Rome, slowly" }), params({ id: ep.id }))).json();
    expect(edited.episode.title).toBe("Rome, slowly");
    expect(edited.episode.script.blocks.length).toBeGreaterThan(v.episode.script.blocks.length);
    expect(edited.episode.script.blocks.every((b) => b.seconds <= 10)).toBe(true);
    expect(edited.steps.filter((s) => s.part === "still")).toHaveLength(edited.episode.script.blocks.length);
    expect(edited.estimate!.total).toBeGreaterThan(0);
    // The channel remembers the look and voice of its latest episode.
    expect(faceless.listEpisodes({ channelId: channel.id }).map((e) => e.id)).toContain(ep.id);
    expect(faceless.getChannel(channel.id)!.settings.aspect).toBe("16:9");
  });

  it("estimates by engine and mode, and says what's in the way", async () => {
    const est = async (s: EpisodeSettings) => (await estimateRoute.POST(json("POST", { kind: "faceless", settings: s }))).json();
    const animated = await est(cloud);
    const frames = await est({ ...cloud, animation: "frames" });
    expect(animated.demo).toBe(true);
    expect(animated.blocks).toBe(6);
    expect(animated.estimate.parts.clip).toBeCloseTo(6, 5);
    expect(frames.estimate.total).toBeLessThan(animated.estimate.total);
    const openEst = await est(open);
    expect(openEst.estimate.total).toBe(0);
    expect(openEst.error).toBeUndefined();
    // Cloud music needs the open mixer; with everything on the demo provider it still runs.
    expect((await est({ ...cloud, music: true })).error).toBeUndefined();
    setSetting("engineMode", "cloud");
    try {
      expect((await est({ ...cloud, music: true })).error).toMatch(/turn music off/);
      expect((await est(open)).error).toMatch(/cloud APIs only/);
    } finally {
      setSetting("engineMode", "both");
    }
  });

  it(
    "renders end to end in demo mode on both engines, then re-runs one scene, undoes it and retries a failure",
    async () => {
      const make = async (settings: EpisodeSettings, topic: string) => {
        const ep: FacelessEpisode = await (await episodesRoute.POST(json("POST", { channelId: channel.id, topic, settings }))).json();
        await faceless.scriptWritten(ep.id);
        const v = await view(ep.id);
        expect(v.episode.status).toBe("review");
        expect(v.episode.script).toMatchObject({ source: "ai", offline: true });
        expect(v.episode.script.blocks).toHaveLength(6);
        const r = await actionRoute.POST(json("POST"), params({ id: ep.id, action: "render" }));
        expect(r.status).toBe(200);
        return ep.id;
      };
      const cloudId = await make(cloud, "Why Rome split in two");
      const openId = await make(open, "The fall of Byzantium");
      expect((await actionRoute.POST(json("POST"), params({ id: cloudId, action: "render" }))).status).toBe(409);

      const rendering = await view(openId);
      expect(rendering.episode.status).toBe("rendering");
      // Open, frame by frame: 12 shots, folded joins, the demo voice cloned, music, timed captions.
      const ids = rendering.episode.plan!.ids;
      // A 10-second scene is two 5-second Wan shots; short scenes are one.
      const clips = Object.keys(ids).filter((k) => k.startsWith("clip-"));
      expect(clips.length).toBeGreaterThan(6);
      expect(clips).toHaveLength(rendering.steps.filter((s) => s.part === "clip").length);
      expect(Object.keys(ids)).toEqual(expect.arrayContaining(["join", "join-1-1", "narration", "music", "mix", "words", "captions"]));
      const narration = gens.getGeneration(ids.narration)!;
      expect(narration.request.inputs?.voiceAudio).toMatch(/^\/api\/files\/uploads\/.+\.wav$/);
      expect(gens.getGeneration(ids["clip-" + rendering.episode.script.blocks[0].id + "-1"])!.request.prompt).toMatch(/still illustration/);

      const [doneCloud, doneOpen] = await Promise.all([settled(cloudId), settled(openId)]);
      for (const v of [doneCloud, doneOpen]) {
        expect(v.episode.status).toBe("done");
        expect(v.final?.status).toBe("succeeded");
        expect(v.final?.outputs[0].kind).toBe("video");
        expect(v.progress).toBe(1);
        expect(v.steps.every((s) => s.generation?.status === "succeeded")).toBe(true);
      }
      expect(doneOpen.final!.op).toBe("captions");
      expect(doneOpen.final!.request.title).toBe(doneOpen.episode.title);

      // Timeline editor: change scene 3's picture.
      const target = doneCloud.episode.script.blocks[2].id;
      const before = doneCloud.episode.plan!.ids;
      const preview = await (await changeRoute.POST(json("POST", { blocks: [target], part: "picture", instruction: "make it night" }), params({ id: cloudId }))).json();
      expect(preview.rerun).toEqual([`still-${target}`, `clip-${target}-1`, "join", "mix", "captions"]);
      expect(preview.costUsd).toBeGreaterThan(0.3);
      expect(preview.demo).toBe(true);
      const applied = await changeRoute.POST(json("POST", { blocks: [target], part: "picture", instruction: "make it night", apply: true }), params({ id: cloudId }));
      expect(applied.status).toBe(201);
      const changing: EpisodeView = await applied.json();
      expect(changing.episode.status).toBe("rendering");
      const after = changing.episode.plan!.ids;
      expect(after[`still-${target}`]).not.toBe(before[`still-${target}`]);
      expect(after[`still-${doneCloud.episode.script.blocks[0].id}`]).toBe(before[`still-${doneCloud.episode.script.blocks[0].id}`]);
      expect(after.narration).toBe(before.narration);
      expect(gens.getGeneration(after[`still-${target}`])!.request).toMatchObject({ op: "edit", inputs: { images: [doneCloud.steps.find((s) => s.key === `still-${target}`)!.generation!.outputs[0].url] } });
      expect(changing.previousFinal?.id).toBe(before.captions);
      expect(changing.episode.plan!.changes).toHaveLength(1);

      // A narration change re-voices the whole voice-over and re-mixes; the pictures are kept.
      const voice = await (await changeRoute.POST(json("POST", { blocks: [doneOpen.episode.script.blocks[2].id], part: "narration", narration: ["Night fell over the city."] }), params({ id: openId }))).json();
      expect(voice.rerun).toEqual(["narration", "mix", "words", "captions"]);

      // Retry (meanwhile, on the open episode): a step that fails takes what waits on it down; Retry redoes only those.
      const failing = await view(openId);
      const clipKey = failing.steps.find((s) => s.key.startsWith(`clip-${failing.episode.script.blocks[1].id}-`))!.key;
      await changeRoute.POST(json("POST", { blocks: [failing.episode.script.blocks[1].id], part: "motion", instruction: "a slow zoom out", apply: true }), params({ id: openId }));
      const mid = await view(openId);
      expect(mid.episode.plan!.ids[clipKey]).not.toBe(failing.episode.plan!.ids[clipKey]);
      expect(mid.episode.plan!.ids[`still-${failing.episode.script.blocks[1].id}`]).toBe(failing.episode.plan!.ids[`still-${failing.episode.script.blocks[1].id}`]);
      await gens.cancelGeneration(mid.episode.plan!.ids[clipKey]);

      const [changed, failed] = await Promise.all([settled(cloudId), settled(openId)]);
      expect(changed.episode.status).toBe("done");
      expect(changed.final!.id).toBe(after.captions);
      // Undo goes back to the version before.
      const undone: EpisodeView = await (await actionRoute.POST(json("POST"), params({ id: cloudId, action: "undo" }))).json();
      expect(undone.episode.plan!.ids).toEqual(before);
      expect((await settled(cloudId)).final!.id).toBe(before.captions);

      expect(failed.episode.status).toBe("failed");
      expect(failed.episode.error).toBeTruthy();
      const retried: EpisodeView = await (await actionRoute.POST(json("POST"), params({ id: openId, action: "retry" }))).json();
      expect(retried.episode.status).toBe("rendering");
      expect(retried.episode.plan!.ids[clipKey]).not.toBe(mid.episode.plan!.ids[clipKey]);
      expect(retried.episode.plan!.ids.narration).toBe(mid.episode.plan!.ids.narration);
      // The redone clip runs (what follows it is the same chain the first render ran).
      const redone = retried.episode.plan!.ids[clipKey];
      for (let i = 0; i < 60 && gens.getGeneration(redone)!.status !== "succeeded"; i++) await new Promise((r) => setTimeout(r, 500));
      expect(gens.getGeneration(redone)!.status).toBe("succeeded");
    },
    300_000,
  );
});

describe("Explainer", () => {
  it("renders straight from a prompt and a document, lists history and likes", async () => {
    const res = await explainerRoute.POST(
      json("POST", {
        prompt: "Explain how dinosaurs went extinct, for kids",
        sources: [{ kind: "text", name: "notes.txt", text: "An asteroid hit Chicxulub 66 million years ago." }],
        settings: { ...cloud, length: 30, styleId: "pixel-art" },
      }),
    );
    expect(res.status).toBe(201);
    const ep: FacelessEpisode = await res.json();
    await faceless.scriptWritten(ep.id);
    const v = await view(ep.id);
    expect(v.episode.kind).toBe("explainer");
    expect(v.episode.status).toBe("rendering");
    expect(v.episode.script.blocks).toHaveLength(3);
    expect(v.steps.find((s) => s.part === "still")!.generation!.request.prompt).toMatch(/16-bit pixel art/);
    expect(faceless.listEpisodes({ kind: "explainer", q: "dinosaurs" }).map((c) => c.id)).toEqual([ep.id]);
    expect(faceless.listEpisodes({ kind: "faceless", q: "dinosaurs" })).toEqual([]);
    await episodeRoute.PATCH(json("PATCH", { favorite: true }), params({ id: ep.id }));
    expect(faceless.listEpisodes({ kind: "explainer", liked: true })).toHaveLength(1);
    // Validation the research names.
    const many = await explainerRoute.POST(json("POST", { prompt: "x", sources: Array.from({ length: 4 }, (_, i) => ({ kind: "text", name: `${i}`, text: "t" })), settings: cloud }));
    expect((await many.json()).error).toBe("Up to 3 sources per video — remove one to add another");
    const none = await explainerRoute.POST(json("POST", { prompt: "", settings: cloud }));
    expect((await none.json()).error).toBe("Add a prompt, or attach a file or link");
  });

  it("refuses links to this machine (SSRF-safe fetch)", async () => {
    const res = await linkRoute.POST(json("POST", { url: "http://127.0.0.1:9/secret", engine: "cloud" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/won't fetch/);
    expect(faceless.pageText("<html><head><title>Tides &amp; you</title><script>x()</script></head><body><p>The moon pulls.</p><p>Twice a day.</p></body></html>")).toEqual({
      title: "Tides & you",
      text: "The moon pulls.\nTwice a day.",
    });
  });

  it("makes one voice preview per narrator and reuses it", async () => {
    const a = await (await voiceRoute.POST(json("POST", { id: "JBFqnCBsd6RMkjVDRZzb" }))).json();
    const b = await (await voiceRoute.POST(json("POST", { id: "JBFqnCBsd6RMkjVDRZzb" }))).json();
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ feature: "faceless-voice", op: "tts", modelId: "elevenlabs-v4" });
    expect(a.request.prompt).toMatch(/I'm George/);
    expect((await voiceRoute.POST(json("POST", { id: "nobody" }))).status).toBe(400);
  });
});
