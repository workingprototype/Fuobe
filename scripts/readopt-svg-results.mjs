#!/usr/bin/env node
/**
 * Results that are real SVGs but were stored as application/octet-stream (.bin) before an account could keep an SVG
 * result (an account's "Image to vector" run): each is made an image/svg+xml file again, so the run card, the delivery
 * page and the Library show it.
 *
 *   node scripts/readopt-svg-results.mjs           # dry run: lists what it would change, changes nothing
 *   node scripts/readopt-svg-results.mjs --apply   # changes them
 *
 * The data folder is FUOBE_DATA_DIR, or ./data. Safe while the server runs. Only a file that passes the same check a
 * new SVG result passes (src/server/svg-file.ts: UTF-8, an <svg> root in the SVG namespace, nothing active in it) is
 * changed; any other .bin stays as it is. The asset keeps its id, owner, hold and checks: its file is renamed from .bin
 * to .svg, its row says image/svg+xml, and every run's outputs and inputs that named the old URL name the new one.
 * Prints ids and paths only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";

// Node reads src/ as ES modules after a first look: that note is expected here.
process.removeAllListeners("warning");
process.on("warning", (w) => (w.name !== "Warning" || !/Module type of/.test(w.message) ? console.warn(`${w.name}: ${w.message}`) : undefined));

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { isSvgFile } = await import(pathToFileURL(path.join(ROOT, "src", "server", "svg-file.ts")).href);

const apply = process.argv.includes("--apply");
const dir = path.resolve(process.env.FUOBE_DATA_DIR ?? path.join(process.cwd(), "data"));
const dbFile = path.join(dir, "fuobe.db");
const filesDir = path.join(dir, "files");

function fail(message) {
  console.error(`readopt-svg-results: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(dbFile)) fail(`no database at ${dbFile}: set FUOBE_DATA_DIR to the data folder`);

const db = new Database(dbFile);
db.pragma("busy_timeout = 5000");

const fileUrl = (rel) => `/api/files/${rel.split(path.sep).join("/").split("\\").join("/")}`;
const inFiles = (rel) => {
  const abs = path.resolve(filesDir, rel);
  return abs.startsWith(filesDir + path.sep) ? abs : null;
};

/** Every output of a run that is an octet-stream .bin asset: its asset row, when its file is a checked SVG. */
const gens = db.prepare("SELECT id, outputs_json FROM generations WHERE instr(outputs_json, 'application/octet-stream') > 0").all();
const getAsset = db.prepare("SELECT id, rel_path, content_type, generation_id FROM assets WHERE id = ?");
const found = new Map();
let skipped = 0;
for (const g of gens) {
  let outputs;
  try {
    outputs = JSON.parse(g.outputs_json);
  } catch {
    continue;
  }
  if (!Array.isArray(outputs)) continue;
  for (const o of outputs) {
    if (!o || o.contentType !== "application/octet-stream" || typeof o.assetId !== "string" || found.has(o.assetId)) continue;
    const a = getAsset.get(o.assetId);
    if (!a || a.content_type !== "application/octet-stream" || !/\.bin$/.test(a.rel_path)) continue;
    const abs = inFiles(a.rel_path);
    if (!abs || !isSvgFile(abs)) {
      skipped++;
      continue;
    }
    found.set(a.id, { asset: a, abs, generationId: g.id });
  }
}

console.log(`${found.size} SVG result(s) stored as .bin${skipped ? `; ${skipped} other .bin result(s) left as they are` : ""}${apply ? "" : " (dry run: --apply changes them)"}`);

const runsNaming = db.prepare("SELECT id, outputs_json, request_json FROM generations WHERE instr(outputs_json, ?) > 0 OR instr(request_json, ?) > 0");
const setRun = db.prepare("UPDATE generations SET outputs_json = ?, request_json = ? WHERE id = ?");
const setAsset = db.prepare("UPDATE assets SET rel_path = ?, content_type = 'image/svg+xml', kind = 'image' WHERE id = ? AND rel_path = ? AND content_type = 'application/octet-stream'");

let changed = 0;
for (const { asset, abs, generationId } of found.values()) {
  const rel = asset.rel_path.replace(/\.bin$/, ".svg");
  const from = fileUrl(asset.rel_path);
  const to = fileUrl(rel);
  console.log(`${apply ? "changing" : "would change"} run ${generationId} asset ${asset.id}: ${from} -> ${to}`);
  if (!apply) continue;
  const dest = inFiles(rel);
  if (!dest || fs.existsSync(dest)) {
    console.warn(`  skipped: ${to} is there already`);
    continue;
  }
  fs.renameSync(abs, dest);
  try {
    db.transaction(() => {
      if (setAsset.run(rel, asset.id, asset.rel_path).changes !== 1) throw new Error("the asset changed meanwhile");
      for (const r of runsNaming.all(from, from)) {
        const outputs = JSON.parse(r.outputs_json.split(from).join(to));
        for (const o of Array.isArray(outputs) ? outputs : []) {
          if (o && (o.assetId === asset.id || o.url === to)) Object.assign(o, { url: to, kind: "image", contentType: "image/svg+xml" });
        }
        setRun.run(JSON.stringify(outputs), r.request_json.split(from).join(to), r.id);
      }
    })();
    changed++;
  } catch (e) {
    fs.renameSync(dest, abs);
    console.warn(`  skipped: ${e.message}`);
  }
}
if (apply) console.log(`${changed} changed`);
db.close();
