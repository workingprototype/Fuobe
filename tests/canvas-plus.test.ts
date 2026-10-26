import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasGraph, CanvasNode } from "@/lib/catalog/canvas";
import type { Generation } from "@/lib/catalog/types";

// Route handlers are called directly, outside a Next request: connection() has nothing to wait for.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-canvas-plus-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const {
  CONCAT_SIZE,
  MUTE_LEVEL,
  OPEN_DUB_HINT,
  cleanGraph,
  concatClips,
  connectionError,
  convertEngine,
  describeNode,
  inputPorts,
  nodeSignature,
  outputType,
  paletteItems,
  planCanvas,
  runOutput,
} = await import("@/lib/catalog/canvas");
const board = await import("@/lib/catalog/canvas-board");
const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const list = await import("@/app/api/canvases/route");
const one = await import("@/app/api/canvases/[id]/route");
const run = await import("@/app/api/canvases/[id]/run/route");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/canvases", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const node = (id: string, type: CanvasNode["type"], data: CanvasNode["data"] = {}, x = 0, y = 0): CanvasNode => ({ id, type, position: { x, y }, data });
const edge = (source: string, target: string, targetHandle: string) => ({ id: `${source}-${target}-${targetHandle}`, source, sourceHandle: "out", target, targetHandle });

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ---------------------------------------------------------------------------

