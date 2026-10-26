import "server-only";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  BOARD_COLORS,
  BOARD_LIMITS,
  FIRST_PAGE_ID,
  groupTargets,
  pageContent,
  pageName,
  pageOf,
  readPages,
  withPageGraph,
  type CanvasPage,
} from "@/lib/catalog/canvas-board";
import {
  CANVAS_TEXT_MAX as TEXT_MAX,
  CONCAT_LIMITS,
  cleanGraph,
  concatClips,
  EMPTY_GRAPH,
  getTemplate,
  NODE_SPECS,
  nodeLabel,
  nodeMap,
  nodeSignature,
  outline,
  planCanvas,
  withCurrentElements,
  type Canvas,
  type CanvasGraph,
  type CanvasNodeType,
  type CanvasPlan,
  type CanvasRuns,
  type CanvasSummary,
} from "@/lib/catalog/canvas";
import type { Engine, Generation, MediaKind } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { db } from "./db";
import { listElements } from "./elements";
import { createGenerations, getGeneration } from "./generations";
import { engineMode } from "./settings";
import { absolutePath } from "./storage";

/**
 * Canvas boards (Higgsfield Canvas): the pages the user edits (each a graph, with its groups, comments and
 * drawings), plus the last run of each generator node. Running turns a page's graph into chained generations
 * (src/lib/catalog/canvas.ts plans it; createGenerations + dependsOn runs it, createPipeline for a node made in
 * several steps), so results survive restarts like any other job. graph_json holds {pages}; a row saved before
 * pages holds one graph, read as page 1 (readPages).
 */

interface Row {
  id: string;
  name: string;
  graph_json: string;
  runs_json: string;
  template_id: string | null;
  created_at: number;
  updated_at: number;
  edited_at: number | null;
}

const toCanvas = (r: Row): Canvas => ({
  id: r.id,
  name: r.name,
  pages: readPages(JSON.parse(r.graph_json)),
  runs: JSON.parse(r.runs_json) as CanvasRuns,
  templateId: r.template_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  editedAt: r.edited_at,
});

// ---------------------------------------------------------------------------
// Validation of graphs coming from the browser

const NODE_TYPES = [
  "prompt",
  "image-input",
  "video-input",
  "audio-input",
  "element",
  "model",
  "join",
  "frame",
  "upscale",
  "bg-remove",
  "tts",
  "voice-change",
  "clone-voice",
  "translate",
  "concat",
  "output",
  "note",
] as const satisfies readonly CanvasNodeType[];
const KINDS = ["image", "video", "audio", "text", "model3d"] as const satisfies readonly MediaKind[];

/** The settings a node may send (the same limits as POST /api/generations). */
const Params = z.object({
  aspectRatio: z.string().max(20).optional(),
  resolution: z.string().max(20).optional(),
  duration: z.number().positive().max(600).optional(),
  numOutputs: z.number().int().min(1).max(8).optional(),
  seed: z.number().int().optional(),
  generateAudio: z.boolean().optional(),
  voice: z.string().max(200).optional(),
  targetLanguage: z.string().max(80).optional(),
  sourceLanguage: z.string().max(80).optional(),
  extra: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean()])).optional(),
});

/** Free text is clamped, not refused: one over-long paste must never stop the whole board from saving. */
const clamped = (max: number) => z.string().transform((s) => s.slice(0, max));

/** Element handles are letters, digits, `_` and `-` (handleFor); anything else is dropped. */
const Handle = z
  .string()
  .max(200)
  .transform((h) => h.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 60) || undefined);

const NodeData = z.object({
  label: clamped(80).optional(),
  text: clamped(TEXT_MAX).optional(),
  // Media comes from Fuobe's own storage (uploads, the library, generated outputs).
  url: z.string().startsWith("/api/files/").max(2000).optional(),
  name: clamped(200).optional(),
  elementId: z.string().max(40).optional(),
  handle: Handle.optional(),
  preview: z.string().startsWith("/api/files/").max(2000).optional(),
  modelId: z.string().max(120).optional(),
  // A Fuobe Original (runs on both engines): the engine the node runs it on.
  engine: z.enum(["open", "cloud"]).optional(),
  op: z.string().max(40).optional(),
  prompt: clamped(TEXT_MAX).optional(),
  params: Params.optional(),
  pinned: z.boolean().optional(),
  mediaKind: z.enum(KINDS).optional(),
  // Video Concatenator: each clip's cut and sound (by source node id) and the clips' order.
  clips: z
    .record(
      z.string().max(80),
      z.object({
        start: z.number().min(0).max(36_000).optional(),
        end: z.number().min(0).max(36_000).optional(),
        mute: z.boolean().optional(),
        length: z.number().min(0).max(36_000).optional(),
        width: z.number().int().min(1).max(16_384).optional(),
        height: z.number().int().min(1).max(16_384).optional(),
        audio: z.boolean().optional(),
      }),
    )
    .optional(),
  order: z.array(z.string().max(80)).max(CONCAT_LIMITS.clips * 2).optional(),
});

