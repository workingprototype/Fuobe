/**
 * Lanes: the jobs that load the same big model files, so a worker that has them loaded runs the next one with no reload
 * (docs/gpu-workers.md). A lane is named by its files, never by hand: the first 12 hex digits of the SHA-256 of the
 * sorted names of a workflow's files over 2 GB in workflows/comfyui/requirements.json. Two workflows that load the same
 * diffusion model and text encoder share a lane. A workflow with no big file has the lane "small".
 *
 * Pure: the server, the worker program and the tests share it. `sha256hex` is passed in (node:crypto on the server).
 */
import type { IndexWorkflow, RequirementIndex, StreamNeed } from "./gpu/types";

export const BIG_FILE_BYTES = 2 * 2 ** 30;
export const SMALL_LANE = "small";

export interface FileNeed {
  folder: string;
  name: string;
  size: number;
  sha256: string | null;
}

/** What a task needs from the worker that takes it. */
export interface Needs {
  workflowId: string;
  files: FileNeed[];
  packs: string[];
  /** The graphics memory a worker must report, with VRAM_TOLERANCE already allowed for. */
  minVramBytes: number;
  /** How big the job is (its largest picture in megapixels, its longest clip in seconds, its results): a PC's ceiling reads it. */
  size?: { megapixels: number; seconds: number; outputs: number };
  /** A job ticket's catalog version (src/lib/job-ticket.ts): only a worker built for that catalog takes the task. */
  catalogVersion?: string;
  /**
   * The ticket carries its graph's fingerprint (graphSha): a worker built for another catalog that checks the graph itself
   * may take the task too.
   */
  graphSha?: boolean;
  /**
   * The files the run adds beyond its workflow's own (a look's, a motion's or a recipe's LoRAs: src/lib/runtime-files.ts):
   * only a worker that verified each one takes the task.
   */
  runtime?: FileNeed[];
}

/**
 * A card sold as a whole number of GB reports a little less than that (a 32 GB card about 31.8 GiB, a 10 GB card a
 * few MB under 10 GiB). A workflow's VRAM need allows this much under its whole GB, so such a card takes the lanes made
 * for its size.
 */
export const VRAM_TOLERANCE = 0.03;

/** The graphics memory a workflow of `gb` whole GB needs from a worker, in bytes (3% under the whole GB). */
export const minVramBytesFor = (gb: number) => Math.round((gb || 0) * 2 ** 30 * (1 - VRAM_TOLERANCE));

/** What a GPU says of its memory, as memoryFit reads it. */
export interface MemoryFacts {
  vramBytes?: number;
  /** Its system RAM. Unknown (its ComfyUI hasn't said yet): no streaming. */
  ramBytes?: number;
  /** Its ComfyUI runs with dynamic VRAM off (--disable-dynamic-vram and the like): no streaming. */
  dynamicVramOff?: boolean;
}

/**
 * A workflow's streaming rule as requirements.json gives it (`stream`): a streaming need of its own (stream-needs.json),
 * `false` when it never streams (its node packs load models outside ComfyUI's model management, or it runs isolated),
 * or none: the computed rule (streamLoadFits) decides from the files it loads.
 */
export type StreamRule = StreamNeed | false | null | undefined;

/** The model files a GPU would load for a workflow, in bytes, as the computed streaming rule reads them. */
export interface StreamLoad {
  /** The files of the choice it runs: the workflow's own, or a model variant's (src/lib/gpu/model-variants.ts). */
  fileBytes: number;
  /** The files the run adds beyond those (a look's LoRAs: src/lib/runtime-files.ts). */
  extraBytes?: number;
}

/**
 * The room the computed rule leaves in VRAM and RAM together, beyond the model files: the operating system, ComfyUI's own
 * process, and the activations and buffers that live in RAM while the weights stream. Measured on a 10 GB card with
 * 32 GB of RAM (the card reports about 10 GiB, the RAM about 31.9 GiB): workflows whose model files total 38.4 to
 * 39.5 GiB ran with their weights streamed, RAM near full and the page file covering a few GB at the peak; one of
 * 18.8 GiB used under 29 GB of RAM. 2 GiB keeps those runs in (39.5 + 2 is under 10 + 31.9) and leaves anything larger
 * out.
 */
export const STREAM_RESERVE_BYTES = 2 * 2 ** 30;

/**
 * The smallest card the computed rule streams on, in whole GB (with the 3% allowance). The card still holds what the
 * step computes: the block of weights in use, the activations and the decoder's working memory. The measured runs used a
 * 10 GB card; 8 GB cards hold the same working set at the catalog's sizes with less to spare, and smaller cards run
 * short of it.
 */