describe("typed ports of the new nodes", () => {
  const g: CanvasGraph = {
    nodes: [
      node("voice", "clone-voice", { url: "/api/files/u/me.wav" }),
      node("rec", "audio-input", { url: "/api/files/u/line.wav" }),
      node("text", "prompt", { text: "Hello there" }),
      node("clip", "video-input", { url: "/api/files/u/a.mp4" }),
      node("tts", "tts", { modelId: "oss-chatterbox" }),
      node("change", "voice-change", { modelId: "oss-chatterbox-vc" }),
      node("lips", "model", { modelId: "sync-lipsync-2-pro", op: "lipsync" }),
      node("tr", "translate", { modelId: "text-llm", mediaKind: "text" }),
      node("dub", "translate", { modelId: "elevenlabs-dubbing", mediaKind: "video" }),
      node("film", "concat", { modelId: "join-clips" }),
    ],
    edges: [],
  };

  it("a cloned voice goes only into Voice inputs; plain audio goes there too", () => {
    expect(outputType(g, g.nodes[0])).toBe("voice");
    expect(connectionError(g, { source: "voice", target: "tts", targetHandle: "voice" })).toBeNull();
    expect(connectionError(g, { source: "voice", target: "change", targetHandle: "voice" })).toBeNull();
    expect(connectionError(g, { source: "rec", target: "change", targetHandle: "voice" })).toBeNull();
    expect(connectionError(g, { source: "rec", target: "change", targetHandle: "audio" })).toBeNull();
    expect(connectionError(g, { source: "voice", target: "lips", targetHandle: "audio" })).toMatch(/Voice input/);
    expect(connectionError(g, { source: "voice", target: "change", targetHandle: "audio" })).toMatch(/Voice input/);
    // A recording (or a generated voice) can be the clone's sample.
    expect(connectionError(g, { source: "rec", target: "voice", targetHandle: "audio" })).toBeNull();
    expect(connectionError(g, { source: "text", target: "voice", targetHandle: "audio" })).toMatch(/Text can't go into Sample/);
  });

  it("Translate takes text or a video, by its mode; the concatenator takes clips only", () => {
    expect(inputPorts(g.nodes[7]).map((p) => [p.id, p.type])).toEqual([["prompt", "text"]]);
    expect(outputType(g, g.nodes[7])).toBe("text");
    expect(inputPorts(g.nodes[8]).map((p) => [p.id, p.type])).toEqual([["video", "video"]]);
    expect(outputType(g, g.nodes[8])).toBe("video");
    expect(connectionError(g, { source: "text", target: "tr", targetHandle: "prompt" })).toBeNull();
    expect(connectionError(g, { source: "clip", target: "tr", targetHandle: "prompt" })).toMatch(/Video can't go into Text/);
    expect(connectionError(g, { source: "clip", target: "dub", targetHandle: "video" })).toBeNull();
    expect(connectionError(g, { source: "clip", target: "film", targetHandle: "videos" })).toBeNull();
    expect(connectionError(g, { source: "rec", target: "film", targetHandle: "videos" })).toMatch(/Audio can't go into Clips/);
    expect(outputType(g, g.nodes[9])).toBe("video");
  });

  it("the concatenator refuses a 51st clip", () => {
    const many: CanvasGraph = { nodes: [node("film", "concat", { modelId: "join-clips" })], edges: [] };
    for (let i = 0; i < 51; i++) many.nodes.push(node(`c${i}`, "video-input", { url: `/api/files/u/${i}.mp4` }, 0, i * 10));
    for (let i = 0; i < 50; i++) many.edges.push(edge(`c${i}`, "film", "videos"));
    expect(connectionError(many, { source: "c50", target: "film", targetHandle: "videos" })).toMatch(/up to 50 clips/);
    // Re-drawing an edge that's already there is no 51st clip.
    expect(connectionError(many, { source: "c3", target: "film", targetHandle: "videos" })).toBeNull();
  });

  it("the palette offers the new nodes, and an open-only install keeps Translate (text) and the concatenator", () => {
    const ids = paletteItems("both").map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["voice-change", "clone-voice", "translate", "concat"]));
    const open = paletteItems("open");
    for (const id of ["voice-change", "clone-voice", "translate", "concat"]) expect(open.find((p) => p.id === id)!.disabled, id).toBeUndefined();
  });
});

describe("plans for the new nodes", () => {
  it("Change voice: ElevenLabs re-voices in a preset voice; Chatterbox in the connected one, on both engines", () => {
    const cloud: CanvasGraph = {
      nodes: [node("rec", "audio-input", { url: "/api/files/u/line.wav" }), node("change", "voice-change", { modelId: "elevenlabs-voice-changer", params: { voice: "JBFqnCBsd6RMkjVDRZzb" } })],
      edges: [edge("rec", "change", "audio")],
    };
    const d = describeNode(cloud, cloud.nodes[1], { engineMode: "cloud" });
    expect(d.error).toBeUndefined();
    expect(d.request).toMatchObject({ modelId: "elevenlabs-voice-changer", op: "voice-change", inputs: { audio: "/api/files/u/line.wav" }, params: { voice: "JBFqnCBsd6RMkjVDRZzb" } });
    expect(d.costUsd).toBeGreaterThan(0);

    // A clone connected to a model with preset voices only: say which models clone.
    cloud.nodes.push(node("me", "clone-voice", { url: "/api/files/u/me.wav" }));
    cloud.edges.push(edge("me", "change", "voice"));
    expect(describeNode(cloud, cloud.nodes[1], { engineMode: "cloud" }).error).toMatch(/preset voices — pick Chatterbox Voice Conversion \(hosted\)/);
    cloud.nodes[1].data.modelId = "chatterbox-vc-cloud";
    expect(describeNode(cloud, cloud.nodes[1], { engineMode: "cloud" }).request).toMatchObject({ modelId: "chatterbox-vc-cloud", inputs: { audio: "/api/files/u/line.wav", voiceAudio: "/api/files/u/me.wav" } });

    const open = convertEngine(cloud, "open").graph;
    const o = describeNode(open, open.nodes[1], { engineMode: "open" });
    expect(o.request).toMatchObject({ modelId: "oss-chatterbox-vc", op: "voice-change", inputs: { audio: "/api/files/u/line.wav", voiceAudio: "/api/files/u/me.wav" } });
    expect(o.costUsd).toBe(0);
  });

  it("Clone voice passes a generated sample on: the speech waits for it", () => {
    const g: CanvasGraph = {
      nodes: [
        node("line", "prompt", { text: "Say this in my voice" }, 0, 0),
        node("first", "tts", { modelId: "elevenlabs-v4", prompt: "A sample" }, 0, 300),
        node("me", "clone-voice", {}, 300, 300),
        node("speak", "tts", { modelId: "chatterbox-cloud" }, 600, 0),
      ],
      edges: [edge("first", "me", "audio"), edge("me", "speak", "voice"), edge("line", "speak", "prompt")],
    };
    const plan = planCanvas(g, { engineMode: "cloud" });
    expect(plan.errors).toEqual([]);
    expect(plan.steps.map((s) => [s.nodeId, s.deps])).toEqual([
      ["first", []],
      ["speak", ["first"]],
    ]);
    expect(plan.steps[1].request.chain).toEqual([{ slot: "voiceAudio" }]);
    // Nothing wired in and no file: the clone asks for a sample.
    g.edges = g.edges.filter((e) => e.source !== "first");
    expect(planCanvas(g, { engineMode: "cloud" }).errors[0].message).toMatch(/^Add a voice sample to “Clone voice”/);
  });

  it("Translate: text through the LLM on both engines, a video through a cloud dub", () => {
    const g: CanvasGraph = {
      nodes: [node("t", "prompt", { text: "Good morning" }), node("tr", "translate", { modelId: "text-llm", mediaKind: "text" })],
      edges: [edge("t", "tr", "prompt")],
    };
    expect(describeNode(g, g.nodes[1]).error).toBe("Pick a language to translate into");
    g.nodes[1].data.params = { targetLanguage: "Spanish" };
    expect(describeNode(g, g.nodes[1]).request).toMatchObject({ modelId: "text-llm", op: "translate", prompt: "Good morning", params: { targetLanguage: "Spanish" } });
    const open = convertEngine(g, "open").graph;
    expect(describeNode(open, open.nodes[1], { engineMode: "open" }).request).toMatchObject({ modelId: "oss-text-llm", op: "translate" });

    const v: CanvasGraph = {
      nodes: [node("clip", "video-input", { url: "/api/files/u/talk.mp4" }), node("dub", "translate", { modelId: "elevenlabs-dubbing", mediaKind: "video", params: { targetLanguage: "es" } })],
      edges: [edge("clip", "dub", "video")],
    };
    expect(describeNode(v, v.nodes[1], { engineMode: "cloud" }).request).toMatchObject({ modelId: "elevenlabs-dubbing", op: "dub", inputs: { video: "/api/files/u/talk.mp4" }, params: { targetLanguage: "es" } });
    // No open dub model: the node says where the open engine dubs.
    const { graph: openV, missing } = convertEngine(v, "open");
    expect(missing).toEqual(["dub"]);
    expect(describeNode(openV, { ...openV.nodes[1], data: { mediaKind: "video" } }, { engineMode: "open" }).error).toBe(OPEN_DUB_HINT);
    expect(describeNode(openV, { ...openV.nodes[1], data: { mediaKind: "video" } }, { engineMode: "both" }).error).toBe("Pick a model");
  });

  const clips = (engine: "cloud" | "open"): CanvasGraph => ({
    nodes: [
      node("a", "video-input", { url: "/api/files/u/a.mp4" }, 0, 0),
      node("gen", "model", { modelId: engine === "cloud" ? "kling-2-5-turbo" : "oss-wan22-14b-fast", mediaKind: "video", prompt: "Waves" }, 0, 400),
      node("film", "concat", { modelId: engine === "cloud" ? "join-clips" : "oss-join-encoded", params: { aspectRatio: "9:16" }, clips: { a: { start: 1, end: 4, mute: true, audio: true } } }, 400, 200),
    ],
    edges: [edge("a", "film", "videos"), edge("gen", "film", "videos")],
  });

  it("Video concatenator, cloud: cut, frame and mute each clip, then join at 30 fps", () => {
    const g = clips("cloud");
    const d = describeNode(g, g.nodes[2], { engineMode: "cloud" });
    expect(d.error).toBeUndefined();
    expect(d.deps).toEqual(["gen"]);
    expect(d.steps!.map((s) => [s.key, s.request.modelId, s.request.op, s.from])).toEqual([
      ["trim:0", "trim-video", "trim", []],
      ["fit:0", "scale-video", "reframe", [{ step: "trim:0" }]],
      ["sound:0", "extract-soundtrack", "separate-audio", [{ step: "fit:0" }]],
      ["quiet:0", "ffmpeg-loudnorm", "level", [{ step: "sound:0" }]],
      ["mute:0", "merge-audio-video", "mux", [{ step: "fit:0" }, { step: "quiet:0" }]],
      ["fit:1", "scale-video", "reframe", [{ node: "gen" }]],
      ["join", "join-clips", "concat", [{ step: "mute:0" }, { step: "fit:1" }]],
    ]);
    const step = (k: string) => d.steps!.find((s) => s.key === k)!.request;
    expect(step("trim:0")).toMatchObject({ inputs: { video: "/api/files/u/a.mp4" }, params: { startTime: 1, endTime: 4 } });
    expect(step("fit:0")).toMatchObject({ params: { aspectRatio: "9:16", extra: CONCAT_SIZE["9:16"] }, chain: [{ slot: "video" }] });
    expect(step("quiet:0").params!.extra).toEqual(MUTE_LEVEL);
    expect(step("mute:0").chain).toEqual([{ slot: "video" }, { slot: "audio" }]);
    expect(step("join")).toMatchObject({ feature: "canvas", params: { extra: { target_fps: 30 } }, chain: [{ slot: "videos" }, { slot: "videos" }] });
    // The in-between jobs are helper steps (the Library hides them); the film is the node's request.
    expect(d.steps!.filter((s) => s.key !== "join").every((s) => s.request.feature === "canvas-step")).toBe(true);
    expect(d.request).toBe(step("join"));
    expect(d.costUsd).toBeGreaterThan(0);

    // A clip cut at its start with no end: the cloud cut needs both, so it asks (or uses the measured length).
    g.nodes[2].data.clips = { a: { start: 2 } };
    expect(describeNode(g, g.nodes[2]).error).toMatch(/Clip 1: set where it ends too/);
    g.nodes[2].data.clips = { a: { start: 2, length: 9 } };
    expect(describeNode(g, g.nodes[2]).steps![0].request.params).toMatchObject({ startTime: 2, endTime: 9 });
    g.nodes[2].data.clips = { a: { start: 5, end: 4 } };
    expect(describeNode(g, g.nodes[2]).error).toBe("Clip 1: the end has to come after the start");
  });

  it("Video concatenator, open: one fit pass per clip (cut, frame, 30 fps, sound or silence), one packet-copy join", () => {
    const g = clips("open");
    const d = describeNode(g, g.nodes[2], { engineMode: "open" });
    expect(d.error).toBeUndefined();
    expect(d.steps!.map((s) => [s.key, s.request.modelId, s.from])).toEqual([
      ["fit:0", "oss-fit-clip", []],
      ["fit:1", "oss-fit-clip", [{ node: "gen" }]],
      ["join", "oss-join-encoded", [{ step: "fit:0" }, { step: "fit:1" }]],
    ]);
    expect(d.steps![0].request).toMatchObject({ op: "trim", inputs: { video: "/api/files/u/a.mp4" }, params: { startTime: 1, endTime: 4, fps: 30, extra: { width: 720, height: 1280, mute: true } } });
    expect(d.steps![1].request.params).toEqual({ startTime: 0, fps: 30, extra: { width: 720, height: 1280 } });
    expect(d.costUsd).toBe(0);
    // The clips' order: picked in the node first, the rest top to bottom.
    expect(concatClips(g, { ...g.nodes[2], data: { ...g.nodes[2].data, order: ["gen"] } }).map((c) => c.nodeId)).toEqual(["gen", "a"]);
    // Switching engines keeps the frame and the cuts.
    const cloud = convertEngine(g, "cloud").graph.nodes[2].data;
    expect(cloud).toMatchObject({ modelId: "join-clips", params: { aspectRatio: "9:16" }, clips: { a: { start: 1, end: 4, mute: true } } });
  });

  it("Video concatenator, cloud: 30 clips fold into joins of at most 24", () => {
    const g: CanvasGraph = { nodes: [node("film", "concat", { modelId: "join-clips" }, 500, 0)], edges: [] };
    for (let i = 0; i < 30; i++) {
      g.nodes.push(node(`c${i}`, "video-input", { url: `/api/files/u/${i}.mp4` }, 0, i * 10));
      g.edges.push(edge(`c${i}`, "film", "videos"));
    }
    const d = describeNode(g, g.nodes[0]);
    const joins = d.steps!.filter((s) => s.request.op === "concat");
    expect(joins.map((s) => [s.key, s.from.length])).toEqual([
      ["join:0:0", 15],
      ["join:0:1", 15],
      ["join", 2],
    ]);
    expect(d.request!.modelId).toBe("join-clips");
  });

  it("a node made in steps is fresh by all its steps, and reused by its last generation", () => {
    const g = clips("open");
    const d = describeNode(g, g.nodes[2], { engineMode: "open" });
    const sig = nodeSignature(d.request!, ["g-1"], d.steps);
    expect(nodeSignature(d.request!, ["g-1"], d.steps)).toBe(sig);
    g.nodes[2].data.clips = { a: { start: 1, end: 4 } };
    const d2 = describeNode(g, g.nodes[2], { engineMode: "open" });
    // Unmuting changes the first clip's pass, not the last step's request.
    expect(d2.request).toEqual(d.request);
    expect(nodeSignature(d2.request!, ["g-1"], d2.steps)).not.toBe(sig);

    const gen = describeNode(g, g.nodes[1], { engineMode: "open" });
    const runs = { gen: { sig: nodeSignature(gen.request!, []), ids: ["g-1"], at: 1 }, film: { sig: nodeSignature(d2.request!, ["g-1"], d2.steps), ids: ["s1", "s2", "s3"], out: "s3", at: 2 } };
    expect(runOutput(runs.film)).toBe("s3");
    const plan = planCanvas(g, { engineMode: "open", runs, status: (id) => (id === "g-1" || id === "s3" ? "succeeded" : undefined) });
    expect(plan.steps).toEqual([]);
    expect(plan.reused.find((r) => r.nodeId === "film")).toEqual({ nodeId: "film", reason: "fresh", generationId: "s3" });
  });
});

describe("board annotations", () => {
  it("strokes keep their shape as fractions of their box, thinned, and the eraser finds them", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({ x: 100 + i * 0.5, y: 50 + Math.sin(i / 50) * 40 }));
    const s = board.penShape("s1", pts, "chart-2")!;
    expect(s.kind).toBe("pen");
    expect(s.points!.length).toBeLessThanOrEqual(board.BOARD_LIMITS.penPoints);
    expect(s.points![0]).toEqual([0, expect.closeTo(0.5, 1)]);
    expect(Math.max(...s.points!.map((p) => p[0]))).toBe(1);
    expect(board.shapeHit(s, { x: 100, y: 50 })).toBe(true);
    expect(board.shapeHit(s, { x: 300, y: 200 })).toBe(false);
    expect(board.penShape("dot", [{ x: 1, y: 1 }], "ink")).toBeNull();
    expect(board.strokePath([[0, 0], [0.5, 1], [1, 0]], 100, 50)).toBe("M0 0 Q50 50 75 25 L100 0");
  });

  it("an arrow keeps the way it was drawn; an ellipse is hit inside its curve only", () => {
    const a = board.dragShape("a", "arrow", { x: 200, y: 10 }, { x: 100, y: 110 }, "ink");
    expect(a).toMatchObject({ x: 100, y: 10, width: 100, height: 100, points: [[1, 0], [0, 1]] });
    expect(board.shapeHit(a, { x: 150, y: 60 })).toBe(true);
    expect(board.shapeHit(a, { x: 110, y: 20 })).toBe(false);
    const e = board.dragShape("e", "ellipse", { x: 0, y: 0 }, { x: 100, y: 100 }, "ink");
    expect(board.shapeHit(e, { x: 50, y: 50 })).toBe(true);
    expect(board.shapeHit(e, { x: 2, y: 2 }, 0)).toBe(false);
  });

  it("a group frames the selection and runs the nodes inside it, with what they need upstream", () => {
    const g: CanvasGraph = {
      nodes: [
        node("p", "prompt", { text: "A lighthouse" }, 0, 0),
        node("img", "model", { modelId: "nano-banana-pro", mediaKind: "image" }, 400, 0),
        node("vid", "model", { modelId: "kling-2-5-turbo", mediaKind: "video", op: "i2v", prompt: "Waves roll in" }, 800, 0),
        node("other", "model", { modelId: "nano-banana-pro", mediaKind: "image", prompt: "A boat" }, 400, 600),
      ],
      edges: [edge("p", "img", "prompt"), edge("img", "vid", "images")],
    };
    const grp = board.groupAround("g1", [{ x: 800, y: 0, width: 300, height: 400 }], "Animate", "chart-3")!;
    expect(grp).toMatchObject({ x: 800 - board.GROUP_PAD, y: -board.GROUP_PAD - board.GROUP_BAR, width: 300 + 2 * board.GROUP_PAD });
    g.groups = [grp];
    expect(board.groupMembers(g, grp).map((n) => n.id)).toEqual(["vid"]);
    const plan = planCanvas(g, { targets: board.groupTargets(g, "g1") });
    expect(plan.steps.map((s) => s.nodeId)).toEqual(["img", "vid"]);
    expect(board.groupTargets(g, "nope")).toEqual([]);
    const outer = { ...board.groupAround("g0", [{ x: 0, y: 0, width: 1200, height: 1200 }])!, id: "g0" };
    expect(board.innerGroups([outer, grp], outer).map((x) => x.id)).toEqual(["g1"]);
  });
});

