import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SeriesEstimate, SeriesView } from "@/lib/catalog/content-factory";

// Content Factory's server (r4/content-factory): references (an upload, a link through the guard and the
// SSRF-safe fetch, a preset), reading them into a brief on both engines (demo mode here), prices, "Generate
// here" (a channel and Faceless episodes that carry the brief), "Next episode", and the message for Claude.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-content-factory-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: cloud and open models run on the demo provider, and there's no LLM (the offline writers run).
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const { getGeneration } = await import("@/server/generations");
const faceless = await import("@/server/faceless");
const cf = await import("@/server/content-factory");
const seriesRoute = await import("@/app/api/content-factory/series/route");
const oneRoute = await import("@/app/api/content-factory/series/[id]/route");
const generateRoute = await import("@/app/api/content-factory/series/[id]/generate/route");
const episodesRoute = await import("@/app/api/content-factory/series/[id]/episodes/route");
const readRoute = await import("@/app/api/content-factory/series/[id]/read/route");
const estimateRoute = await import("@/app/api/content-factory/estimate/route");
const claudeRoute = await import("@/app/api/content-factory/claude/route");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const json = (method: string, body?: unknown) =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const view = (id: string): SeriesView => JSON.parse(JSON.stringify(cf.seriesView(id)));

async function readied(id: string, ms = 60_000): Promise<SeriesView> {
  const end = Date.now() + ms;
  for (;;) {
    const v = view(id);
    if (v.analysis?.status !== "reading") {
      await cf.briefWritten(id);
      return view(id);
    }
    if (Date.now() > end) throw new Error(`still reading: ${v.analysis.stage}`);
    await sleep(300);
  }
}

const clip = () => saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples/demo-portrait.mp4")), contentType: "video/mp4", name: "reference.mp4", source: "upload" }).url;
const settings = { engine: "cloud" as const, length: 30, episodes: 3, animation: "scene-by-scene" as const, genre: "history" as const, aspect: "9:16" as const };

describe("the reference", () => {
  it("refuses bad links before fetching anything, and asks for an upload where a platform keeps its video", async () => {
    const local = await seriesRoute.POST(json("POST", { reference: { kind: "link", link: "http://localhost:3000/clip.mp4" }, engine: "cloud" }));
    expect(local.status).toBe(400);
    expect((await local.json()).error).toMatch(/public link/);
    const profile = await seriesRoute.POST(json("POST", { reference: { kind: "link", link: "https://www.tiktok.com/@someone" }, engine: "cloud" }));
    expect(profile.status).toBe(400);
    const yt = await seriesRoute.POST(json("POST", { reference: { kind: "link", link: "https://youtu.be/dQw4w9WgXcQ" }, engine: "cloud" }));
    expect(yt.status).toBe(422);
    expect(await yt.json()).toMatchObject({ needsUpload: true, error: expect.stringMatching(/upload it here/) });
  });

  it("fetches a link only through the SSRF-safe fetch: a private address is refused", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "link", link: "http://10.1.2.3/reference.mp4" }, engine: "cloud" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ needsUpload: true, error: expect.stringMatching(/private network/) });
  });

  it("refuses an upload that isn't a video", async () => {
    const img = saveFile({ data: Buffer.from("GIF89a"), contentType: "image/gif", name: "x.gif", source: "upload" }).url;
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "upload", url: img }, engine: "cloud" }));
    expect(res.status).toBe(400);
  });

  it("a preset's brief is ready straight away, for nothing", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "dark-history" }, engine: "cloud" }));
    expect(res.status).toBe(201);
    const v: SeriesView = await res.json();
    expect(v.analysis).toMatchObject({ status: "ready", costUsd: 0 });
    expect(v.brief?.styleId).toBeTruthy();
    expect(v.reference).toMatchObject({ kind: "preset", presetId: "dark-history" });
  });
});

