/**
 * Model variants: other files of the same models that a workflow may load in place of some of its own
 * (workflows/comfyui/model-variants.json, built into requirements.json by scripts/comfy/build-requirements.mjs). The best
 * file format depends on the card: int8 files run faster on a card with fast int8 and no fp8 hardware, fp8 and FP4 files
 * on a card that has it.
 *
 * A workflow's model slots are the loader inputs that read one of its own files ([class, input] of that file's loaders,
 * in its model folder). A choice fills each slot with a file: the workflow's own files, or a variant's. pickFiles takes
 * the choices and what a GPU has, and returns the one it runs; swapGraphFiles writes that choice into a graph.
 *
 * Pure: the server, the worker program (its job-ticket composer imports this file) and the tests share it.
 */
import type { FileKey, ModelVariant, RequirementIndex } from "./types";

/** A card generation as nvidia-smi gives it: its CUDA compute capability ("8.6", "12.0"). */
export const GPU_GEN = /^\d{1,2}\.\d{1,2}$/;

const genValue = (g: string): number => {
  const [major, minor] = g.split(".").map(Number);
  return major * 100 + minor;
};

/** Is this generation inside the range (both ends counted)? An unknown generation is inside none. */
export function genInside(gen: string | null | undefined, range: ModelVariant["gpuGen"]): boolean {
  if (!gen || !range || !GPU_GEN.test(gen)) return false;
  const g = genValue(gen);
  return g >= genValue(range.min) && g <= genValue(range.max);
}

/** One way to fill a workflow's model slots. */
export interface FileChoice {
  /** The variant's id; null for the workflow's own files. */
  variant: string | null;
  /** Each slot's own file → the file that fills it in its place. Empty for the workflow's own files. */
  swap: Record<FileKey, FileKey>;
  /** Every file this choice loads (the workflow's files, with the swapped ones in their place). */
  files: FileKey[];
  /** Its graphics memory need in GB. */
  vramGb: number;
  /** The card generations it suits. None: no card prefers it. */
  gpuGen?: ModelVariant["gpuGen"];
}

/** The choices of a workflow: its own files first, then each of its variants, in the catalog's order of preference. */
export function fileChoices(index: Pick<RequirementIndex, "workflows">, workflowId: string): FileChoice[] {
  const wf = index.workflows[workflowId];
  if (!wf) return [];
  const own: FileChoice = { variant: null, swap: {}, files: [...wf.files], vramGb: wf.vramGb };
  return [
    own,
    ...(wf.variants ?? []).map((v) => ({
      variant: v.id,
      swap: { ...v.files },
      files: wf.files.map((k) => v.files[k] ?? k),
      vramGb: v.vramGb ?? wf.vramGb,
      ...(v.gpuGen && { gpuGen: v.gpuGen }),
    })),
  ];
}

/** Does the workflow have variants? */
export const hasVariants = (index: Pick<RequirementIndex, "workflows">, workflowId: string): boolean => !!index.workflows[workflowId]?.variants?.length;

/** What a GPU has, as pickFiles reads it. */
export interface ChoiceDevice {
  /** Its card's generation (compute capability), when it is known. */
  gpuGen?: string | null;
  /** Has it this file (a worker: verified against its pin; a person's ComfyUI: there, as its check read it)? */
  has: (key: FileKey) => boolean;
  /** Its graphics memory: a choice that needs more is left out. Undefined: not checked here. */
  fits?: (vramGb: number) => boolean;
  /** False: the workflow's own files only (a GPU that can't take a variant). */
  variants: boolean;
}

/**
 * The choice a GPU runs, or null when it has the files of none: first a variant made for its card's generation that it
 * has every file of (in the order of preference), then the workflow's own files, then any other variant it has every file
 * of. A GPU whose generation is unknown gets the workflow's own files when it has them. With `variants` false, only the
 * workflow's own files count.
 */
export function pickFiles(choices: readonly FileChoice[], device: ChoiceDevice): FileChoice | null {
  const whole = (c: FileChoice) => c.files.every((k) => device.has(k)) && (!device.fits || device.fits(c.vramGb));
  const own = choices.find((c) => c.variant === null);
  const others = device.variants ? choices.filter((c) => c.variant !== null) : [];
  const forCard = others.filter((c) => genInside(device.gpuGen, c.gpuGen));
  for (const c of [...forCard, ...(own ? [own] : []), ...others.filter((c) => !forCard.includes(c))]) if (whole(c)) return c;
  return null;
}

/** The base name a file is read by in a graph, and the loader inputs ("Class\u0000input") that read it. */
type Slot = { from: string; to: string; loaders: Set<string> };

/**
 * A graph with a choice written into it: in each model slot (a loader input that reads one of the swapped files, by that
 * file's loaders in the index), the file that fills it in its place. Nothing else changes; a graph that loads none of
 * the swapped files comes back as it was. The graph given is never changed.
 */
export function swapGraphFiles<G extends Record<string, { class_type: string; inputs: Record<string, unknown> }>>(
  graph: G,
  swap: Readonly<Record<FileKey, FileKey>>,
  index: Pick<RequirementIndex, "files">,
): G {
  const slots: Slot[] = [];
  for (const [from, to] of Object.entries(swap) as [FileKey, FileKey][]) {
    const a = index.files[from];
    const b = index.files[to];
    if (!a || !b) throw new Error(`${!a ? from : to} isn't a file of the catalog`);
    slots.push({ from: a.file, to: b.file, loaders: new Set((a.loaders ?? []).map(([cls, input]) => `${cls}\u0000${input}`)) });
  }
  if (!slots.length) return graph;
  const out = {} as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  for (const [id, node] of Object.entries(graph)) {
    let inputs = node?.inputs;
    for (const [input, value] of Object.entries(node?.inputs ?? {})) {
      if (typeof value !== "string") continue;
      const s = slots.find((x) => x.from === value && x.loaders.has(`${node.class_type}\u0000${input}`));
      if (s) inputs = { ...inputs, [input]: s.to };
    }
    out[id] = inputs === node?.inputs ? node : { ...node, inputs };
  }
  return out as G;
}
