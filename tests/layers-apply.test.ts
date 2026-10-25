import { describe, expect, it } from "vitest";
import { applyMeasured, idPool, imagesToMeasure, type MeasuredJob } from "@/components/layers/apply";
import { initialDoc, sourceBoxOf, updateNode, type Box, type LayerDoc, type LayerJob, type LayerNode } from "@/lib/layers";

// What a finished tool job does to the document (the pure half of the editor's apply step): every
// tool's branch, and laying a result out on a document that was edited while it landed.

const node = (id: string, z: number, extra: Partial<LayerNode> = {}): LayerNode => ({
  id,
  name: id,
  z,
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  rotation: 0,
  src: `/api/files/${id}.png`,
  natural: [100, 50],
  revisions: [{ src: `/api/files/${id}.png`, natural: [100, 50], label: "Original", at: 1 }],
  revision: 0,
  ...extra,
});

const doc = (nodes: LayerNode[], w = 400, h = 300, extra: Partial<LayerDoc> = {}): LayerDoc => ({ v: 1, width: w, height: h, source: "/api/files/src.png", decomposed: true, nodes, ...extra });

const job = (tool: LayerJob["tool"], extra: Partial<LayerJob> = {}): LayerJob => ({
  id: "j1",
  tool,
  label: "Upscale",
  frame: [0, 0, 400, 300],
  generationIds: ["g1"],
  state: "pending",
  createdAt: 1,
  result: { status: "succeeded", progress: 1, message: null, error: null, provider: "mock", outputs: [{ url: "/api/files/out.png", kind: "image" }] },
  ...extra,
});

let n = 0;
const opts = () => ({ newId: () => `n${++n}`, at: 5 });
const one = (url: string, natural: [number, number], extra: Partial<MeasuredJob["outputs"][number]> = {}): MeasuredJob => ({ outputs: [{ url, natural, ...extra }] });
const ids = (d: LayerDoc) => [...d.nodes].sort((a, b) => a.z - b.z).map((x) => x.id);