export const STREAM_MIN_VRAM_GB = 8;

/**
 * The computed streaming rule, for a workflow with no streaming need of its own: a card of STREAM_MIN_VRAM_GB or more,
 * whose VRAM still covers the part of the workflow's VRAM need that isn't its model files (activations, working buffers,
 * and any weights the catalog doesn't list, such as files a pack downloads itself), and whose VRAM and RAM together hold
 * every model file it loads with STREAM_RESERVE_BYTES to spare. The caller has checked the facts are known.
 */
function streamLoadFits(needGb: number, load: StreamLoad | undefined, vramBytes: number, ramBytes: number): boolean {
  if (!load || !(load.fileBytes > 0)) return false;
  if (vramBytes < minVramBytesFor(STREAM_MIN_VRAM_GB)) return false;
  if (minVramBytesFor(needGb) - load.fileBytes > vramBytes) return false;
  return load.fileBytes + (load.extraBytes ?? 0) + STREAM_RESERVE_BYTES <= vramBytes + ramBytes;
}

/**
 * Can a GPU run a workflow with its weights streamed from RAM? With a streaming need of its own (stream-needs.json), that
 * need alone decides: its VRAM covers the need's VRAM and its RAM covers the need's RAM, each with the same 3% allowance
 * as the VRAM test (a 32 GB PC reports about 31.9 GiB). With none, the computed rule (streamLoadFits) decides from
 * `load`, the files it would load, and `needGb`, the workflow's VRAM need. Never for a workflow that doesn't stream
 * (`false`), and never with unknown RAM, unknown VRAM, or dynamic VRAM off.
 */
export function streamFits(stream: StreamRule, have: MemoryFacts, load?: StreamLoad, needGb = 0): boolean {
  if (stream === false || have.dynamicVramOff || !have.ramBytes || !have.vramBytes) return false;
  if (stream) return minVramBytesFor(stream.vramGb) <= have.vramBytes && minVramBytesFor(stream.ramGb) <= have.ramBytes;
  return streamLoadFits(needGb, load, have.vramBytes, have.ramBytes);
}

/**
 * How a GPU holds a workflow of `needGb`: every weight on its card ("vram"), part of them streamed from its RAM
 * ("stream", slower: streamFits, with `load` for the computed rule), or not at all (null).
 */
export function memoryFit(needGb: number, stream: StreamRule, have: MemoryFacts, load?: StreamLoad): "vram" | "stream" | null {
  if (minVramBytesFor(needGb) <= (have.vramBytes ?? 0)) return "vram";
  return streamFits(stream, have, load, needGb) ? "stream" : null;
}

/** The total size of these catalog files in bytes (a key the index doesn't have counts 0). */
export function filesBytes(index: Pick<RequirementIndex, "files">, keys: readonly string[]): number {
  return keys.reduce((n, k) => n + (index.files[k as keyof RequirementIndex["files"]]?.sizeBytes ?? 0), 0);
}

type Sha = (text: string) => string;

const bigFiles = (index: RequirementIndex, wf: IndexWorkflow) =>
  wf.files
    .map((k) => index.files[k])
    .filter((f) => f && f.sizeBytes > BIG_FILE_BYTES)
    .map((f) => `${f.folder}/${f.file}`)
    .sort();

/** A workflow's lane key, or "small". Null: no such workflow. */
export function laneOf(index: RequirementIndex, workflowId: string, sha: Sha): string | null {
  const wf = index.workflows[workflowId];
  if (!wf) return null;
  const big = bigFiles(index, wf);
  return big.length ? sha(big.join("\n")).slice(0, 12) : SMALL_LANE;
}

/** A readable name for a lane: its biggest file's name, cleaned ("wan2.2 i2v high noise 14B fp8"). */
export function laneLabel(index: RequirementIndex, lane: string, sha: Sha): string {
  if (lane === SMALL_LANE) return "Small jobs";
  for (const [id, wf] of Object.entries(index.workflows)) {
    if (laneOf(index, id, sha) !== lane) continue;
    const biggest = wf.files.map((k) => index.files[k]).filter(Boolean).sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
    if (biggest) return biggest.file.replace(/\.(safetensors|gguf|pth|ckpt)$/i, "").replace(/[_-]+/g, " ");
  }
  return lane;
}

