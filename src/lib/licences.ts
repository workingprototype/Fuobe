/*
 * The About & licences page: the licence of every open model Fuobe can run, from the ComfyUI
 * manifest's `license` field and the catalog's open models, with the catches a person should
 * know before using the results commercially (non-commercial, countries excluded, conditions)
 * and the notices some licences ask the app to show ("Built with DINOv3").
 *
 * Licence texts follow the manifest's convention: NON-COMMERCIAL in capitals when the weights
 * (or a node pack's code) may not be used commercially, "territory EXCLUDES …" for countries a
 * licence leaves out, and `show "…"` for a notice the app must display. A lower-case mention
 * ("Base/Large are CC-BY-NC, keep the small one") describes a variant Fuobe does not use.
 */

export type LicenceFlag = "non-commercial" | "territory" | "conditions";

/** The parts of a catalog model the list needs (the page passes ModelDefs). */
export interface LicenceModelInput {
  id: string;
  name: string;
  vendor: string;
  kind: string;
  hidden?: boolean;
  routes: { provider: string; endpoint: string }[];
}

/** The parts of a manifest workflow the list needs. */
export interface LicenceWorkflowInput {
  id: string;
  title: string;
  capability: string;
  license?: string;
}

export interface LicenceRow {
  /** The model id, or the workflow id for a workflow no model uses yet. */
  id: string;
  name: string;
  /** The vendor, or "Workflow library" for a workflow no studio uses yet. */
  by: string;
  kind: string;
  workflows: string[];
  /** Distinct licence texts of its workflows. */
  licences: string[];
  flags: LicenceFlag[];
  /** Who a territory-restricted licence leaves out ("the EU, UK and South Korea"). */
  excludes?: string;
  notices: string[];
  /** True when a studio, app or helper step runs it; false for a workflow only in the library. */
  inCatalog: boolean;
}

export interface LicenceList {
  rows: LicenceRow[];
  /** Catalog tools that run on ComfyUI's own nodes, with no model weights. */
  noWeights: string[];
  /** Library workflows with no model weights that no studio uses yet. */
  noWeightsLibrary: number;
  /** Each notice and the models that need it. */
  notices: { text: string; models: string[] }[];
  counts: { all: number; clear: number } & Record<LicenceFlag, number>;
}

/**
 * Licences of the workflows whose manifest entries predate the `license` field (rounds 1–2),
 * from docs/research/comfyui-oss.md and the model cards. First match wins.
 */
export const EARLIER_LICENCES: [RegExp, string][] = [
  [/^flux1-schnell/, "Apache-2.0 (FLUX.1 [schnell])"],
  [
    /^flux1-(dev|krea|kontext|fill)/,
    "FLUX.1 [dev] Non-Commercial License: NON-COMMERCIAL (outputs may be used commercially per BFL's terms; running the model in production needs a BFL commercial licence)",
  ],
  [/^flux2-dev/, "FLUX [dev] Non-Commercial License (FLUX.2 [dev]): NON-COMMERCIAL"],
  [/^qwen-image/, "Apache-2.0 (Qwen-Image 2512 / Qwen-Image-Edit, Lightning LoRAs, Qwen2.5-VL text encoder)"],
  [/^z-image/, "Apache-2.0 (Z-Image Turbo)"],
  [/^hidream-i1/, 'MIT (HiDream-I1); its Llama 3.1 8B text encoder is under the Llama 3.1 Community License (show "Built with Llama")'],
  [/^sdxl/, "CreativeML OpenRAIL++-M (commercial use allowed, with use-based restrictions)"],
  [/esrgan/, "BSD-3-Clause (Real-ESRGAN x4plus)"],
  [/seedvr2/, "Apache-2.0 (SeedVR2)"],
  [/^bg-remove-birefnet/, "MIT (BiRefNet)"],
  [/^bg-remove-rmbg/, "BEN2 weights MIT (the pack's default); RMBG-2.0 in the same pack is CC-BY-NC-4.0 (non-commercial), keep BEN2; ComfyUI-RMBG code GPL-3.0"],
  [/^face-swap-reactor/, "inswapper_128 weights (InsightFace): NON-COMMERCIAL, research use only; ReActor node MIT; GFPGAN Apache-2.0"],
  [/^wan22-i2v-14b-lora/, "Apache-2.0 (Wan 2.2); a LoRA you add carries its own licence"],
  [/^wan-animate/, "Apache-2.0 (Wan Animate 2, lightx2v)"],
  [/^wan22-/, "Apache-2.0 (Wan 2.2, umT5, lightx2v)"],
  [/^hunyuan15/, "Tencent Hunyuan Community License (territory EXCLUDES the EU, UK and South Korea)"],
  [/^ltx2/, "LTX-2.x Community License (free, commercial use included, below US$10M annual revenue; a paid licence above); Gemma 3 text encoder under the Gemma Terms of Use"],
  [/^infinitetalk/, "Apache-2.0 (InfiniteTalk, Wan 2.1, lightx2v)"],
  [/^interpolate-film/, "Apache-2.0 (FILM)"],
  [/^interpolate-rife/, "MIT (RIFE)"],
  [/^music-ace-step/, "Apache-2.0 (ACE-Step 1.5)"],
  [/^v2a-mmaudio/, "CC-BY-NC-4.0 (MMAudio weights: NON-COMMERCIAL)"],
  [/^selftest-/, "n/a (no model; ComfyUI core nodes)"],
];

