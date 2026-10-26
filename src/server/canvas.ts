import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  CANVAS_TEXT_MAX as TEXT_MAX,
  cleanGraph,
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
import { db } from "./db";
import { listElements } from "./elements";
import { createGenerations, getGeneration } from "./generations";
import { engineMode } from "./settings";

/**
 * Canvas boards (Higgsfield Canvas): the graph the user edits, plus the last run of each
 * generator node. Running turns the graph into chained generations (src/lib/catalog/canvas.ts
 * plans it; createGenerations + dependsOn runs it), so results survive restarts like any other job.
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
  graph: JSON.parse(r.graph_json) as CanvasGraph,
  runs: JSON.parse(r.runs_json) as CanvasRuns,
  templateId: r.template_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  editedAt: r.edited_at,
});

// ---------------------------------------------------------------------------
// Validation of graphs coming from the browser

const NODE_TYPES = ["prompt", "image-input", "video-input", "audio-input", "element", "model", "join", "frame", "upscale", "bg-remove", "tts", "output", "note"] as const satisfies readonly CanvasNodeType[];
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
});

const Num = z.number().finite();

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
});

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
  return fallback;
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
      nodeCount: c.graph.nodes.length,
      templateId: c.templateId,
      preview: previewOf(c.runs),
      outline: outline(c.graph),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      editedAt: c.editedAt,
    };
  });
}

export interface CreateCanvasInput {
  name?: string;
  graph?: CanvasGraph;
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
  const now = Date.now();
  const row: Row = {
    id: nanoid(10),
    name: (input.name?.trim() || template?.name || "Untitled canvas").slice(0, 80),
    graph_json: JSON.stringify(cleanGraph(graph)),
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

/** Save a new name and/or graph. Moving the viewport alone doesn't count as an edit. */
export function updateCanvas(id: string, patch: { name?: string; graph?: CanvasGraph }): Canvas | null {
  const current = getCanvas(id);
  if (!current) return null;
  const now = Date.now();
  const name = patch.name?.trim() ? patch.name.trim().slice(0, 80) : current.name;
  let graphJson = JSON.stringify(current.graph);
  let edited = current.editedAt;
  if (patch.graph) {
    const next = cleanGraph(patch.graph);
    const strip = (g: CanvasGraph) => JSON.stringify({ nodes: g.nodes, edges: g.edges });
    if (strip(next) !== strip(current.graph)) edited = now;
    graphJson = JSON.stringify(next);
  }
  db().prepare("UPDATE canvases SET name = ?, graph_json = ?, updated_at = ?, edited_at = ? WHERE id = ?").run(name, graphJson, now, edited, id);
  return getCanvas(id);
}

export function duplicateCanvas(id: string): Canvas | null {
  const c = getCanvas(id);
  if (!c) return null;
  const now = Date.now();
  const row: Row = {
    id: nanoid(10),
    name: `Copy of ${c.name}`.slice(0, 80),
    graph_json: JSON.stringify(c.graph),
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
  const canvas = { ...stored, graph: withCurrentElements(stored.graph, listElements()) };
  const ids = [...new Set(Object.values(canvas.runs).flatMap((r) => r.ids))];
  // getGeneration also makes sure the runner is polling after a restart.
  const generations = ids.map((g) => getGeneration(g)).filter((g): g is Generation => !!g);
  return { canvas, generations };
}

// ---------------------------------------------------------------------------
// Run

export interface RunOptions {
  /** Nodes to run with their upstream; omit for Run all. */
  targets?: string[];
  /** Re-run the targets even when their result is fresh. */
  force?: boolean;
  /** The board as the editor has it now (saved first, so an autosave in flight can't race the run). */
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

export function runCanvas(id: string, opts: RunOptions = {}): RunResult | null {
  let canvas = getCanvas(id);
  if (!canvas) return null;
  if (opts.graph) canvas = updateCanvas(id, { graph: opts.graph })!;
  // An element renamed since the board was saved: its node mentions the new @handle.
  const graph = withCurrentElements(canvas.graph, listElements());
  const plan = planCanvas(graph, { targets: opts.targets, force: opts.force, runs: canvas.runs, status: statusOf, engineMode: engineMode() });
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
      const created = createGenerations(
        { ...step.request, step: { label: step.label, index: i, of: n } },
        { batchId, ...(depIds.length && { dependsOn: depIds as string[] }) },
      );
      made.set(step.nodeId, created[0].id);
      runs[step.nodeId] = { sig: nodeSignature(step.request, depIds as string[]), ids: created.map((g) => g.id), at: Date.now() };
      items.push(...created);
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
