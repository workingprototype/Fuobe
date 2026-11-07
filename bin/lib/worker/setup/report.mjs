// The site's answer to this PC's files, in plain words (setup/main.mjs). The site says which workflows the PC can run
// now and, for each lane, what it lacks (PUT /api/gpu/computer/inventory, src/lib/lanes.ts lanesFor). This adds, from the
// worker's own copy of the catalog, each missing file's folder and size and the workflows' names, grouped by lane so the
// list reads by model family. Pure: no files, no network.
import crypto from "node:crypto";

const GB = 2 ** 30;
/** As src/lib/lanes.ts: files over 2 GB name a workflow's lane; a 3% allowance under a whole GB of VRAM. */
const BIG_FILE_BYTES = 2 * GB;
const VRAM_TOLERANCE = 0.03;
const SMALL_LANE = "small";
/** As src/lib/lanes.ts MEDIA_LOADERS: the node types that read a clip or a sound file. */
const MEDIA_LOADERS = {
  video: ["LoadVideo", "VHS_LoadVideo", "VHS_LoadVideoPath", "VHS_LoadVideoFFmpeg", "VHS_LoadVideoFFmpegPath"],
  audio: ["LoadAudio", "VHS_LoadAudio", "VHS_LoadAudioUpload"],
};

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** A workflow's lane, as src/lib/lanes.ts laneOf names it (the tests check they agree). */
export function laneKey(index, id) {
  const wf = index.workflows[id];
  const big = wf.files
    .map((k) => index.files[k])
    .filter((f) => f && f.sizeBytes > BIG_FILE_BYTES)
    .map((f) => `${f.folder}/${f.file}`)
    .sort();
  return big.length ? sha(big.join("\n")).slice(0, 12) : SMALL_LANE;
}

/** The kinds of input file a workflow reads besides pictures (src/lib/lanes.ts mediaOf). */
export function mediaKinds(wf) {
  const classes = new Set([...(wf.core ?? []), ...Object.values(wf.packs ?? {}).flat()]);
  return ["video", "audio"].filter((k) => MEDIA_LOADERS[k].some((c) => classes.has(c)));
}

export const sizeWords = (bytes) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : bytes >= 2 ** 20 ? `${Math.round(bytes / 2 ** 20)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const hasFile = (inv, f) => (inv.files ?? []).some((x) => x.folder === f.folder && x.name === f.file && x.size === f.sizeBytes && (!f.sha256 || x.sha256 === f.sha256));

/**
 * The report: { site, at, total, canRun, runnable: [{ id, title }], groups: [{ lane, label, workflows: [{ id, title,
 * files, packs, inputs }], files: [{ folder, name, sizeBytes }], packs, inputs, nodes, bytes }], tooBig: [{ id, title,
 * vramGb }] }. `answer`: the site's ({ workflows, missing: [{ lane, label, files, bytes }] }); `index`: requirements.json;
 * `inv`: the inventory sent; `titles`: { id → name }; `vramMb`: the card's memory (0: unknown).
 */
export function buildReport({ answer, index, inv, titles = {}, vramMb = 0, site = "", at = new Date().toISOString() }) {
  const can = new Set(answer?.workflows ?? []);
  const siteLanes = new Map((answer?.missing ?? []).map((m) => [m.lane, m]));
  const title = (id) => titles[id] ?? id;
  const ids = Object.keys(index.workflows).filter((id) => !index.workflows[id].isolated);
  const packsHere = new Set((inv?.nodePacks ?? []).map((p) => p.name));
  const takes = new Set(inv?.media ?? ["image"]);
  const groups = new Map();
  const tooBig = [];
  for (const id of ids) {
    if (can.has(id)) continue;
    const wf = index.workflows[id];
    if (vramMb > 0 && (wf.vramGb ?? 0) * 1024 * (1 - VRAM_TOLERANCE) > vramMb) {
      tooBig.push({ id, title: title(id), vramGb: wf.vramGb });
      continue;
    }
    const files = wf.files
      .map((k) => index.files[k])
      .filter((f) => f && !hasFile(inv ?? {}, f))
      .map((f) => ({ folder: f.folder, name: f.file, sizeBytes: f.sizeBytes }));
    const packs = Object.keys(wf.packs ?? {}).filter((p) => !packsHere.has(p)).sort();
    const inputs = mediaKinds(wf).filter((k) => !takes.has(k));
    const lane = laneKey(index, id);
    const g = groups.get(lane) ?? { lane, label: siteLanes.get(lane)?.label ?? (lane === SMALL_LANE ? "Small jobs" : lane), workflows: [], files: new Map(), packs: new Set(), inputs: new Set(), nodes: new Set() };
    g.workflows.push({ id, title: title(id), files, packs, inputs });
    for (const f of files) g.files.set(`${f.folder}/${f.name}`, f);
    for (const p of packs) g.packs.add(p);
    for (const k of inputs) g.inputs.add(k);
    // What only the site knows: node types its ComfyUI didn't load.
    for (const item of siteLanes.get(lane)?.files ?? []) if (item.startsWith("node:")) g.nodes.add(item.slice(5));
    groups.set(lane, g);
  }
  const list = [...groups.values()].map((g) => {
    const files = [...g.files.values()].sort((a, b) => b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name));
    return { lane: g.lane, label: g.label, workflows: g.workflows.sort((a, b) => a.title.localeCompare(b.title)), files, packs: [...g.packs].sort(), inputs: [...g.inputs].sort(), nodes: [...g.nodes].sort(), bytes: files.reduce((s, f) => s + f.sizeBytes, 0) };
  });
  // Easiest first: the fewest bytes to add, then the most workflows it opens.
  list.sort((a, b) => a.bytes - b.bytes || b.workflows.length - a.workflows.length || a.label.localeCompare(b.label));
  return {
    site,
    at,
    total: ids.length,
    canRun: can.size,
    runnable: [...can].sort().map((id) => ({ id, title: title(id) })),
    groups: list,
    tooBig: tooBig.sort((a, b) => a.title.localeCompare(b.title)),
  };
}

const INPUT_WORDS = { video: "clips (needs ffmpeg)", audio: "sound (needs ffmpeg)" };

/** One line for a group: its label, how many workflows, and what it needs. */
function groupLine(g) {
  const needs = [];
  if (g.files.length) needs.push(`${g.files.length} file${g.files.length === 1 ? "" : "s"} (${sizeWords(g.bytes)})`);
  if (g.packs.length) needs.push(`${g.packs.length} node pack${g.packs.length === 1 ? "" : "s"}`);
  if (g.nodes.length) needs.push(`${g.nodes.length} node type${g.nodes.length === 1 ? "" : "s"} that didn't load`);
  if (g.inputs.length) needs.push(g.inputs.map((k) => INPUT_WORDS[k] ?? k).join(", "));
  return `${g.label}: ${g.workflows.length} workflow${g.workflows.length === 1 ? "" : "s"}, needs ${needs.join(" + ") || "a check on the site"}`;
}

