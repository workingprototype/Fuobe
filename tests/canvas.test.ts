import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import {
  CANVAS_TEMPLATES,
  cleanGraph,
  connectionError,
  convertEngine,
  describeNode,
  effectiveOp,
  graphEngine,
  inputPorts,
  isGenerator,
  nodeSignature,
  outputType,
  paletteItems,
  planCanvas,
  singleInput,
  topoOrder,
  withPlaceholders,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasNode,
  type CanvasRuns,
} from "@/lib/catalog/canvas";
import type { GenerationStatus } from "@/lib/catalog/types";

const node = (id: string, type: CanvasNode["type"], x: number, y: number, data: CanvasNode["data"] = {}): CanvasNode => ({ id, type, position: { x, y }, data });
const edge = (source: string, target: string, targetHandle = "in"): CanvasEdge => ({ id: `${source}>${target}:${targetHandle}`, source, sourceHandle: "out", target, targetHandle });

/** Text prompt → image model → video model → output. */
function threeNodes(): CanvasGraph {
  return {
    nodes: [
      node("p", "prompt", 0, 0, { text: "A red fox in fresh snow" }),
      node("img", "model", 300, 0, { modelId: "nano-banana-pro", params: { aspectRatio: "16:9" } }),
      node("vid", "model", 600, 0, { modelId: "kling-2-5-turbo", op: "i2v", prompt: "It looks up at the camera", params: { duration: 5 } }),
      node("out", "output", 900, 0),
    ],
    edges: [edge("p", "img", "prompt"), edge("img", "vid", "images"), edge("vid", "out")],
  };
}

const statuses = (m: Record<string, GenerationStatus>) => (id: string) => m[id];