describe("laying out a decomposition", () => {
  it("crops full-canvas layers to their alpha and leaves empty ones out (Qwen)", () => {
    const d = initialDoc("/api/files/src.png", 400, 300, 1);
    const m: MeasuredJob = {
      outputs: [
        { url: "/api/files/bg.png", natural: [800, 600], alpha: [0, 0, 800, 600], meta: { name: "Background", z: 0 } },
        { url: "/api/files/subject.png", natural: [800, 600], alpha: [200, 100, 400, 300], meta: { name: "Subject", z: 1 } },
        { url: "/api/files/empty.png", natural: [800, 600], alpha: null, meta: { z: 2 } },
      ],
    };
    const r = applyMeasured(d, job("decompose", { label: "Layer decomposition" }), m, opts());
    expect(r.doc.decomposed).toBe(true);
    expect(r.doc.nodes.map((x) => x.name)).toEqual(["Background", "Subject"]);
    expect(r.doc.nodes[1]).toMatchObject({ x: 100, y: 50, w: 200, h: 150, crop: [200, 100, 400, 300], natural: [800, 600] });
    expect(r.message).toBe("Decomposed into 2 layers");
  });

  it("places Seedream's cut layers by their boxes in the base layer's pixels", () => {
    const d = initialDoc("/api/files/src.png", 400, 300, 1);
    const m: MeasuredJob = {
      outputs: [
        { url: "/api/files/base.png", natural: [800, 600], alpha: [0, 0, 800, 600], meta: { z: 0, bbox: [0, 0, 800, 600] } },
        { url: "/api/files/cup.png", natural: [200, 100], alpha: [0, 0, 200, 100], meta: { z: 1, name: "Cup", bbox: [400, 300, 200, 100] } },
      ],
    };
    const r = applyMeasured(d, job("decompose"), m, opts());
    expect(r.doc.nodes[1]).toMatchObject({ name: "Cup", x: 200, y: 150, w: 100, h: 50, crop: null });
  });

  it("splits a layer in its place, inside where the layer is now", () => {
    const d = doc([node("bg", 0, { w: 400, h: 300 }), node("subject", 1, { x: 100, y: 100, w: 200, h: 100 }), node("text", 2)]);
    const m: MeasuredJob = {
      outputs: [
        { url: "/api/files/p1.png", natural: [200, 100], alpha: [0, 0, 100, 100] },
        { url: "/api/files/p2.png", natural: [200, 100], alpha: [100, 0, 100, 100], meta: { name: "Guitar" } },
      ],
    };
    // The job started when the layer sat at 0,0; it was moved since.
    const r = applyMeasured(d, job("split", { nodeId: "subject", frame: [0, 0, 200, 100], label: "Separating subject" }), m, opts());
    expect(r.doc.nodes.map((x) => [x.name, x.z])).toEqual([
      ["bg", 0],
      ["subject · part 1", 1],
      ["Guitar", 2],
      ["text", 3],
    ]);
    expect(r.doc.nodes[1]).toMatchObject({ x: 100, y: 100, w: 100, h: 100 });
    expect(r.doc.nodes[2]).toMatchObject({ x: 200, y: 100, w: 100, h: 100 });
    expect(r.select).toBe(r.doc.nodes[2].id);
  });

  it("counts separating the original picture as its decomposition", () => {
    const d = initialDoc("/api/files/src.png", 400, 300, 1);
    const m = one("/api/files/p.png", [400, 300], { alpha: [0, 0, 200, 300] });
    const own = applyMeasured(d, job("split", { nodeId: "original", settings: { image: "/api/files/src.png" } }), m, opts());
    expect(own.doc.decomposed).toBe(true);
    // A render of an edited layer is another picture: no decomposition yet.
    const other = applyMeasured(d, job("split", { nodeId: "original", settings: { image: "/api/files/render.png" } }), m, opts());
    expect(other.doc.decomposed).toBe(false);
  });

  it("refuses a result without images", () => {
    expect(() => applyMeasured(initialDoc("/api/files/src.png", 4, 3), job("decompose"), { outputs: [] }, opts())).toThrow(/no image/);
    const blank: MeasuredJob = { outputs: [{ url: "/api/files/e.png", natural: [4, 3], alpha: null }] };
    expect(() => applyMeasured(initialDoc("/api/files/src.png", 4, 3), job("decompose"), blank, opts())).toThrow(/No layers came back/);
  });
});

