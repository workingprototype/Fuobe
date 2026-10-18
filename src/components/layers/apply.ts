"use client";

import {
  addNodes,
  addRevision,
  getNode,
  nodesFromOutputs,
  placeOutput,
  reframeDoc,
  replaceNodes,
  tightenToAlpha,
  type Box,
  type LayerDoc,
  type LayerJob,
  type LayerNode,
  type LayerRevision,
  type MeasuredOutput,
} from "@/lib/layers";
import { alphaBox, loadImage, sizeOf } from "./render";

/**
 * What a finished tool job does to the document: decompositions and splits become layers (placed by
 * their boxes, or cropped to their alpha), edits become a new revision of their layer (or a new
 * layer on top for the whole image), a region edit becomes the Original / New pair, Expand grows the
 * canvas with the fill underneath.
 */

const NEW_LAYER_NAMES: Partial<Record<LayerJob["tool"], string>> = {
  regenerate: "Edited layer",
  "text-edit": "Text edit",
  "bg-remove": "Cut-out",
  upscale: "Upscaled",
  relight: "Relit",
  angles: "New angle",
};

export interface Applied {
  doc: LayerDoc;
  /** Toast text. */
  message: string;
  /** The layer to select afterwards. */
  select?: string;
}

async function measure(url: string) {
  const img = await loadImage(url);
  return { img, natural: sizeOf(img) };
}

/** Keep the frame's centre and width; take the height from the image's shape. */
function fitBox(frame: Box, natural: [number, number]): Box {
  const h = frame[2] * (natural[1] / natural[0]);
  return [frame[0], frame[1] + frame[3] / 2 - h / 2, frame[2], h];
}

function newNode(id: string, name: string, box: Box, src: string, natural: [number, number], label: string, at: number, crop: Box | null = null, prompt?: string): LayerNode {
  const rev: LayerRevision = { src, crop, natural, label, at, ...(prompt ? { prompt } : {}) };
  return { id, name: name.slice(0, 80), z: 0, x: box[0], y: box[1], w: box[2], h: box[3], rotation: 0, src, crop, natural, revisions: [rev], revision: 0 };
}

export async function applyJob(doc: LayerDoc, job: LayerJob, newId: () => string): Promise<Applied> {
  const outputs = (job.result?.outputs ?? []).filter((o) => o.kind === "image");
  if (!outputs.length) throw new Error("The model returned no image");
  const at = Date.now();
  const prompt = typeof job.settings?.prompt === "string" ? job.settings.prompt : undefined;

  if (job.tool === "decompose" || job.tool === "split") {
    const target = job.tool === "split" ? getNode(doc, job.nodeId) : undefined;
    const frame: Box = target ? [target.x, target.y, target.w, target.h] : job.frame;
    const measured = await Promise.all(outputs.map(async (o) => ({ o, ...(await measure(o.url)) })));
    // Seedream's pixel boxes are measured on its base layer (z 0).
    const base = measured.find((m) => m.o.meta?.z === 0) ?? measured[0];
    const placed: MeasuredOutput[] = [];
    for (const m of measured) {
      let p = placeOutput(frame, m.natural, m.o.meta ?? {}, base.natural);
      if (p.needsAlpha) {
        const t = tightenToAlpha(frame, m.natural, alphaBox(m.img));
        if (!t) continue; // an empty layer
        p = t;
      }
      placed.push({ url: m.o.url, meta: m.o.meta, natural: m.natural, placement: p });
    }
    if (!placed.length) throw new Error("No layers came back from the split");
    const nodes = nodesFromOutputs(placed, {
      id: newId,
      label: job.tool === "split" ? "Separated" : "Decomposed",
      at,
      ...(target ? { baseName: target.name, frame, rotation: target.rotation } : {}),
    });
    if (job.tool === "decompose") {
      return { doc: { ...doc, decomposed: true, nodes }, message: `Decomposed into ${nodes.length} layers` };
    }
    const next = target ? replaceNodes(doc, [target.id], nodes) : addNodes(doc, nodes);
    return { doc: next, message: `${target?.name ?? "Layer"} split into ${nodes.length} layers`, select: nodes[nodes.length - 1]?.id };
  }

  const out = outputs[outputs.length - 1];
  const { img, natural } = await measure(out.url);

  if (job.tool === "regional") {
    const original = typeof job.settings?.image === "string" ? job.settings.image : undefined;
    const rect = job.frame;
    const add: LayerNode[] = [];
    if (original) {
      const before = await measure(original).catch(() => null);
      if (before) add.push({ ...newNode(newId(), "Original", rect, original, before.natural, "Original", at), role: "original" });
    }
    const feather = typeof job.settings?.feather === "number" ? job.settings.feather : 12;
    const edited = { ...newNode(newId(), "New", rect, out.url, natural, "Regional edit", at, null, prompt), role: "new" as const, feather };
    add.push(edited);
    return { doc: addNodes(doc, add), message: "Region edited", select: edited.id };
  }

  if (job.tool === "expand") {
    const grown = reframeDoc(doc, job.frame);
    const fill = newNode(newId(), "Expanded fill", [0, 0, grown.width, grown.height], out.url, natural, "Expand", at);
    return { doc: addNodes(grown, [fill], 0), message: "Canvas expanded", select: fill.id };
  }

  if (job.tool === "generate-layer") {
    const alpha = alphaBox(img);
    const crop = alpha ?? null;
    const [cw, ch] = crop ? [crop[2], crop[3]] : natural;
    const k = Math.min((doc.width * 0.5) / cw, (doc.height * 0.5) / ch);
    const w = cw * k;
    const h = ch * k;
    const name = prompt ? prompt.split(/\s+/).slice(0, 4).join(" ") : "Generated layer";
    const n = newNode(newId(), name.charAt(0).toUpperCase() + name.slice(1), [(doc.width - w) / 2, (doc.height - h) / 2, w, h], out.url, natural, "Generated", at, crop, prompt);
    return { doc: addNodes(doc, [n]), message: "Layer added", select: n.id };
  }

  // Edits: a new revision of the layer, or a new layer over the whole picture.
  const node = getNode(doc, job.nodeId);
  if (node) {
    const next = addRevision(node, { src: out.url, crop: null, natural, label: job.label, at, ...(prompt ? { prompt } : {}) });
    return { doc: { ...doc, nodes: doc.nodes.map((n) => (n.id === node.id ? next : n)) }, message: `${node.name}: ${job.label.toLowerCase()} done`, select: node.id };
  }
  // A whole-image result covers the picture as it is now (the canvas may have been expanded or cropped meanwhile).
  const whole: Box = job.nodeId ? job.frame : [0, 0, doc.width, doc.height];
  const n = newNode(newId(), NEW_LAYER_NAMES[job.tool] ?? job.label, fitBox(whole, natural), out.url, natural, job.label, at, null, prompt);
  let next = addNodes(doc, [n]);
  if (job.tool === "bg-remove") {
    // A cut-out of the whole picture only shows once what was under it is hidden.
    next = { ...next, nodes: next.nodes.map((x) => (x.id === n.id ? x : { ...x, hidden: true })) };
    return { doc: next, message: "Background removed — the layers underneath are hidden", select: n.id };
  }
  return { doc: next, message: `${n.name} added on top`, select: n.id };
}