describe("canvas graph → plan", () => {
  it("orders steps topologically and maps edges to chain slots", () => {
    const plan = planCanvas(threeNodes());
    expect(plan.errors).toEqual([]);
    expect(plan.order).toEqual(["img", "vid"]);
    expect(plan.steps.map((s) => [s.nodeId, s.reason])).toEqual([
      ["img", "new"],
      ["vid", "new"],
    ]);
    const [img, vid] = plan.steps;
    // A literal text node becomes the prompt; the model infers text-to-image.
    expect(img.request).toMatchObject({ feature: "canvas", modelId: "nano-banana-pro", prompt: "A red fox in fresh snow", params: { aspectRatio: "16:9" } });
    expect(img.request.chain).toBeUndefined();
    expect(img.deps).toEqual([]);
    // The image edge becomes a chained start frame.
    expect(vid.request).toMatchObject({ modelId: "kling-2-5-turbo", op: "i2v", prompt: "It looks up at the camera", chain: [{ slot: "images", position: "first" }] });
    expect(vid.deps).toEqual(["img"]);
    expect(plan.costUsd).toBeCloseTo(0.15 + 0.07 * 5);
  });

  it("works out the op and the output type from what's connected", () => {
    const g = threeNodes();
    expect(effectiveOp(g, g.nodes[1])).toBe("t2i");
    expect(outputType(g, g.nodes[1])).toBe("image");
    expect(outputType(g, g.nodes[2])).toBe("video");
    g.nodes.push(node("ref", "image-input", 0, 200, { url: "/api/files/uploads/ref.png" }));
    g.edges.push(edge("ref", "img", "images"));
    expect(effectiveOp(g, g.nodes[1])).toBe("edit");
    expect(planCanvas(g).steps[0].request.inputs).toEqual({ images: ["/api/files/uploads/ref.png"] });
  });

  it("keeps the board's top-to-bottom order for image lists that mix files and generated images", () => {
    const g: CanvasGraph = {
      nodes: [
        node("a", "model", 0, 0, { modelId: "nano-banana-pro", prompt: "a hat" }),
        node("file", "image-input", 0, 200, { url: "/api/files/u/face.png" }),
        node("b", "model", 0, 400, { modelId: "nano-banana-pro", prompt: "a scarf" }),
        node("edit", "model", 400, 200, { modelId: "nano-banana-pro", op: "edit", prompt: "Combine them" }),
      ],
      edges: [edge("b", "edit", "images"), edge("file", "edit", "images"), edge("a", "edit", "images")],
    };
    const step = planCanvas(g).steps.find((s) => s.nodeId === "edit")!;
    expect(step.deps).toEqual(["a", "b"]);
    expect(step.request.inputs?.images).toEqual(["/api/files/u/face.png"]);
    expect(step.request.chain).toEqual([
      { slot: "images", position: "first" },
      { slot: "images", position: "last" },
    ]);
    // Filled in the same way the server does: [a, file, b].
    expect(withPlaceholders(step.request).inputs?.images).toEqual(["/api/files/placeholder.png", "/api/files/u/face.png", "/api/files/placeholder.png"]);
  });

  it("maps clips, audio, voices and elements", () => {
    const g: CanvasGraph = {
      nodes: [
        node("c1", "model", 0, 0, { modelId: "kling-2-5-turbo", prompt: "shot one" }),
        node("c2", "video-input", 0, 200, { url: "/api/files/u/two.mp4" }),
        node("join", "join", 300, 100, { modelId: "join-clips" }),
        node("sample", "audio-input", 0, 400, { url: "/api/files/u/me.wav" }),
        node("script", "prompt", 0, 600, { text: "Hello there" }),
        node("tts", "tts", 300, 500, { modelId: "chatterbox-cloud" }),
        node("face", "image-input", 300, 700, { url: "/api/files/u/face.png" }),
        node("avatar", "model", 600, 600, { modelId: "kling-avatar-2", op: "avatar" }),
        node("maya", "element", 0, 900, { handle: "Maya", elementId: "e1" }),
        node("still", "model", 300, 900, { modelId: "nano-banana-pro", prompt: "On a rooftop at night" }),
      ],
      edges: [
        edge("c1", "join", "videos"),
        edge("c2", "join", "videos"),
        edge("sample", "tts", "voice"),
        edge("script", "tts", "prompt"),
        edge("face", "avatar", "images"),
        edge("tts", "avatar", "audio"),
        edge("maya", "still", "elements"),
      ],
    };
    const plan = planCanvas(g);
    expect(plan.errors).toEqual([]);
    const by = Object.fromEntries(plan.steps.map((s) => [s.nodeId, s]));
    expect(by.join.request).toMatchObject({ op: "concat", inputs: { videos: ["/api/files/u/two.mp4"] }, chain: [{ slot: "videos", position: "first" }] });
    expect(by.tts.request).toMatchObject({ op: "tts", prompt: "Hello there", inputs: { voiceAudio: "/api/files/u/me.wav" } });
    expect(by.avatar.request).toMatchObject({ op: "avatar", inputs: { images: ["/api/files/u/face.png"] }, chain: [{ slot: "audio" }] });
    expect(by.avatar.deps).toEqual(["tts"]);
    expect(by.still.request.prompt).toBe("On a rooftop at night\n\nWith @Maya.");
    // Tool order: join's clip and the voice come before the nodes that use them.
    expect(plan.order.indexOf("tts")).toBeLessThan(plan.order.indexOf("avatar"));
    expect(plan.order.indexOf("c1")).toBeLessThan(plan.order.indexOf("join"));
  });

  it("puts connected text where {text} is", () => {
    const g: CanvasGraph = {
      nodes: [node("s", "prompt", 0, 0, { text: "a paper boat in the rain" }), node("f", "model", 300, 0, { modelId: "nano-banana-pro", prompt: "Frame 1: {text}. Cinematic still." })],
      edges: [edge("s", "f", "prompt")],
    };
    expect(planCanvas(g).steps[0].request.prompt).toBe("Frame 1: a paper boat in the rain. Cinematic still.");
  });

  it("chains a generated text into the prompt slot", () => {
    // Placeholder handling is the same as the server's withChainInputs.
    expect(withPlaceholders({ feature: "canvas", modelId: "x", prompt: "Say: {text}", chain: [{ slot: "prompt" }] }).prompt).toBe("Say: Placeholder text from an earlier step");
    expect(withPlaceholders({ feature: "canvas", modelId: "x", prompt: "{text}", chain: [{ slot: "prompt" }] }).prompt).toBe("Placeholder text from an earlier step");
  });

  it.skipIf(!getModel("text-llm"))("uses a text model's output as the prompt of the next node", () => {
    const g: CanvasGraph = {
      nodes: [node("w", "model", 0, 0, { modelId: "text-llm", op: "write", prompt: "Write a one-line ad for a lemonade stand" }), node("img", "model", 300, 0, { modelId: "nano-banana-pro", prompt: "Poster:" })],
      edges: [edge("w", "img", "prompt")],
    };
    const step = planCanvas(g).steps.find((s) => s.nodeId === "img")!;
    expect(step.request).toMatchObject({ prompt: "Poster:\n\n{text}", chain: [{ slot: "prompt" }] });
    expect(step.deps).toEqual(["w"]);
  });

  it("reports validation errors on the node and blocks what depends on it", () => {
    const g = threeNodes();
    g.nodes[1].data.modelId = undefined;
    let plan = planCanvas(g);
    expect(plan.steps).toEqual([]);
    expect(plan.errors).toEqual([
      { nodeId: "img", message: "Pick a model" },
      { nodeId: "vid", message: "Waiting on “Model” — fix it first" },
    ]);

    // A video model with nothing connected to its start frame.
    plan = planCanvas({ nodes: [node("v", "model", 0, 0, { modelId: "kling-2-5-turbo", op: "i2v", prompt: "go" })], edges: [] });
    expect(plan.errors).toEqual([{ nodeId: "v", message: "Add a start frame" }]);

    // An empty upload node.
    plan = planCanvas({ nodes: [node("i", "image-input", 0, 0, { label: "Product photo" }), node("e", "model", 300, 0, { modelId: "nano-banana-pro", op: "edit", prompt: "x" })], edges: [edge("i", "e", "images")] });
    expect(plan.errors).toEqual([{ nodeId: "e", message: "Add an image to “Product photo”" }]);

    // The engine mode is enforced per node.
    plan = planCanvas(threeNodes(), { engineMode: "open" });
    expect(plan.errors[0]).toEqual({ nodeId: "img", message: "Nano Banana Pro is a paid cloud model, but this install is open source only — pick an open model" });
  });

  it("finds loops", () => {
    const g: CanvasGraph = {
      nodes: [node("a", "model", 0, 0, { modelId: "nano-banana-pro", op: "edit", prompt: "x" }), node("b", "model", 300, 0, { modelId: "nano-banana-pro", op: "edit", prompt: "y" }), node("c", "upscale", 600, 0, { modelId: "topaz-image" })],
      edges: [edge("a", "b", "images"), edge("b", "a", "images"), edge("b", "c", "images")],
    };
    expect(topoOrder(g)).toEqual({ order: [], cyclic: ["a", "b", "c"] });
    const plan = planCanvas(g);
    expect(plan.steps).toEqual([]);
    expect(plan.errors.map((e) => e.message)).toEqual([
      "This node is part of a loop — remove one of its connections",
      "This node is part of a loop — remove one of its connections",
      "This node comes after a loop — remove one of the loop's connections",
    ]);
    // The editor refuses the edge that would close a loop.
    expect(connectionError({ ...g, edges: [edge("a", "b", "images")] }, { source: "b", target: "a", sourceHandle: "out", targetHandle: "images" })).toBe("That would make a loop");
  });

  it("validates connections by type", () => {
    const g = threeNodes();
    g.nodes.push(node("clip", "video-input", 0, 300, { url: "/api/files/u/a.mp4" }));
    expect(connectionError(g, { source: "clip", target: "vid", sourceHandle: "out", targetHandle: "images" })).toBe("Video can't go into Start frame");
    expect(connectionError(g, { source: "p", target: "vid", sourceHandle: "out", targetHandle: "prompt" })).toBeNull();
    expect(connectionError(g, { source: "p", target: "vid", sourceHandle: "out", targetHandle: "audio" })).toBe("Kling 2.5 Turbo Pro has no audio input");
    expect(connectionError(g, { source: "out", target: "vid", sourceHandle: "out", targetHandle: "prompt" })).toBe("Output has no output");
    expect(connectionError(g, { source: "clip", target: "out", sourceHandle: "out", targetHandle: "in" })).toBeNull();
    expect(singleInput(g, "vid", "endImage")).toBe(true);
    expect(singleInput(g, "vid", "prompt")).toBe(false);
    // Kling 2.5 Turbo takes an end frame on its image-to-video route.
    expect(inputPorts(g.nodes[2]).map((p) => p.id)).toEqual(["prompt", "elements", "images", "endImage"]);
  });

  it("skips fresh nodes, re-runs changed, failed and forced ones", () => {
    const g = threeNodes();
    const first = planCanvas(g);
    const imgSig = nodeSignature(first.steps[0].request, []);
    const vidSig = nodeSignature(first.steps[1].request, ["gen-img"]);
    const runs: CanvasRuns = { img: { sig: imgSig, ids: ["gen-img"], at: 1 }, vid: { sig: vidSig, ids: ["gen-vid"], at: 2 } };
    const ok = statuses({ "gen-img": "succeeded", "gen-vid": "running" });

    let plan = planCanvas(g, { runs, status: ok });
    expect(plan.steps).toEqual([]);
    expect(plan.reused).toEqual([
      { nodeId: "img", reason: "fresh", generationId: "gen-img" },
      { nodeId: "vid", reason: "fresh", generationId: "gen-vid" },
    ]);

    // Run node with its upstream: the fresh image is reused, a forced video runs again.
    plan = planCanvas(g, { runs, status: ok, targets: ["vid"], force: true });
    expect(plan.steps.map((s) => [s.nodeId, s.reason])).toEqual([["vid", "forced"]]);

    // A changed prompt re-runs the image, and the video because its input changes.
    const changed = threeNodes();
    changed.nodes[0].data.text = "A grey wolf in fresh snow";
    plan = planCanvas(changed, { runs, status: ok });
    expect(plan.steps.map((s) => [s.nodeId, s.reason])).toEqual([
      ["img", "changed"],
      ["vid", "upstream"],
    ]);

    // Running only the image leaves the video alone.
    plan = planCanvas(changed, { runs, status: ok, targets: ["img"] });
    expect(plan.steps.map((s) => s.nodeId)).toEqual(["img"]);

    // A failed result runs again; a deleted generation counts as new.
    plan = planCanvas(g, { runs, status: statuses({ "gen-img": "succeeded", "gen-vid": "failed" }) });
    expect(plan.steps.map((s) => [s.nodeId, s.reason])).toEqual([["vid", "failed"]]);
    plan = planCanvas(g, { runs, status: statuses({ "gen-vid": "succeeded" }) });
    expect(plan.steps.map((s) => [s.nodeId, s.reason])).toEqual([
      ["img", "new"],
      ["vid", "upstream"],
    ]);

    // An Output node stands for what feeds it.
    plan = planCanvas(changed, { runs, status: ok, targets: ["out"] });
    expect(plan.steps.map((s) => s.nodeId)).toEqual(["img", "vid"]);
  });

  it("never re-runs a pinned node", () => {
    const g = threeNodes();
    g.nodes[1].data.pinned = true;
    g.nodes[0].data.text = "changed after pinning";
    const runs: CanvasRuns = { img: { sig: "old", ids: ["gen-img"], at: 1 } };
    let plan = planCanvas(g, { runs, status: statuses({ "gen-img": "succeeded" }), force: true });
    expect(plan.reused).toEqual([{ nodeId: "img", reason: "pinned", generationId: "gen-img" }]);
    expect(plan.steps.map((s) => [s.nodeId, s.reason, s.deps])).toEqual([["vid", "forced", ["img"]]]);
    plan = planCanvas(g, {});
    expect(plan.errors[0]).toEqual({ nodeId: "img", message: "Pinned, but there's no result to use yet — unpin it to run it" });
  });

  it("fans one prompt out to several models for a side-by-side compare", () => {
    const g = CANVAS_TEMPLATES.find((t) => t.id === "compare-image")!.build("cloud");
    const plan = planCanvas(g);
    expect(plan.errors).toEqual([]);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.every((s) => s.deps.length === 0 && s.request.prompt?.startsWith("Portrait of an elderly fisherman"))).toBe(true);
    expect(new Set(plan.steps.map((s) => s.request.modelId)).size).toBe(3);
  });
});