describe("laying out the other tools", () => {
  it("adds a regional edit as the Original / New pair with its feather", () => {
    const d = doc([node("bg", 0, { w: 400, h: 300 })]);
    const rect: Box = [50, 60, 120, 80];
    const m: MeasuredJob = { ...one("/api/files/new.png", [240, 160]), original: { url: "/api/files/region.png", natural: [120, 80] } };
    const r = applyMeasured(d, job("regional", { frame: rect, settings: { feather: 7, prompt: "add a hat", image: "/api/files/region.png" } }), m, opts());
    const [, orig, edited] = r.doc.nodes;
    expect(orig).toMatchObject({ name: "Original", role: "original", x: 50, y: 60, w: 120, h: 80, src: "/api/files/region.png" });
    expect(edited).toMatchObject({ name: "New", role: "new", feather: 7, src: "/api/files/new.png", natural: [240, 160] });
    expect(edited.revisions[0].prompt).toBe("add a hat");
    // The region as it was didn't load: just the new one.
    const lone = applyMeasured(d, job("regional", { frame: rect }), { ...one("/api/files/new.png", [240, 160]), original: null }, opts());
    expect(lone.doc.nodes.map((x) => x.role)).toEqual([undefined, "new"]);
  });

  it("expands the canvas with the fill underneath, and moves where the original sits", () => {
    const d = { ...initialDoc("/api/files/src.png", 400, 300, 1) };
    const r = applyMeasured(d, job("expand", { frame: [-100, 0, 600, 300] }), one("/api/files/fill.png", [1200, 600]), opts());
    expect(r.doc).toMatchObject({ width: 600, height: 300 });
    expect(r.doc.nodes[0]).toMatchObject({ name: "Expanded fill", x: 0, y: 0, w: 600, h: 300, z: 0 });
    expect(r.doc.nodes[1]).toMatchObject({ name: "Original image", x: 100, z: 1 });
    expect(sourceBoxOf(r.doc)).toEqual([100, 0, 400, 300]);
  });

  it("places a generated layer in the middle, cropped to its alpha", () => {
    const d = doc([node("bg", 0, { w: 400, h: 300 })]);
    const r = applyMeasured(d, job("generate-layer", { settings: { prompt: "a red paper lantern with a gold tassel" } }), one("/api/files/lantern.png", [1024, 1024], { alpha: [256, 0, 512, 1024] }), opts());
    const lantern = r.doc.nodes[1];
    expect(lantern).toMatchObject({ name: "A red paper lantern", crop: [256, 0, 512, 1024], h: 150, w: 75, x: 162.5, y: 75 });
    expect(r.select).toBe(lantern.id);
  });

  it("makes an edit a new revision of its layer", () => {
    const d = doc([node("bg", 0), node("subject", 1, { x: 10, y: 10 })]);
    const r = applyMeasured(d, job("upscale", { nodeId: "subject", frame: [10, 10, 100, 50] }), one("/api/files/up.png", [400, 200]), opts());
    const s = r.doc.nodes[1];
    expect(s).toMatchObject({ src: "/api/files/up.png", natural: [400, 200], revision: 1, x: 10, y: 10, w: 100, h: 50 });
    expect(s.revisions.map((x) => x.label)).toEqual(["Original", "Upscale"]);
    expect(r.message).toBe("subject: upscale done");
  });

  it("puts the result where the layer was when it was deleted meanwhile", () => {
    const d = doc([node("bg", 0)]);
    const r = applyMeasured(d, job("relight", { nodeId: "gone", frame: [20, 30, 100, 50], label: "Relight" }), one("/api/files/lit.png", [200, 100]), opts());
    expect(r.doc.nodes[1]).toMatchObject({ name: "Relit", x: 20, y: 30, w: 100, h: 50 });
  });

  it("covers the picture as it is now with a whole-image result; a cut-out hides what's under it", () => {
    const d = doc([node("bg", 0, { w: 400, h: 300 }), node("subject", 1)], 400, 300);
    const up = applyMeasured(d, job("upscale"), one("/api/files/up.png", [1600, 1200]), opts());
    expect(up.doc.nodes[2]).toMatchObject({ name: "Upscaled", x: 0, y: 0, w: 400, h: 300 });
    expect(up.doc.nodes.some((x) => x.hidden)).toBe(false);
    const cut = applyMeasured(d, job("bg-remove", { label: "Remove background" }), one("/api/files/cut.png", [400, 300]), opts());
    expect(cut.doc.nodes.map((x) => [x.name, !!x.hidden])).toEqual([
      ["bg", true],
      ["subject", true],
      ["Cut-out", false],
    ]);
  });

  it("lays Inpaint and Enhancer results out like the other edits", () => {
    const d = doc([node("bg", 0, { w: 400, h: 300 }), node("face", 1, { x: 40, y: 20 })], 400, 300);
    // On a layer: its next revision, the prompt kept with it.
    const enh = applyMeasured(d, job("enhance", { nodeId: "face", frame: [40, 20, 100, 50], label: "Skin" }), one("/api/files/skin.png", [200, 100]), opts());
    expect(enh.doc.nodes[1]).toMatchObject({ src: "/api/files/skin.png", revision: 1, x: 40, y: 20, w: 100, h: 50 });
    expect(enh.message).toBe("face: skin done");
    // On the whole picture: a new layer on top, called what it is.
    const ip = applyMeasured(d, job("inpaint", { label: "Inpaint", settings: { prompt: "a vase" } }), one("/api/files/ip.png", [400, 300]), opts());
    expect(ip.doc.nodes[2]).toMatchObject({ name: "Inpainted", x: 0, y: 0, w: 400, h: 300 });
    expect(ip.doc.nodes[2].revisions[0].prompt).toBe("a vase");
    expect(imagesToMeasure(job("inpaint"))).toEqual([{ url: "/api/files/out.png", alpha: false }]);
  });
});