describe("reading a clip into a brief", () => {
  it("cloud: frames and a transcript as generations, then the brief (offline in demo mode, and it says so)", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "upload", url: clip(), title: "My reference" }, engine: "cloud" }));
    expect(res.status).toBe(201);
    const v: SeriesView = await res.json();
    expect(v.reference).toMatchObject({ kind: "upload", title: "My reference" });
    expect(v.reference?.seconds).toBeGreaterThan(0);
    expect(v.reference?.height).toBeGreaterThan(v.reference!.width!);
    expect(v.analysis).toMatchObject({ engine: "cloud", status: "reading", demo: true });
    const frames = getGeneration(v.analysis!.steps.frames!)!;
    const words = getGeneration(v.analysis!.steps.transcript!)!;
    expect(frames.request).toMatchObject({ feature: "content-factory", modelId: "extract-frames", op: "extract-frames" });
    expect(frames.request.params?.frameInterval).toBeGreaterThanOrEqual(1);
    expect(words.request).toMatchObject({ modelId: "scribe-v2", op: "transcribe" });
    const ready = await readied(v.id);
    expect(ready.analysis).toMatchObject({ status: "ready", offline: true, note: expect.stringMatching(/^Demo brief/) });
    // The clip's own shape wins: a portrait clip gives a 9:16 brief.
    expect(ready.brief).toMatchObject({ aspect: "9:16" });
  }, 90_000);

  it("open: one Gemma 4 generation (reference-brief-gemma4), its first 30 s", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "upload", url: clip() }, engine: "open" }));
    const v: SeriesView = await res.json();
    expect(Object.keys(v.analysis!.steps)).toEqual(["brief"]);
    const g = getGeneration(v.analysis!.steps.brief!)!;
    expect(g.request).toMatchObject({ modelId: "oss-reference-brief", op: "write", inputs: { video: expect.stringMatching(/^\/api\/files\//) } });
    expect(g.request.params?.duration).toBeLessThanOrEqual(30);
    const ready = await readied(v.id);
    expect(ready.analysis).toMatchObject({ status: "ready", offline: true, note: expect.stringMatching(/start ComfyUI/) });
    // Read again on the other engine: a new read replaces the old one.
    const again = await readRoute.POST(json("POST", { engine: "cloud" }), params({ id: v.id }));
    expect(((await again.json()) as SeriesView).analysis).toMatchObject({ engine: "cloud", status: "reading" });
    await readied(v.id);
  }, 90_000);

  it("the frame interval asks for about a frame a second, at most 20 over the clip", () => {
    expect(cf.frameInterval(10, 30)).toBe(30);
    expect(cf.frameInterval(60, 30)).toBe(90);
    expect(cf.frameInterval(300, 60)).toBe(300);
    expect(cf.frameInterval(undefined, undefined)).toBe(45);
    expect(cf.spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
    expect(cf.spread([1, 2], 4)).toEqual([1, 2]);
  });
});

describe("prices, Generate here and Next episode", () => {
  let series: SeriesView;

  it("prices the series before anything runs: one episode at the brief's pace × the episodes", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "dark-history" }, engine: "cloud" }));
    series = await res.json();
    const est: SeriesEstimate = await (await estimateRoute.POST(json("POST", { prompt: "The lost city of Ys", settings, seriesId: series.id }))).json();
    expect(est.price.episodes).toBe(3);
    expect(est.price.total).toBeCloseTo(est.price.perEpisode * 3, 1);
    expect(est.scenes).toBeGreaterThan(3);
    expect(est.demo).toBe(true);
    const one: SeriesEstimate = await (await estimateRoute.POST(json("POST", { prompt: "x", settings: { ...settings, episodes: 1 }, seriesId: series.id }))).json();
    expect(one.price.total).toBeCloseTo(one.price.perEpisode, 2);
    // The open engine needs a narrator's voice sample first (in demo mode the demo narrator stands in).
    expect(((await (await estimateRoute.POST(json("POST", { prompt: "x", settings: { ...settings, engine: "open" }, seriesId: series.id, voice: null }))).json()) as SeriesEstimate).demo).toBe(true);
    setSetting("demoMode", "off");
    try {
      const open: SeriesEstimate = await (await estimateRoute.POST(json("POST", { prompt: "x", settings: { ...settings, engine: "open" }, seriesId: series.id, voice: null }))).json();
      expect(open.error).toMatch(/narrator's voice/);
      expect(open.analysisPerMinute).toBe(0);
    } finally {
      setSetting("demoMode", "auto");
    }
    // A length outside 30 s – 5 min is refused.
    expect((await estimateRoute.POST(json("POST", { prompt: "x", settings: { ...settings, length: 45 }, seriesId: series.id }))).status).toBe(400);
  });

  it("makes the channel and one Faceless episode per planned title, each carrying the brief", async () => {
    const res = await generateRoute.POST(json("POST", { prompt: "The lost city of Ys", settings }), params({ id: series.id }));
    expect(res.status).toBe(200);
    const v: SeriesView = await res.json();
    expect(v.channel).toBeTruthy();
    expect(v.channel!.settings.brief?.script.join(" ")).toMatch(/Format:/);
    expect(v.plan).toHaveLength(3);
    expect(v.episodes.map((e) => e.title)).toEqual(v.plan.map((p) => p.title));
    const ep = faceless.episodeView(v.episodes[0].id).episode;
    expect(ep.settings).toMatchObject({ length: 30, animation: "frames", aspect: "9:16", brief: { sceneSeconds: expect.any(Number) } });
    expect(ep.topic).toMatch(/^Episode 1 of the series “The lost city of Ys”/);
    expect(faceless.episodeView(v.episodes[2].id).episode.topic).toMatch(/Earlier episodes: .+; .+\./);
    // The offline writer keeps a 30-second episode near 30 s, even at the brief's faster pace.
    await faceless.scriptWritten(v.episodes[0].id);
    const written = faceless.episodeView(v.episodes[0].id).episode;
    expect(written.script.blocks.reduce((n, b) => n + b.seconds, 0)).toBeLessThanOrEqual(30 * 1.15);
    // A second click doesn't make it twice.
    expect((await generateRoute.POST(json("POST", { prompt: "The lost city of Ys", settings }), params({ id: series.id }))).status).toBe(409);
    // GET handlers start with connection(), which needs a request scope: read through the server module.
    const list = cf.listSeries();
    expect(list).toEqual(expect.arrayContaining([expect.objectContaining({ id: series.id, episodes: 3, channelId: v.channel!.id })]));
  });

  it("plans the next episodes after the ones already made", async () => {
    const res = await episodesRoute.POST(json("POST", { count: 2, next: "The bells under the sea ring again" }), params({ id: series.id }));
    const v: SeriesView = await res.json();
    expect(v.plan).toHaveLength(5);
    expect(v.episodes).toHaveLength(5);
    expect(v.plan[3].synopsis).toBe("The bells under the sea ring again");
    const ep = faceless.episodeView(v.episodes[3].id).episode;
    expect(ep.topic).toMatch(/^Episode 4 of the series/);
    expect(ep.settings.brief).toBeTruthy();
  });

  it("a one-video series lets the script writer name it, and a draft without a brief can't run", async () => {
    const one: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "what-if" }, engine: "cloud" }))).json();
    const v: SeriesView = await (await generateRoute.POST(json("POST", { prompt: "What if the Moon had a city", settings: { ...settings, episodes: 1, animation: "fully-animated" } }), params({ id: one.id }))).json();
    expect(v.episodes).toHaveLength(1);
    expect(faceless.episodeView(v.episodes[0].id).episode.settings.animation).toBe("animated");
    const empty: SeriesView = await (await seriesRoute.POST(json("POST", { reference: null, engine: "cloud" }))).json();
    const res = await generateRoute.POST(json("POST", { prompt: "x", settings }), params({ id: empty.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reference or pick a preset/);
  });

  it("deletes the series with its channel", async () => {
    const channelId = view(series.id).channel!.id;
    expect((await oneRoute.DELETE(json("DELETE"), params({ id: series.id }))).status).toBe(204);
    expect(faceless.getChannel(channelId)).toBeNull();
    expect(() => cf.seriesView(series.id)).toThrow(/not found/);
  });
});

describe("Generate in Claude", () => {
  it("composes the message from the brief, with nothing sent anywhere", async () => {
    const s: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "what-if" }, engine: "cloud" }))).json();
    const res = await claudeRoute.POST(json("POST", { prompt: "What if cats ruled the world", settings, seriesId: s.id, voice: { kind: "preset", id: "JBFqnCBsd6RMkjVDRZzb" } }));
    const out = await res.json();
    expect(out.needsToken).toBe(false);
    expect(out.bytes).toBeLessThanOrEqual(64 * 1024);
    expect(out.message).toContain("series of 3 episodes");
    expect(out.message).toContain('voice "JBFqnCBsd6RMkjVDRZzb"');
    expect(out.message).toContain("faceless_episode");
    expect((await claudeRoute.POST(json("POST", { prompt: "  ", settings, seriesId: s.id }))).status).toBe(400);
  });

  it("edits the brief by hand", async () => {
    const s: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "what-if" }, engine: "cloud" }))).json();
    const res = await oneRoute.PATCH(json("PATCH", { brief: { ...s.brief!, hook: "Start on the punchline" } }), params({ id: s.id }));
    expect(((await res.json()) as SeriesView).brief?.hook).toBe("Start on the punchline");
  });
});