describe("canvas templates", () => {
  it.each(CANVAS_TEMPLATES.flatMap((t) => (["cloud", "open"] as const).map((e) => [t.id, e] as const)))("%s (%s) is a valid graph on that engine", (id, engine) => {
    const g = CANVAS_TEMPLATES.find((t) => t.id === id)!.build(engine);
    expect(cleanGraph(g).edges).toHaveLength(g.edges.length);
    for (const n of g.nodes.filter(isGenerator)) {
      const m = getModel(n.data.modelId!);
      expect(m, `${id}/${n.id}: ${n.data.modelId}`).toBeDefined();
      expect(m!.engine).toBe(engine);
    }
    expect(graphEngine(g)).toBe(engine);
    const plan = planCanvas(g, { engineMode: engine });
    // Only the empty upload nodes need the user.
    for (const e of plan.errors) expect(e.message).toMatch(/^(Add (an image|an audio clip) to|Waiting on)/);
    if (!plan.errors.length) expect(plan.steps.length).toBe(g.nodes.filter(isGenerator).length);
    if (engine === "open") expect(plan.costUsd).toBe(0);
  });

  it("all filled in, the avatar template plans voice clone → avatar", () => {
    const g = CANVAS_TEMPLATES.find((t) => t.id === "talking-avatar")!.build("open");
    g.nodes.find((n) => n.id === "portrait")!.data.url = "/api/files/u/face.png";
    g.nodes.find((n) => n.id === "sample")!.data.url = "/api/files/u/me.wav";
    const plan = planCanvas(g, { engineMode: "open" });
    expect(plan.errors).toEqual([]);
    expect(plan.steps.map((s) => [s.nodeId, s.request.modelId, s.deps])).toEqual([
      ["voice", "oss-chatterbox", []],
      ["avatar", "oss-infinitetalk", ["voice"]],
    ]);
  });

  it("switches a whole board to open-source models", () => {
    const g = CANVAS_TEMPLATES.find((t) => t.id === "script-film")!.build("cloud");
    const { graph, changed, missing } = convertEngine(g, "open");
    expect(changed).toBe(7);
    expect(missing).toEqual([]);
    expect(graphEngine(graph)).toBe("open");
    expect(graph.nodes.find((n) => n.id === "film")!.data.modelId).toBe("oss-join-clips");
    expect(graph.nodes.find((n) => n.id === "shot1")!.data).toMatchObject({ modelId: "oss-wan22-14b-fast", op: "i2v" });
    expect(planCanvas(graph, { engineMode: "open" }).errors).toEqual([]);
  });

  it("offers palette entries for every node type the catalog can run", () => {
    const ids = paletteItems().map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["prompt", "image-input", "video-input", "audio-input", "element", "model-image", "model-video", "join", "frame", "upscale", "bg-remove", "tts", "output"]));
    // Utilities pick a working model on each engine (or say there's none).
    const frame = node("f", "frame", 0, 0, {});
    expect(describeNode({ nodes: [frame], edges: [] }, frame).error).toBe("Pick a model");
  });
});