export const UNKNOWN_LICENCE = "Not recorded yet: check the model card before using it commercially";

/** A workflow's licence: the manifest's, else the earlier table's, else unknown. */
export function workflowLicence(wf: Pick<LicenceWorkflowInput, "id" | "license">): string {
  return wf.license?.trim() || EARLIER_LICENCES.find(([re]) => re.test(wf.id))?.[1] || UNKNOWN_LICENCE;
}

/** What a licence text means for using the results: its flags, the countries it leaves out, its notices. */
export function licenceTerms(text: string): { flags: LicenceFlag[]; excludes?: string; notices: string[]; noWeights: boolean } {
  const noWeights = /^(n\/a|no model)\b/i.test(text.trim());
  const nonCommercial = /NON-COMMERCIAL/.test(text) || /^CC-BY-NC/.test(text.trim());
  const excludes = /\bEXCLUDES\s+([^);]+)/.exec(text)?.[1].trim();
  const conditional = /Community License|OpenRAIL|Model Use License|CogVideoX License|SAM License|DINOv3 License|Terms of Use|free below|below US\$/i.test(text);
  const flags: LicenceFlag[] = [];
  if (nonCommercial) flags.push("non-commercial");
  if (excludes) flags.push("territory");
  if (conditional && !nonCommercial && !excludes) flags.push("conditions");
  const notices = [...text.matchAll(/show (?:a |the )?"([^"]+)"/g)].map((m) => m[1]);
  return { flags, excludes, notices, noWeights };
}

/** Workflow ids an endpoint names: one id, or a family (`video-concat-{n}`). */
function endpointIds(endpoint: string, workflows: LicenceWorkflowInput[]): string[] {
  if (!endpoint.includes("{")) return [endpoint];
  const re = new RegExp(`^${endpoint.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "\\d+")}$`);
  return workflows.filter((w) => re.test(w.id)).map((w) => w.id);
}

function rowFor(base: Omit<LicenceRow, "licences" | "flags" | "excludes" | "notices">, licences: string[]): LicenceRow & { noWeights: boolean } {
  const terms = licences.map(licenceTerms);
  const flags = (["non-commercial", "territory", "conditions"] as const).filter((f) => terms.some((t) => t.flags.includes(f)));
  return {
    ...base,
    licences,
    // A row with a stricter catch doesn't also say "conditions".
    flags: flags.includes("conditions") && flags.length > 1 ? flags.filter((f) => f !== "conditions") : flags,
    excludes: terms.find((t) => t.excludes)?.excludes,
    notices: [...new Set(terms.flatMap((t) => t.notices))],
    noWeights: terms.every((t) => t.noWeights),
  };
}

/**
 * Every open model and its licence: one row per catalog model that runs on ComfyUI (in catalog
 * order), then the library's workflows no model uses yet. Tools with no weights are listed by
 * name only; ComfyUI's self-tests are left out.
 */
export function buildLicenceList(models: LicenceModelInput[], workflows: LicenceWorkflowInput[]): LicenceList {
  const byId = new Map(workflows.map((w) => [w.id, w]));
  const used = new Set<string>();
  const rows: LicenceRow[] = [];
  const noWeights: string[] = [];
  let noWeightsLibrary = 0;
  const add = (r: LicenceRow & { noWeights: boolean }) => {
    const { noWeights: none, ...row } = r;
    if (!none) rows.push(row);
    else if (row.inCatalog) noWeights.push(row.name);
    else noWeightsLibrary++;
  };

  for (const m of models) {
    const ids = [...new Set(m.routes.filter((r) => r.provider === "comfyui").flatMap((r) => endpointIds(r.endpoint, workflows)))];
    if (!ids.length || ids.every((id) => id.startsWith("selftest-"))) continue;
    ids.forEach((id) => used.add(id));
    const licences = [...new Set(ids.map((id) => workflowLicence(byId.get(id) ?? { id })))];
    add(rowFor({ id: m.id, name: m.name, by: m.vendor, kind: m.kind, workflows: ids, inCatalog: true }, licences));
  }
  for (const w of workflows) {
    if (used.has(w.id) || w.id.startsWith("selftest-")) continue;
    add(rowFor({ id: w.id, name: w.title, by: "Workflow library", kind: w.capability, workflows: [w.id], inCatalog: false }, [workflowLicence(w)]));
  }

  const notices = new Map<string, string[]>();
  for (const r of rows) for (const n of r.notices) notices.set(n, [...(notices.get(n) ?? []), r.name]);
  const count = (f: LicenceFlag) => rows.filter((r) => r.flags.includes(f)).length;
  return {
    rows,
    noWeights: [...new Set(noWeights)],
    noWeightsLibrary,
    notices: [...notices].map(([text, names]) => ({ text, models: names })),
    counts: { all: rows.length, clear: rows.filter((r) => !r.flags.length).length, "non-commercial": count("non-commercial"), territory: count("territory"), conditions: count("conditions") },
  };
}

const KIND_LABEL: Record<string, string> = { image: "Image", video: "Video", audio: "Audio", text: "Text", model3d: "3D" };

/** A model's media kind, or a library workflow's capability, in words. */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const FLAG_LABEL: Record<LicenceFlag, string> = {
  "non-commercial": "Non-commercial",
  territory: "Not everywhere",
  conditions: "Conditions apply",
};