/** Every lane in the index, with its label and the workflows in it. */
export function allLanes(index: RequirementIndex, sha: Sha): { lane: string; label: string; workflows: string[] }[] {
  const by = new Map<string, string[]>();
  for (const id of Object.keys(index.workflows)) {
    const lane = laneOf(index, id, sha)!;
    by.set(lane, [...(by.get(lane) ?? []), id]);
  }
  return [...by].map(([lane, workflows]) => ({ lane, label: laneLabel(index, lane, sha), workflows })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Index files as a task needs them (folder, name, exact size, sha256 when pinned). */
const fileNeeds = (index: RequirementIndex, keys: readonly string[]): FileNeed[] =>
  keys
    .map((k) => index.files[k as keyof RequirementIndex["files"]])
    .filter(Boolean)
    .map((f) => ({ folder: f.folder, name: f.file, size: f.sizeBytes, sha256: f.sha256 ?? null }));

/** What a workflow's task needs: its default files (folder, name, exact size, sha256 when pinned), packs and VRAM (with the tolerance). */
export function needsOf(index: RequirementIndex, workflowId: string): Needs | null {
  const wf = index.workflows[workflowId];
  if (!wf) return null;
  return { workflowId, files: fileNeeds(index, wf.files), packs: Object.keys(wf.packs).sort(), minVramBytes: minVramBytesFor(wf.vramGb) };
}

/**
 * The files of each of a workflow's model variants (src/lib/gpu/model-variants.ts): its own files with the variant's in
 * their place, in the catalog's order of preference.
 */
export function variantNeeds(index: RequirementIndex, workflowId: string): { id: string; files: FileNeed[] }[] {
  const wf = index.workflows[workflowId];
  return (wf?.variants ?? []).map((v) => ({ id: v.id, files: fileNeeds(index, wf.files.map((k) => v.files[k] ?? k)) }));
}

/** The kinds of input file a worker may take. A worker makes every clip and sound again before its ComfyUI reads it. */
export const MEDIA_KINDS = ["image", "video", "audio"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** The node types that read a clip or a sound file the job sent. */
export const MEDIA_LOADERS: Record<"video" | "audio", readonly string[]> = {
  video: ["LoadVideo", "VHS_LoadVideo", "VHS_LoadVideoPath", "VHS_LoadVideoFFmpeg", "VHS_LoadVideoFFmpegPath"],
  audio: ["LoadAudio", "VHS_LoadAudio", "VHS_LoadAudioUpload"],
};

/** The kinds of input file a workflow reads besides pictures: "video", "audio", both or none. */
export function mediaOf(wf: Pick<IndexWorkflow, "core" | "packs">): ("video" | "audio")[] {
  const classes = new Set([...wf.core, ...Object.values(wf.packs).flat()]);
  return (["video", "audio"] as const).filter((k) => MEDIA_LOADERS[k].some((c) => classes.has(c)));
}

/**
 * A worker's verified files and node packs (PUT /api/gpu/computer/inventory), and the kinds of input it takes (`media`:
 * a worker without a way to make clips and sound again takes pictures only). No `media` (a worker from before workers
 * made clips and sound again): pictures only. A pack's `missingClasses`: the catalog's node classes of that pack its
 * ComfyUI didn't list after it started (a pack whose import failed lists none); a workflow that needs one of them isn't
 * the worker's to run. No `missingClasses` (a worker that doesn't say, or hasn't read them yet): its folder counts.
 */
export interface Inventory {
  files: FileNeed[];
  nodePacks: NodePack[];
  media?: MediaKind[];
}

export interface NodePack {
  name: string;
  commit: string | null;
  missingClasses?: string[];
}

/** A pack in an inventory's hash: name@commit, then the classes its ComfyUI didn't load after a "!" (none: as before). */
export const packKey = (p: NodePack) => `${p.name}@${p.commit ?? ""}${p.missingClasses?.length ? `!${[...p.missingClasses].sort().join(",")}` : ""}`;

/**
 * The node classes a workflow needs that its worker's ComfyUI didn't load, by pack ("pack/Class"): its packs are there
 * (by folder), but a class the worker said is missing would stop the run.
 */
export function unloadedNodes(wf: Pick<IndexWorkflow, "packs">, packs: ReadonlyMap<string, NodePack>): string[] {
  return Object.entries(wf.packs).flatMap(([name, classes]) => {
    const missing = new Set(packs.get(name)?.missingClasses ?? []);
    return classes.filter((c) => missing.has(c)).map((c) => `${name}/${c}`);
  });
}

const fileKey = (f: Pick<FileNeed, "folder" | "name">) => `${f.folder}/${f.name}`;

/** Has the worker this file: folder, name and exact size always; the SHA-256 too when the index pins one. */
export function hasFile(inv: Inventory, need: FileNeed): boolean {
  return inv.files.some((f) => fileKey(f) === fileKey(need) && f.size === need.size && (!need.sha256 || f.sha256 === need.sha256));
}

/** Has the worker every one of these files (none asked: yes)? */
export const hasFiles = (inv: Inventory, needs: readonly FileNeed[] | undefined): boolean => !needs?.length || needs.every((n) => hasFile(inv, n));

/**
 * What a worker can run with what it has: the workflows whose files (its own, or one of its variants') and packs are all
 * there (and whose packs' node classes its ComfyUI loaded, where it said), the lanes whose every workflow runs, and, for the other lanes, what it lacks. A task goes only to a worker that can run its workflow.
 * `sets`: for each of those workflows that has model variants, the file sets it has whole (null: the workflow's own, else
 * a variant's id).
 */
export function lanesFor(
  index: RequirementIndex,
  inv: Inventory,
  sha: Sha,
): { lanes: string[]; workflows: string[]; missing: { lane: string; label: string; files: string[]; bytes: number }[]; sets: Record<string, (string | null)[]> } {
  const packs = new Map(inv.nodePacks.map((p) => [p.name, p]));
  const takes = new Set<string>(inv.media ?? ["image"]);
  const ok = new Map<string, boolean>();
  const workflows: string[] = [];
  const sets: Record<string, (string | null)[]> = {};
  const lacking = new Map<string, Map<string, number>>();
  for (const id of Object.keys(index.workflows)) {
    if (index.workflows[id].isolated) continue;
    const lane = laneOf(index, id, sha)!;
    const n = needsOf(index, id)!;
    // Its own files, or every file of one of its variants: a worker that has either may run it.
    let missingFiles = n.files.filter((f) => !hasFile(inv, f));
    const variants = variantNeeds(index, id);
    const whole = [...(missingFiles.length ? [] : [null]), ...variants.filter((v) => hasFiles(inv, v.files)).map((v) => v.id)];
    if (whole.length) missingFiles = [];
    const missingPacks = n.packs.filter((p) => !packs.has(p));
    const missingMedia = mediaOf(index.workflows[id]).filter((k) => !takes.has(k));
    const notLoaded = unloadedNodes(index.workflows[id], packs);
    const fine = !missingFiles.length && !missingPacks.length && !missingMedia.length && !notLoaded.length;
    if (fine) workflows.push(id);
    if (fine && variants.length) sets[id] = whole;
    ok.set(lane, (ok.get(lane) ?? true) && fine);
    if (!fine) {
      const m = lacking.get(lane) ?? new Map<string, number>();
      for (const f of missingFiles) m.set(fileKey(f), f.size);
      for (const p of missingPacks) m.set(`pack:${p}`, 0);
      for (const k of missingMedia) m.set(`input:${k}`, 0);
      for (const c of notLoaded) m.set(`node:${c}`, 0);
      lacking.set(lane, m);
    }
  }
  const lanes = [...ok].filter(([, v]) => v).map(([k]) => k).sort();
  const missing = [...lacking].map(([lane, m]) => ({ lane, label: laneLabel(index, lane, sha), files: [...m.keys()].sort(), bytes: [...m.values()].reduce((a, b) => a + b, 0) }));
  return { lanes, workflows: workflows.sort(), missing, sets };
}

/**
 * The lanes a worker can run only some workflows of (`workflows`: the ones it can run, as lanesFor gives them): how many
 * it runs, of how many (isolated workflows left out, as lanesFor does). A task goes only to a worker that can run its
 * own workflow, so such a lane may be allowed: its other workflows never reach that worker.
 */
export function partLanes(index: RequirementIndex, workflows: readonly string[], sha: Sha): Record<string, { runnable: number; of: number }> {
  const can = new Set(workflows);
  const by = new Map<string, { runnable: number; of: number }>();
  for (const id of Object.keys(index.workflows)) {
    if (index.workflows[id].isolated) continue;
    const lane = laneOf(index, id, sha)!;
    const n = by.get(lane) ?? { runnable: 0, of: 0 };
    n.of++;
    if (can.has(id)) n.runnable++;
    by.set(lane, n);
  }
  return Object.fromEntries([...by].filter(([, n]) => n.runnable > 0 && n.runnable < n.of).sort(([a], [b]) => a.localeCompare(b)));
}