describe("pages", () => {
  it("an older row's board reads as page 1; a page copy gets new ids everywhere", () => {
    const legacy = { nodes: [node("p", "prompt", { text: "x" })], edges: [], viewport: { x: 1, y: 2, zoom: 1 } };
    expect(board.readPages(legacy)).toEqual([{ id: "page-1", name: "Page 1", graph: legacy }]);
    expect(board.readPages({ pages: [{ id: "a", name: "A", graph: { nodes: [], edges: [] } }] })[0].id).toBe("a");

    const g: CanvasGraph = {
      nodes: [node("p", "prompt", { text: "x" }), node("m", "model", { modelId: "nano-banana-pro", pinned: true })],
      edges: [edge("p", "m", "prompt")],
      groups: [{ id: "g", title: "G", color: "ink", x: 0, y: 0, width: 10, height: 10 }],
      comments: [{ id: "c", x: 0, y: 0, author: "You", text: "hi", at: 1 }],
      shapes: [{ id: "s", kind: "rect", x: 0, y: 0, width: 10, height: 10, color: "ink" }],
    };
    let n = 0;
    const copy = board.copyPage({ id: "page-1", name: "Page 1", graph: g }, "page-2", "Page 2", (p) => `${p}-${++n}`);
    expect(copy.graph.nodes.map((x) => x.id)).not.toContain("p");
    expect(copy.graph.edges[0]).toMatchObject({ source: copy.graph.nodes[0].id, target: copy.graph.nodes[1].id });
    expect(copy.graph.nodes[1].data.pinned).toBeUndefined();
    expect([copy.graph.groups![0].id, copy.graph.comments![0].id, copy.graph.shapes![0].id]).not.toContain("g");
    expect(board.nextPageName([{ id: "1", name: "Page 1", graph: g }, copy])).toBe("Page 3");
    expect(cleanGraph(copy.graph).edges).toHaveLength(1);
  });

  it("store, reload and run each page of a canvas", async () => {
    let res = await list.POST(req("POST", { name: "Pages", graph: { nodes: [node("p", "prompt", { text: "A red fox" }), node("img", "model", { modelId: "nano-banana-pro" }, 400)], edges: [edge("p", "img", "prompt")] } }));
    const c = (await res.json()) as Canvas;
    expect(c.pages.map((p) => [p.id, p.name, p.graph.nodes.length])).toEqual([["page-1", "Page 1", 2]]);

    const second: CanvasGraph = {
      nodes: [node("p2", "prompt", { text: "A grey wolf" }), node("img2", "model", { modelId: "nano-banana-pro" }, 400), node("img", "note", { text: "same id as on page 1" })],
      edges: [edge("p2", "img2", "prompt")],
      groups: [{ id: "g", title: "Wolves", color: "chart-4", x: 300, y: -100, width: 500, height: 600 }],
      comments: [{ id: "c1", x: 10, y: 10, author: "You", text: "Try a husky too", at: Date.now(), replies: [{ id: "r1", author: "You", text: "Or a fox", at: Date.now() }] }],
      shapes: [{ id: "s1", kind: "pen", x: 0, y: 0, width: 50, height: 20, color: "chart-2", points: [[0, 0], [1, 1]] }],
      viewport: { x: 5, y: 6, zoom: 0.8 },
    };
    const pages = [c.pages[0], { id: "page-2", name: "Wolves", graph: second }];
    res = await one.PATCH(req("PATCH", { pages }), ctx(c.id));
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Canvas;
    expect(saved.editedAt).not.toBeNull();
    expect(saved.pages.map((p) => p.name)).toEqual(["Page 1", "Wolves"]);
    // A node id already used on page 1 can't be reused on page 2 (results are kept by node id).
    expect(saved.pages[1].graph.nodes.map((x) => x.id)).toEqual(["p2", "img2"]);
    expect(saved.pages[1].graph).toMatchObject({ groups: second.groups, comments: second.comments, shapes: second.shapes, viewport: second.viewport });
    // Reloaded as stored.
    const view = (await (await one.GET(req("GET"), ctx(c.id))).json()) as { canvas: Canvas };
    expect(view.canvas.pages[1].graph.comments![0].replies![0].text).toBe("Or a fox");
    const card = ((await (await list.GET()).json()) as { items: { id: string; pageCount: number; nodeCount: number }[] }).items.find((x) => x.id === c.id)!;
    expect(card).toMatchObject({ pageCount: 2, nodeCount: 4 });

    // Bad pages are refused, naming the page.
    res = await one.PATCH(req("PATCH", { pages: [{ id: "x", name: "Broken", graph: { nodes: [{ id: "n", type: "nope", position: { x: 0, y: 0 }, data: {} }], edges: [] } }] }), ctx(c.id));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/^Broken: /);
    expect((await one.PATCH(req("PATCH", { pages: [] }), ctx(c.id))).status).toBe(400);

    // Run page 2: only its nodes run; page 1 is left alone.
    res = await run.POST(req("POST", { page: "page-2" }), ctx(c.id));
    expect(res.status).toBe(201);
    const ran = (await res.json()) as { ran: string[]; items: Generation[]; canvas: Canvas };
    expect(ran.ran).toEqual(["img2"]);
    expect(ran.items[0].prompt).toBe("A grey wolf");
    expect(Object.keys(ran.canvas.runs)).toEqual(["img2"]);
    await settle(ran.items[0].id);

    // A graph sent with a run updates that page only.
    const edited = structuredClone(second);
    edited.nodes[0].data.text = "A white wolf";
    res = await run.POST(req("POST", { page: "page-2", graph: edited }), ctx(c.id));
    const again = (await res.json()) as { ran: string[]; canvas: Canvas };
    expect(again.ran).toEqual(["img2"]);
    expect(again.canvas.pages[0].graph.nodes[0].data.text).toBe("A red fox");
    expect(again.canvas.pages[1].graph.nodes[0].data.text).toBe("A white wolf");

    // A row stored before pages (one bare graph) still opens, as page 1.
    db().prepare("UPDATE canvases SET graph_json = ? WHERE id = ?").run(JSON.stringify({ nodes: [node("old", "prompt", { text: "old" })], edges: [] }), c.id);
    const old = (await (await one.GET(req("GET"), ctx(c.id))).json()) as { canvas: Canvas };
    expect(old.canvas.pages).toEqual([{ id: "page-1", name: "Page 1", graph: { nodes: [node("old", "prompt", { text: "old" })], edges: [] } }]);
    // …and a save of its first page by graph alone keeps working.
    res = await one.PATCH(req("PATCH", { graph: { nodes: [node("new", "prompt", { text: "new" })], edges: [] } }), ctx(c.id));
    expect(((await res.json()) as Canvas).pages[0].graph.nodes[0].id).toBe("new");
  }, 60_000);

  it("runs a group, and a concatenator as one pipeline whose film the node keeps", async () => {
    const graph: CanvasGraph = {
      nodes: [
        node("p", "prompt", { text: "Waves on rocks" }, 0, 0),
        node("shot", "model", { modelId: "kling-2-5-turbo", mediaKind: "video" }, 400, 0),
        node("clip", "video-input", { url: "/api/files/u/demo.mp4" }, 400, 500),
        node("film", "concat", { modelId: "join-clips", clips: { clip: { start: 0.5, end: 2, mute: true } } }, 800, 200),
        node("lonely", "model", { modelId: "nano-banana-pro", prompt: "A cat" }, 0, 1200),
      ],
      edges: [edge("p", "shot", "prompt"), edge("shot", "film", "videos"), edge("clip", "film", "videos")],
      groups: [{ id: "edit", title: "Edit", color: "chart-2", x: 760, y: 100, width: 400, height: 500 }],
    };
    // The demo provider reads the clip like a real one would.
    fs.mkdirSync(path.join(dir, "files", "u"), { recursive: true });
    fs.writeFileSync(path.join(dir, "files", "u", "demo.mp4"), Buffer.alloc(256));
    let res = await list.POST(req("POST", { name: "Group run", graph }));
    const c = (await res.json()) as Canvas;
    res = await run.POST(req("POST", { group: "edit" }), ctx(c.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ran: string[]; items: Generation[]; canvas: Canvas; errors: unknown[] };
    expect(body.errors).toEqual([]);
    // The group's node and what it needs; never the node outside it.
    expect(body.ran).toEqual(["shot", "film"]);
    const film = body.canvas.runs.film;
    const shotId = body.canvas.runs.shot.ids[0];
    expect(film.ids).toHaveLength(7);
    const out = gens.getGeneration(film.out!)!;
    expect(out).toMatchObject({ modelId: "join-clips", op: "concat", feature: "canvas" });
    expect(body.items.filter((g) => film.ids.includes(g.id) && g.id !== film.out).every((g) => g.feature === "canvas-step")).toBe(true);
    // The generated shot is framed after it's made: its fit step waits for it.
    const deps = (id: string) => (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null }).depends_on;
    expect(body.items.filter((g) => g.modelId === "scale-video").map((g) => deps(g.id))).toContain(shotId);

    const done = await settle(film.out!);
    expect(done.status, film.ids.map((i) => `${gens.getGeneration(i)!.modelId}: ${gens.getGeneration(i)!.status} ${gens.getGeneration(i)!.error ?? ""}`).join("\n")).toBe("succeeded");
    // Fresh now: running the group again starts nothing and reuses the film.
    res = await run.POST(req("POST", { group: "edit" }), ctx(c.id));
    const again = (await res.json()) as { ran: string[]; reused: { nodeId: string; generationId: string }[] };
    expect(again.ran).toEqual([]);
    expect(again.reused.find((r) => r.nodeId === "film")!.generationId).toBe(film.out);

    // An empty group says so.
    res = await run.POST(req("POST", { group: "nope" }), ctx(c.id));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("This group has no nodes in it yet");
  }, 90_000);
});