/** The short version for the screen: the count, then up to `max` groups, one line each. */
export function screenLines(r, max = 12) {
  const lines = [`This PC can run ${r.canRun} of the site's ${r.total} workflows now.`];
  if (r.groups.length) {
    lines.push("", "To run more, add what each group needs (easiest first):");
    for (const g of r.groups.slice(0, max)) lines.push(`  - ${groupLine(g)}`);
    if (r.groups.length > max) lines.push(`  ... and ${r.groups.length - max} more groups in the full report.`);
  }
  if (r.tooBig.length) lines.push("", `${r.tooBig.length} workflow${r.tooBig.length === 1 ? " needs" : "s need"} a graphics card with more memory than this one.`);
  return lines;
}

/** The full readable report, for the text file next to the setup log. */
export function reportText(r) {
  const out = [`Fuobe worker: what this PC can run`, `Site: ${r.site}`, `Checked: ${r.at}`, "", `This PC can run ${r.canRun} of the site's ${r.total} workflows now.`, ""];
  if (r.runnable.length) {
    out.push("It can run:");
    for (const w of r.runnable) out.push(`  - ${w.title} (${w.id})`);
    out.push("");
  }
  if (r.groups.length) {
    out.push("What is missing, by model family (easiest first). Put each file in the named folder of a model folder.", "");
    for (const g of r.groups) {
      out.push(`== ${groupLine(g)}`);
      if (g.files.length) {
        out.push("   Files:");
        for (const f of g.files) out.push(`     ${f.folder}/${f.name}  (${sizeWords(f.sizeBytes)})`);
      }
      if (g.packs.length) out.push(`   Node packs (in ComfyUI's custom_nodes): ${g.packs.join(", ")}`);
      if (g.nodes.length) out.push(`   Node types that didn't load in ComfyUI: ${g.nodes.join(", ")}`);
      if (g.inputs.length) out.push(`   Inputs: ${g.inputs.map((k) => INPUT_WORDS[k] ?? k).join(", ")}`);
      out.push("   Workflows:");
      for (const w of g.workflows) {
        const own = [w.files.length ? `${w.files.length} file${w.files.length === 1 ? "" : "s"}` : "", w.packs.length ? w.packs.join(", ") : ""].filter(Boolean).join("; ");
        out.push(`     - ${w.title} (${w.id})${own && (w.files.length !== g.files.length || w.packs.length !== g.packs.length) ? `: needs ${own}` : ""}`);
      }
      out.push("");
    }
  }
  if (r.tooBig.length) {
    out.push("Needs a graphics card with more memory:");
    for (const w of r.tooBig) out.push(`  - ${w.title} (${w.id}): ${w.vramGb} GB`);
    out.push("");
  }
  return `${out.join("\n")}\n`;
}

/** The site's refusal in plain words: `status` and its JSON body. */
export function siteRefusal(status, body = {}) {
  const said = typeof body?.error === "string" ? body.error : "";
  if (status === 401) return "The site doesn't know this token. Copy it again from the site's Workers page (Settings → Workers), or add a new worker there.";
  if (status === 403 && /Only a worker/i.test(said)) return "This token is for a person's own ComfyUI (Fuobe Connect), not for a shared worker. Add a worker on the site's Workers page and use its token.";
  if (status === 429) return "The site is busy right now. Run this setup again in a minute.";
  if (status === 409 && said) return said;
  return `The site answered with an error (HTTP ${status})${said ? `: ${said}` : ""}.`;
}