describe("a result landing on a document edited meanwhile", () => {
  it("keeps the edit and the result, with the same new layer ids", () => {
    const before = doc([node("bg", 0, { w: 400, h: 300 }), node("subject", 1, { x: 10, y: 10 }), node("prop", 2, { x: 77 })]);
    const j = job("split", { nodeId: "subject", frame: [10, 10, 100, 50], label: "Separating subject" });
    const m: MeasuredJob = {
      outputs: [
        { url: "/api/files/p1.png", natural: [100, 50], alpha: [0, 0, 50, 50] },
        { url: "/api/files/p2.png", natural: [100, 50], alpha: [50, 0, 50, 50] },
      ],
    };
    const pool = idPool((() => {
      let k = 0;
      return () => `id${++k}`;
    })());
    // Laid out for the version on the document as it was...
    const saved = applyMeasured(before, j, m, { newId: pool(), at: 9 });
    // ...while the prop was nudged 40 px and the subject moved.
    const edited = updateNode(updateNode(before, "prop", { x: 117 }), "subject", { x: 200 });
    const rebased = applyMeasured(edited, j, m, { newId: pool(), at: 9 });
    expect(rebased.doc.nodes.find((x) => x.id === "prop")?.x).toBe(117);
    expect(ids(rebased.doc)).toEqual(ids(saved.doc));
    expect(ids(rebased.doc)).toEqual(["bg", "id1", "id2", "prop"]);
    // The parts land where the subject is now.
    expect(rebased.doc.nodes.find((x) => x.id === "id1")).toMatchObject({ x: 200, y: 10, w: 50, h: 50 });
    expect(saved.doc.nodes.find((x) => x.id === "id1")).toMatchObject({ x: 10 });
  });

  it("adds a revision on top of edits to the same layer", () => {
    const before = doc([node("bg", 0), node("subject", 1)]);
    const edited = updateNode(before, "subject", { opacity: 0.5, name: "Hero" });
    const r = applyMeasured(edited, job("relight", { nodeId: "subject", label: "Relight" }), one("/api/files/lit.png", [100, 50]), opts());
    expect(r.doc.nodes[1]).toMatchObject({ name: "Hero", opacity: 0.5, src: "/api/files/lit.png", revision: 1 });
  });
});

describe("measuring", () => {
  it("measures every layer of a decomposition (with alpha) and only the last image otherwise", () => {
    const outputs = [
      { url: "/a.png", kind: "image" },
      { url: "/b.json", kind: "text" },
      { url: "/c.png", kind: "image" },
    ];
    const r = (tool: LayerJob["tool"]) => imagesToMeasure(job(tool, { result: { status: "succeeded", progress: 1, message: null, error: null, provider: "mock", outputs } }));
    expect(r("decompose")).toEqual([
      { url: "/a.png", alpha: true },
      { url: "/c.png", alpha: true },
    ]);
    expect(r("upscale")).toEqual([{ url: "/c.png", alpha: false }]);
    expect(r("generate-layer")).toEqual([{ url: "/c.png", alpha: true }]);
  });

  it("hands out the same ids to every layout of one result", () => {
    let k = 0;
    const pool = idPool(() => `x${++k}`);
    const a = pool();
    const b = pool();
    expect([a(), a(), a()]).toEqual(["x1", "x2", "x3"]);
    expect([b(), b(), b(), b()]).toEqual(["x1", "x2", "x3", "x4"]);
  });
});