const Num = z.number().finite();
const Color = z.enum(BOARD_COLORS);

const Group = z.object({
  id: z.string().min(1).max(80),
  title: clamped(BOARD_LIMITS.groupTitle),
  color: Color,
  x: Num,
  y: Num,
  width: Num.positive().max(40_000),
  height: Num.positive().max(40_000),
});

const Reply = z.object({ id: z.string().min(1).max(80), author: clamped(60), text: clamped(BOARD_LIMITS.commentText), at: Num });

const Comment = z.object({
  id: z.string().min(1).max(80),
  x: Num,
  y: Num,
  author: clamped(60),
  text: clamped(BOARD_LIMITS.commentText),
  at: Num,
  resolved: z.boolean().optional(),
  replies: z.array(Reply).max(BOARD_LIMITS.replies).optional(),
});

const Shape = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["rect", "ellipse", "arrow", "text", "pen"]),
  x: Num,
  y: Num,
  width: Num.positive().max(40_000),
  height: Num.positive().max(40_000),
  color: Color,
  text: clamped(BOARD_LIMITS.shapeText).optional(),
  points: z.array(z.tuple([z.number().min(-1).max(2), z.number().min(-1).max(2)])).max(BOARD_LIMITS.penPoints).optional(),
});

export const GraphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        type: z.enum(NODE_TYPES),
        position: z.object({ x: Num, y: Num }),
        data: NodeData,
        width: Num.positive().max(4000).optional(),
        height: Num.positive().max(4000).optional(),
      }),
    )
    .max(300),
  edges: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        source: z.string().min(1).max(80),
        target: z.string().min(1).max(80),
        sourceHandle: z.string().max(40).nullish(),
        targetHandle: z.string().max(40).nullish(),
      }),
    )
    .max(1200),
  viewport: z.object({ x: Num, y: Num, zoom: Num.positive().max(10) }).optional(),
  groups: z.array(Group).max(BOARD_LIMITS.groups).optional(),
  comments: z.array(Comment).max(BOARD_LIMITS.comments).optional(),
  shapes: z.array(Shape).max(BOARD_LIMITS.shapes).optional(),
});

export const PagesSchema = z
  .array(z.object({ id: z.string().min(1).max(40), name: clamped(60), graph: GraphSchema }))
  .min(1)
  .max(BOARD_LIMITS.pages);

/** Why a graph from the browser was refused, naming the node (the editor shows it in a toast). */
export function graphProblem(input: unknown): string {
  const parsed = GraphSchema.safeParse(input);
  const fallback = "That board couldn't be saved — reload the page";
  if (parsed.success) return fallback;
  const [list, index, ...rest] = parsed.error.issues[0]?.path ?? [];
  if (list === "nodes" && typeof index === "number") {
    const n = (input as { nodes?: { type?: string; data?: { label?: unknown } }[] }).nodes?.[index];
    const custom = typeof n?.data?.label === "string" && n.data.label.trim() ? n.data.label.trim().slice(0, 80) : undefined;
    const label = custom ?? NODE_SPECS[n?.type as CanvasNodeType]?.label ?? "A node";
    const field = rest.filter((p): p is string => typeof p === "string" && p !== "data").join(" ");
    return `“${label}” couldn't be saved${field ? ` (its ${field})` : ""}: change it or remove the node`;
  }
  if (list === "nodes") return "This board has too many nodes to save (300 at most)";
  if (list === "edges") return "This board has too many connections to save (1,200 at most)";
  if (list === "groups") return `This board has too many groups to save (${BOARD_LIMITS.groups} at most)`;
  if (list === "comments") return `This board has too many comments to save (${BOARD_LIMITS.comments} at most)`;
  if (list === "shapes") return `This board has too many drawings to save (${BOARD_LIMITS.shapes} at most) — erase a few`;
  return fallback;
}

