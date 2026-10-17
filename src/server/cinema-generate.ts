import "server-only";
import { nanoid } from "nanoid";
import { getModel } from "@/lib/catalog";
import {
  SWATCH_PLACEHOLDER,
  planCinema,
  withPlaceholders,
  type CinemaContext,
  type CinemaGenerateInput,
  type CinemaPlan,
  type CinemaStep,
  type CinemaTakeInfo,
  type DirectorSettings,
} from "@/lib/catalog/cinema";
import type { Generation, GenerationRequest } from "@/lib/catalog/types";
import { CinemaError, addItems, getProject, spentUsd } from "./cinema";
import { createGenerations, previewGeneration } from "./generations";
import { encodePng } from "./png";
import { provider } from "./providers";
import { engineMode } from "./settings";
import { saveFile } from "./storage";

/** What this install can run right now (decides Cinema Studio 4.0 vs Seedance, frame fallbacks). */
export function cinemaContext(): CinemaContext {
  return { higgsfield: provider("higgsfield").isConfigured(), cloudAllowed: engineMode() !== "open", has: (id) => !!getModel(id) };
}

declare global {
  var __fuobeSwatches: Map<string, string> | undefined;
}

/** A 12-stripe PNG of the palette: the reference image palette-transfer recolours toward. */
export function swatchUrl(hex: string[]): string {
  globalThis.__fuobeSwatches ??= new Map();
  const key = hex.join(",").toLowerCase();
  const hit = globalThis.__fuobeSwatches.get(key);
  if (hit) return hit;
  const stripe = 32;
  const width = stripe * hex.length;
  const height = 64;
  const data = Buffer.alloc(width * height * 4);
  hex.forEach((h, i) => {
    const n = parseInt(h.replace("#", ""), 16);
    for (let y = 0; y < height; y++)
      for (let x = i * stripe; x < (i + 1) * stripe; x++) data.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], (y * width + x) * 4);
  });
  const asset = saveFile({ data: encodePng({ width, height, data }), contentType: "image/png", name: "palette-swatch.png", source: "upload" });
  globalThis.__fuobeSwatches.set(key, asset.url);
  return asset.url;
}

/** A generate request from the workspace: the brief always comes from the project, the Director settings unless sent. */
export type CinemaRequest = Omit<CinemaGenerateInput, "settings" | "brief"> & { settings?: DirectorSettings };

/** The plan with this project's brief and (unless the request carries its own) Director settings. */
export function planForProject(projectId: string, input: CinemaRequest): CinemaPlan {
  const project = getProject(projectId);
  if (!project) throw new CinemaError("Project not found", 404);
  return planCinema({ ...input, settings: input.settings ?? project.director, brief: project.brief.body }, cinemaContext());
}

/** What the run will really cost (0 for demo-mode steps), from the server's own route choice. */
function realCost(steps: CinemaStep[]): number {
  let total = 0;
  const jobs: Record<string, number> = {};
  for (const s of steps) {
    const p = previewGeneration(withPlaceholders(s));
    const n = s.perJobOf ? (jobs[s.perJobOf] ?? 1) : 1;
    jobs[s.key] = s.after?.length ? n : p.jobs;
    total += (p.costUsd ?? 0) * n;
  }
  return Math.round(total * 1000) / 1000;
}

/** The generations a dependent step waits for: a joined film counts once, otherwise each take. */
function terminal(list: Generation[]): Generation[] {
  return list[0]?.op === "concat" ? [list[0]] : list;
}

export interface CinemaRunResult {
  items: Generation[];
  plan: Pick<CinemaPlan, "notes" | "costUsd" | "outputs"> & { modelId: string };
}

/**
 * Plan, check the project's cost cap, create the chained generations and record them in the project
 * (in `folderId`, the scene the user is looking at).
 */
export function generateInProject(projectId: string, input: CinemaRequest, folderId: string | null = null): CinemaRunResult {
  const project = getProject(projectId);
  if (!project) throw new CinemaError("Project not found", 404);
  const plan = planForProject(projectId, input);
  if (plan.blocker) throw new CinemaError(plan.blocker, 422);
  if (!plan.steps.length) throw new CinemaError("Nothing to generate", 422);

  if (project.costCapUsd != null) {
    const cost = realCost(plan.steps);
    const spent = spentUsd(projectId);
    if (cost > 0 && spent + cost > project.costCapUsd + 1e-9) {
      throw new CinemaError(
        `This run (≈ $${cost.toFixed(2)}) would take the project past its $${project.costCapUsd.toFixed(2)} limit — $${spent.toFixed(2)} is already spent. Raise the limit in project settings.`,
        422,
      );
    }
  }

  const take: CinemaTakeInfo = {
    mode: input.mode,
    action: input.action,
    prompt: input.prompt.slice(0, 4000),
    ...(input.moves?.length ? { moves: input.moves } : {}),
    ...(input.action === "grid" && input.grid ? { grid: input.grid } : {}),
  };
  const batchId = nanoid(10);
  const made: Record<string, Generation[]> = {};
  const all: Generation[] = [];
  try {
    for (const step of plan.steps) {
      const req: GenerationRequest = structuredClone(step.request);
      if (step.swatch && req.inputs?.images) req.inputs.images = req.inputs.images.map((u) => (u === SWATCH_PLACEHOLDER ? swatchUrl(step.swatch!) : u));
      let created: Generation[] = [];
      if (step.perJobOf) {
        for (const t of terminal(made[step.perJobOf] ?? [])) created.push(...createGenerations(req, { batchId, dependsOn: t.id }));
      } else if (step.after?.length) {
        const deps = step.after.map((k) => terminal(made[k] ?? [])[0]?.id).filter((x): x is string => !!x);
        created = createGenerations(req, { batchId, dependsOn: deps });
      } else created = createGenerations(req, { batchId });
      made[step.key] = created;
      all.push(...created);
    }
  } catch (e) {
    // Keep what already started visible in the project, then report the step that failed.
    if (all.length) addItems(projectId, all.map((g) => g.id), folderId, take);
    throw new CinemaError((e as Error).message, 422);
  }
  addItems(projectId, all.map((g) => g.id), folderId, take);
  return { items: all, plan: { notes: plan.notes, costUsd: plan.costUsd, outputs: plan.outputs, modelId: plan.model.id } };
}