/** Why pages from the browser were refused (the page and the node, when one is to blame). */
export function pagesProblem(input: unknown): string {
  if (!Array.isArray(input) || !input.length) return "A canvas needs at least one page";
  if (input.length > BOARD_LIMITS.pages) return `A canvas holds up to ${BOARD_LIMITS.pages} pages`;
  for (const [i, p] of input.entries()) {
    const g = (p as { graph?: unknown } | null)?.graph;
    if (!GraphSchema.safeParse(g).success) {
      const name = typeof (p as { name?: unknown })?.name === "string" ? (p as { name: string }).name : pageName(i);
      return `${name}: ${graphProblem(g)}`;
    }
  }
  return "Those pages couldn't be saved — reload the page";
}

/** A parsed graph, with duplicate node ids, dangling edges and edges into missing handles removed. */
export function parseGraph(input: unknown): CanvasGraph | null {
  const parsed = GraphSchema.safeParse(input);
  if (!parsed.success) return null;
  const g = parsed.data as CanvasGraph;
  const seen = new Set<string>();
  const nodes = g.nodes.filter((n) => !seen.has(n.id) && seen.add(n.id));
  return cleanGraph({ ...g, nodes });
}

/**
 * Parsed pages: page ids made unique, and a node id used on an earlier page dropped from later ones
 * (results are kept by node id, so two pages can't share one).
 */
export function parsePages(input: unknown): CanvasPage[] | null {
  const parsed = PagesSchema.safeParse(input);
  if (!parsed.success) return null;
  const ids = new Set<string>();
  const nodeIds = new Set<string>();
  return parsed.data.map((p, i) => {
    let id = p.id;
    for (let k = 2; ids.has(id); k++) id = `${p.id}-${k}`;
    ids.add(id);
    const g = p.graph as CanvasGraph;
    const nodes = g.nodes.filter((n) => !nodeIds.has(n.id) && nodeIds.add(n.id));
    return { id, name: p.name.trim() || pageName(i), graph: cleanGraph({ ...g, nodes }) };
  });
}

// ---------------------------------------------------------------------------
// CRUD

export function getCanvas(id: string): Canvas | null {
  const r = db().prepare("SELECT * FROM canvases WHERE id = ?").get(id) as Row | undefined;
  return r ? toCanvas(r) : null;
}

/** Generations in the Trash count as gone: never a card preview, never a fresh result to reuse. */
const NOT_TRASHED = "NOT EXISTS (SELECT 1 FROM generation_trash t WHERE t.generation_id = g.id)";

/** The newest finished image among the canvas's results (a video when it made no image). */
function previewOf(runs: CanvasRuns): CanvasSummary["preview"] {
  const ids = Object.values(runs)
    .sort((a, b) => b.at - a.at)
    .flatMap((r) => r.ids)
    .slice(0, 60);
  if (!ids.length) return null;
  const rows = db()
    .prepare(
      `SELECT g.outputs_json FROM generations g WHERE g.id IN (${ids.map(() => "?").join(",")}) AND g.status = 'succeeded' AND g.kind IN ('image','video') AND ${NOT_TRASHED} ORDER BY g.kind = 'image' DESC, g.completed_at DESC LIMIT 1`,
    )
    .all(...ids) as { outputs_json: string }[];
  const o = rows[0] ? (JSON.parse(rows[0].outputs_json) as { url: string; kind: MediaKind }[]).find((x) => x.kind === "image" || x.kind === "video") : undefined;
  return o ? { url: o.url, kind: o.kind } : null;
}

export function listCanvases(): CanvasSummary[] {
  const rows = db().prepare("SELECT * FROM canvases ORDER BY updated_at DESC LIMIT 200").all() as Row[];
  return rows.map((r) => {
    const c = toCanvas(r);
    return {
      id: c.id,
      name: c.name,
      nodeCount: c.pages.reduce((n, p) => n + p.graph.nodes.length, 0),
      pageCount: c.pages.length,
      templateId: c.templateId,
      preview: previewOf(c.runs),
      outline: outline(c.pages[0].graph),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      editedAt: c.editedAt,
    };
  });
}

export interface CreateCanvasInput {
  name?: string;
  graph?: CanvasGraph;
  pages?: CanvasPage[];
  /** Start from a template, in the cloud or the all-open-source variant. */
  templateId?: string;
  engine?: Engine;
}

export function createCanvas(input: CreateCanvasInput = {}): Canvas {
  const template = input.templateId ? getTemplate(input.templateId) : undefined;
  if (input.templateId && !template) throw new Error("That template doesn't exist");
  // A locked install only ever gets the variant it can run.
  const mode = engineMode();
  const engine: Engine = mode === "both" ? (input.engine ?? "cloud") : mode;
  const graph = template ? template.build(engine) : (input.graph ?? EMPTY_GRAPH);
  const pages = !template && input.pages?.length ? input.pages : [{ id: FIRST_PAGE_ID, name: pageName(0), graph: cleanGraph(graph) }];
  const now = Date.now();
  const row: Row = {
    id: nanoid(10),
    name: (input.name?.trim() || template?.name || "Untitled canvas").slice(0, 80),
    graph_json: JSON.stringify({ pages }),
    runs_json: "{}",
    template_id: template?.id ?? null,
    created_at: now,
    updated_at: now,
    edited_at: null,
  };
  db()
    .prepare(`INSERT INTO canvases (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  return toCanvas(row);
}

export interface CanvasPatch {
  name?: string;
  /** Every page, as the editor has them (page tabs added, renamed, reordered or removed). */
  pages?: CanvasPage[];
  /** One page's board: `page` (the first page when omitted, as before pages). */
  graph?: CanvasGraph;
  page?: string;
}

/** Save a new name, pages and/or one page's graph. Moving a viewport alone doesn't count as an edit. */
export function updateCanvas(id: string, patch: CanvasPatch): Canvas | null {
  const current = getCanvas(id);
  if (!current) return null;
  const now = Date.now();
  const name = patch.name?.trim() ? patch.name.trim().slice(0, 80) : current.name;
  let pages = current.pages;
  if (patch.pages?.length) pages = patch.pages.map((p) => ({ ...p, graph: cleanGraph(p.graph) }));
  if (patch.graph) pages = withPageGraph(pages, patch.page, cleanGraph(patch.graph));
  const edited = pageContent(pages) !== pageContent(current.pages) ? now : current.editedAt;
  db().prepare("UPDATE canvases SET name = ?, graph_json = ?, updated_at = ?, edited_at = ? WHERE id = ?").run(name, JSON.stringify({ pages }), now, edited, id);
  return getCanvas(id);
}

export function duplicateCanvas(id: string): Canvas | null {
  const c = getCanvas(id);
  if (!c) return null;
  const now = Date.now();
  const row: Row = {
    id: nanoid(10),
    name: `Copy of ${c.name}`.slice(0, 80),
    graph_json: JSON.stringify({ pages: c.pages }),
    // The copy shows the same results until it's run again.
    runs_json: JSON.stringify(c.runs),
    template_id: c.templateId,
    created_at: now,
    updated_at: now,
    edited_at: c.editedAt,
  };
  db()
    .prepare(`INSERT INTO canvases (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  return toCanvas(row);
}

/** Deletes the board; what it made stays in the library. */
export function deleteCanvas(id: string): boolean {
  return db().prepare("DELETE FROM canvases WHERE id = ?").run(id).changes > 0;
}

/** The canvas with the generations its nodes made (for status, progress and outputs). */
export function canvasView(id: string): { canvas: Canvas; generations: Generation[] } | null {
  const stored = getCanvas(id);
  if (!stored) return null;
  // Element nodes show (and mention) their element as it's called now, after a rename.
  const elements = listElements();
  const canvas = { ...stored, pages: stored.pages.map((p) => ({ ...p, graph: withCurrentElements(p.graph, elements) })) };
  const ids = [...new Set(Object.values(canvas.runs).flatMap((r) => r.ids))];
  // getGeneration also makes sure the runner is polling after a restart.
  const generations = ids.map((g) => getGeneration(g)).filter((g): g is Generation => !!g);
  return { canvas, generations };
}

// ---------------------------------------------------------------------------
// Run

export interface RunOptions {
  /** The page to run (the first one when omitted). */
  page?: string;
  /** Nodes to run with their upstream; omit for Run all (of the page). */
  targets?: string[];
  /** Run a group: its nodes and what they need. */
  group?: string;
  /** Re-run the targets even when their result is fresh. */
  force?: boolean;
  /** The page's board as the editor has it now (saved first, so an autosave in flight can't race the run). */
  graph?: CanvasGraph;
}

export interface RunResult {
  canvas: Canvas;
  /** Generations created, in run order. */
  items: Generation[];
  /** Node ids that started, in order. */
  ran: string[];
  reused: CanvasPlan["reused"];
  errors: CanvasPlan["errors"];
  costUsd: number;
}

/** A result's status; undefined once it's gone (deleted, or in the Trash), so its node runs again. */
function statusOf(id: string): Generation["status"] | undefined {
  return (db().prepare(`SELECT g.status FROM generations g WHERE g.id = ? AND ${NOT_TRASHED}`).get(id) as { status: Generation["status"] } | undefined)?.status;
}

/** A clip on the board that the concatenator refuses: a stored file over 512 MB. */
function oversizedClip(graph: CanvasGraph, nodeId: string): string | null {
  const nodes = nodeMap(graph);
  const n = nodes.get(nodeId);
  if (n?.type !== "concat") return null;
  for (const [i, c] of concatClips(graph, n).entries()) {
    const url = nodes.get(c.nodeId)?.data.url;
    if (!url?.startsWith("/api/files/")) continue;
    try {
      if (fs.statSync(absolutePath(decodeURIComponent(url.slice("/api/files/".length)))).size > CONCAT_LIMITS.maxBytes) return `Clip ${i + 1} is over 512 MB — trim or compress it first`;
    } catch {
      // Gone: the job says so.
    }
  }
  return null;
}

export function runCanvas(id: string, opts: RunOptions = {}): RunResult | null {
  let canvas = getCanvas(id);
  if (!canvas) return null;
  if (opts.graph) canvas = updateCanvas(id, { graph: opts.graph, page: opts.page })!;
  // An element renamed since the board was saved: its node mentions the new @handle.
  const graph = withCurrentElements(pageOf(canvas.pages, opts.page).graph, listElements());
  const targets = opts.group ? groupTargets(graph, opts.group) : opts.targets;
  if (opts.group && !targets?.length) return { canvas, items: [], ran: [], reused: [], errors: [{ nodeId: opts.group, message: "This group has no nodes in it yet" }], costUsd: 0 };
  const plan = planCanvas(graph, { targets, force: opts.force, runs: canvas.runs, status: statusOf, engineMode: engineMode() });
  const nodes = nodeMap(graph);
  const batchId = nanoid(10);
  const made = new Map<string, string>(plan.reused.map((r) => [r.nodeId, r.generationId]));
  const errors = [...plan.errors];
  const items: Generation[] = [];
  const ran: string[] = [];
  const runs: CanvasRuns = {};
  const n = plan.steps.length;
  plan.steps.forEach((step, i) => {
    const depIds = step.deps.map((d) => made.get(d));
    const missing = step.deps.find((d, k) => !depIds[k]);
    if (missing) {
      errors.push({ nodeId: step.nodeId, message: `Waiting on “${nodeLabel(nodes.get(missing)!)}”, which couldn't start` });
      return;
    }
    try {
      const sig = nodeSignature(step.request, depIds as string[], step.steps);
      if (step.steps) {
        const big = oversizedClip(graph, step.nodeId);
        if (big) throw new Error(big);
        // A node made in several steps: one pipeline, waiting on the upstream nodes' results like on its own steps.
        const existing = Object.fromEntries(step.deps.map((d, k) => [`node:${d}`, depIds[k] as string]));
        const pipe = createPipeline(
          step.steps.map((st) => ({
            key: st.key,
            request: { ...st.request, step: { label: st.request.step?.label ?? step.label, index: i, of: n } },
            after: st.from.map((f) => ("node" in f ? `node:${f.node}` : f.step)),
          })),
          { batchId, existing },
        );
        const out = pipe.byKey[step.steps[step.steps.length - 1].key];
        made.set(step.nodeId, out.id);
        runs[step.nodeId] = { sig, ids: pipe.items.map((g) => g.id), out: out.id, at: Date.now() };
        items.push(...pipe.items);
      } else {
        const created = createGenerations(
          { ...step.request, step: { label: step.label, index: i, of: n } },
          { batchId, ...(depIds.length && { dependsOn: depIds as string[] }) },
        );
        made.set(step.nodeId, created[0].id);
        runs[step.nodeId] = { sig, ids: created.map((g) => g.id), at: Date.now() };
        items.push(...created);
      }
      ran.push(step.nodeId);
    } catch (e) {
      errors.push({ nodeId: step.nodeId, message: (e as Error).message });
    }
  });
  if (ran.length) {
    // Merge into the latest runs (another run may have finished writing meanwhile).
    db().transaction(() => {
      const row = db().prepare("SELECT runs_json FROM canvases WHERE id = ?").get(id) as { runs_json: string } | undefined;
      const merged = { ...(row ? (JSON.parse(row.runs_json) as CanvasRuns) : {}), ...runs };
      db().prepare("UPDATE canvases SET runs_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(merged), Date.now(), id);
    })();
  }
  return {
    canvas: getCanvas(id)!,
    items,
    ran,
    reused: plan.reused,
    errors,
    costUsd: plan.steps.filter((s) => ran.includes(s.nodeId)).reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
  };
}
