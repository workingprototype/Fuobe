#!/usr/bin/env node
/**
 * Builds the preset cards' preview media (camera motions, effects, apps) from rendered masters: a
 * poster still and a short muted loop per preset, with content-hashed names, plus the manifest the
 * cards read them from (previewFor() in src/lib/preset-card-data.ts → `media` on each card's preview;
 * src/lib/preview-media.ts names the files).
 *
 * Masters stay outside the repo, one folder per preset id:
 *   <masters>/<preset id>/clip.mp4     the rendered clip (any size, centre-cropped to 4:3; audio is dropped)
 *   <masters>/<preset id>/meta.json    optional: {"posterTime": seconds, "kind": "wipe" | "motion" | …}
 * Folders without a clip.mp4 (still rendering) are skipped; start.png, end.png and the other render
 * inputs next to the clip aren't read. With --stills, a folder without a clip.mp4 but with a start.png
 * gets a poster-only entry (a "still": the AVIF sizes and the WebP, no mp4), listed in the manifest as
 * its hash plus "s" (isStill() in src/lib/preview-media.ts), so the site shows the picture until the clip lands.
 *
 * Output, for every id with a clip (kind = motions | effects | apps, from the id's prefix):
 *   public/previews/<kind>/<id>.<hash8>.<320|480|640>.avif   the poster
 *   public/previews/<kind>/<id>.<hash8>.480.webp             the poster for browsers without AVIF
 *   public/previews/<kind>/<id>.<hash8>.mp4                  480×360 H.264, 24 fps, no audio, loops seamlessly
 *   src/lib/catalog/preview-media.generated.json             { "<kind>": { "<id>": "<hash8>" } }, keys sorted
 *
 * The poster is the clip's frame at meta.posterTime (else at 62 % of the clip); the clip's last frames
 * are crossfaded into its first ones, so the loop has no seam. hash8 is the first 8 hex digits of the
 * SHA-256 of the master files read and of the encode recipe below (its settings and the code that
 * applies them), so a new master or recipe gets new names (public/previews is served as immutable,
 * see next.config.ts; a recipe change renames every preset's files). Unchanged masters are skipped, a
 * rebuilt id loses its old files, and the manifest lists every id whose files are all in
 * public/previews: delete an id's files and run again to drop it.
 *
 * Run: node scripts/build-previews.mjs --masters <dir> [--stills]   (or set FUOBE_PREVIEW_MASTERS; --jobs N in parallel)
 * Needs ffmpeg and ffprobe on PATH, built with libx264, libaom and libwebp.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "public", "previews");
const MANIFEST = path.join(root, "src", "lib", "catalog", "preview-media.generated.json");

/** Preset id prefix → folder under public/previews (kindOf() in src/lib/preview-media.ts is the same rule). */
const KINDS = { motion: "motions", effect: "effects", app: "apps" };

const FPS = 24;
const W = 480;
const H = 360;
/** Poster widths (AVIF); the WebP fallback is 480 wide. previewSrc() in src/lib/preview-media.ts expects these. */
const POSTER_WIDTHS = [320, 480, 640];
const WEBP_WIDTH = 480;
/** Frames at the end of the clip crossfaded into its first ones. */
const LOOP_FADE = 6;
/** Where the poster is taken when meta.json doesn't say, as a share of the clip. */
const POSTER_AT = 0.62;
/** Longer masters are cut here (cards loop 3–4 s). */
const MAX_SECONDS = 6;
/** The media spec's budget for one 4:3 card (posters + clip), for the summary. */
const BUDGET_KB = 162;

// The clip is BT.709 (limited range). AVIF posters are tagged sRGB with a BT.709 matrix (full range),
// so they render like the WebP one, which is always BT.601 limited range.
const X264 = ["-c:v", "libx264", "-preset", "veryslow", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "27", "-maxrate", "700k", "-bufsize", "1400k", "-g", "48"];
const VIDEO_COLOR = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const AVIF_SCALE = "out_color_matrix=bt709:out_range=pc,format=yuv420p,setparams=color_primaries=bt709:color_trc=iec61966-2-1";
const WEBP_SCALE = "out_color_matrix=bt601:out_range=tv,format=yuv420p";
const AVIF = ["-c:v", "libaom-av1", "-still-picture", "1", "-crf", "32", "-b:v", "0", "-cpu-used", "4"];
const WEBP = ["-c:v", "libwebp", "-quality", "78", "-compression_level", "6"];
/**
 * Everything that shapes the files, hashed with the masters so a new recipe gets new names: the
 * settings above and the functions that apply them (keep anything else that shapes the files in one
 * of these). Their source is hashed with LF line ends, so a CRLF checkout gets the same names.
 */
const CODE = [probe, posterAt, posters, seamless, loop].map((f) => String(f).replace(/\r\n/g, "\n"));
const RECIPE = JSON.stringify({ FPS, W, H, POSTER_WIDTHS, WEBP_WIDTH, LOOP_FADE, POSTER_AT, MAX_SECONDS, X264, VIDEO_COLOR, AVIF_SCALE, WEBP_SCALE, AVIF, WEBP, CODE });

const USAGE = "usage: node scripts/build-previews.mjs --masters <dir> [--stills] [--jobs N]   (or set FUOBE_PREVIEW_MASTERS)";
let opts;
try {
  opts = parseArgs({ options: { masters: { type: "string" }, jobs: { type: "string" }, stills: { type: "boolean" } } }).values;
} catch (e) {
  console.error(`${e instanceof Error ? e.message : e}\n${USAGE}`);
  process.exit(2);
}
const masters = opts.masters ?? process.env.FUOBE_PREVIEW_MASTERS;
if (!masters || !fs.statSync(masters, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`${USAGE}${masters ? `\nno such folder: ${masters}` : ""}`);
  process.exit(2);
}
const jobs = Math.max(1, Number(opts.jobs) || Math.min(4, Math.ceil(os.availableParallelism() / 4)));

/** The files of one preset's media (a still has no mp4). */
const filesOf = (id, hash, still = false) => [...POSTER_WIDTHS.map((w) => `${id}.${hash}.${w}.avif`), `${id}.${hash}.${WEBP_WIDTH}.webp`, ...(still ? [] : [`${id}.${hash}.mp4`])];
const sizeOf = (file) => fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
const kb = (bytes) => Math.round(bytes / 1024);

/** Run a command; resolves with its stdout, rejects with the end of its stderr. */
function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true });
    const out = [];
    const err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} exited with ${code}: ${Buffer.concat(err).toString().trim().split(/\r?\n/).slice(-2).join(" | ")}`));
    });
    if (input) {
      p.stdin.on("error", () => {}); // the close handler reports a failed run
      p.stdin.end(input);
    }
  });
}

async function probe(file) {
  const j = JSON.parse((await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration:format=duration", "-of", "json", file])).toString());
  if (!j.streams?.length) throw new Error("no video stream");
  const duration = Number(j.streams[0].duration ?? j.format?.duration);
  if (!(duration > 0)) throw new Error("unknown duration");
  return { duration: Math.min(duration, MAX_SECONDS), cut: duration > MAX_SECONDS + 0.05 };
}

/** Where the poster is taken, in seconds: meta.posterTime, else POSTER_AT of the clip, kept inside the clip. */
function posterAt(meta, duration) {
  const wanted = Number.isFinite(meta.posterTime) ? meta.posterTime : duration * POSTER_AT;
  return Math.min(Math.max(0, wanted), Math.max(0, duration - 1 / FPS));
}

/** The poster at `at` seconds: one decode, split into the AVIF sizes and the WebP. */
async function posters(clip, at, parts) {
  const outs = [...POSTER_WIDTHS.map((w) => ["avif", w]), ["webp", WEBP_WIDTH]];
  const scale = (fmt, w) => `scale=${w}:${(w * 3) / 4}:flags=lanczos:${fmt === "avif" ? AVIF_SCALE : WEBP_SCALE}`;
  const graph = `[0:v]crop='min(iw,ih*4/3)':'min(ih,iw*3/4)',split=${outs.length}${outs.map((_, i) => `[s${i}]`).join("")};${outs.map(([fmt, w], i) => `[s${i}]${scale(fmt, w)}[o${i}]`).join(";")}`;
  await run("ffmpeg", [
    "-v", "error", "-y", "-ss", at.toFixed(3), "-i", clip, "-filter_complex", graph,
    ...outs.flatMap(([fmt], i) => ["-map", `[o${i}]`, "-frames:v", "1", ...(fmt === "avif" ? AVIF : WEBP), "-map_metadata", "-1", "-f", fmt, parts[i]]),
  ]);
}

/**
 * A loop without a seam: the first `fade` frames are dropped from the start and blended into the
 * last `fade` frames instead, so the clip's end runs into its new beginning.
 */
function seamless(raw, n, size, fade) {
  if (!fade) return raw.subarray(0, n * size);
  const out = Buffer.allocUnsafe((n - fade) * size);
  raw.copy(out, 0, fade * size, (n - fade) * size);
  for (let k = 0; k < fade; k++) {
    const a = (k + 1) / (fade + 1);
    const tail = (n - fade + k) * size;
    const head = k * size;
    const to = (n - 2 * fade + k) * size;
    for (let i = 0; i < size; i++) out[to + i] = Math.round(raw[tail + i] * (1 - a) + raw[head + i] * a);
  }
  return out;
}

/** The clip: decoded to 480×360 frames at 24 fps, looped, encoded without audio. */
async function loop(clip, part) {
  const size = W * H * 1.5;
  const raw = await run("ffmpeg", [
    "-v", "error", "-i", clip, "-t", String(MAX_SECONDS), "-an", "-sn", "-dn",
    "-vf", `fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos:out_color_matrix=bt709:out_range=tv,crop=${W}:${H},setsar=1,format=yuv420p`,
    "-f", "rawvideo", "-pix_fmt", "yuv420p", "-",
  ]);
  const n = Math.floor(raw.length / size);
  if (n < 2) throw new Error("the clip has no frames");
  const fade = Math.min(LOOP_FADE, Math.floor(n / 4));
  await run(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", `${W}x${H}`, "-r", String(FPS), ...VIDEO_COLOR, "-i", "-", ...X264, "-an", "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", part],
    seamless(raw, n, size, fade),
  );
  return (n - fade) / FPS;
}

/** Remove an id's files other than `keep` (older hashes, parts of a run that died). */
function removeStale(dir, id, keep) {
  let removed = 0;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (f.startsWith(`${id}.`) && !keep.includes(f)) {
      fs.rmSync(path.join(dir, f), { force: true });
      removed++;
    }
  }
  return removed;
}

/** The master files a preset's media is made from: the clip, and meta.json when there is one. */
function readMaster(dir) {
  const used = ["clip.mp4", "meta.json"].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  const meta = used.length > 1 ? JSON.parse(fs.readFileSync(used[1], "utf8").replace(/^﻿/, "")) : {};
  const sha = crypto.createHash("sha256").update(RECIPE);
  for (const f of used) sha.update(`\0${path.basename(f)}\0`).update(fs.readFileSync(f));
  return { clip: used[0], meta: meta && typeof meta === "object" ? meta : {}, hash: sha.digest("hex").slice(0, 8) };
}

/** A still's master: start.png, hashed with the recipe (and a marker, so a still never shares a clip's names). */
function readStill(dir) {
  const file = path.join(dir, "start.png");
  const hash = crypto.createHash("sha256").update(RECIPE).update("\0still\0").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
  return { file, hash };
}

/** A poster-only entry from start.png (no clip yet). */
async function buildStill({ id, kind, dir }) {
  const outDir = path.join(OUT, kind);
  let master;
  try {
    master = readStill(dir);
  } catch (e) {
    return { id, kind, hash: "--------", files: [], still: true, status: "failed", error: `can't read start.png: ${e instanceof Error ? e.message : e}` };
  }
  const names = filesOf(id, master.hash, true);
  const files = names.map((f) => path.join(outDir, f));
  const result = { id, kind, hash: master.hash, meta: {}, files, still: true };
  if (files.every((f) => sizeOf(f) > 0)) return { ...result, status: "unchanged", stale: removeStale(outDir, id, names) };
  fs.mkdirSync(outDir, { recursive: true });
  const parts = files.map((f) => `${f}.part`);
  try {
    await posters(master.file, 0, parts);
    for (const p of parts) if (!(sizeOf(p) > 0)) throw new Error(`ffmpeg wrote nothing to ${path.basename(p)}`);
    parts.forEach((p, i) => fs.renameSync(p, files[i]));
    return { ...result, status: "built", stale: removeStale(outDir, id, names) };
  } catch (e) {
    for (const p of parts) fs.rmSync(p, { force: true });
    return { ...result, status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

async function build({ id, kind, dir }) {
  const outDir = path.join(OUT, kind);
  let master;
  try {
    master = readMaster(dir);
  } catch (e) {
    return { id, kind, hash: "--------", files: [], status: "failed", error: `can't read the master: ${e instanceof Error ? e.message : e}` };
  }
  const { clip, meta, hash } = master;
  const names = filesOf(id, hash);
  const files = names.map((f) => path.join(outDir, f));
  const result = { id, kind, hash, meta, files };
  if (files.every((f) => sizeOf(f) > 0)) return { ...result, status: "unchanged", stale: removeStale(outDir, id, names) };

  fs.mkdirSync(outDir, { recursive: true });
  const parts = files.map((f) => `${f}.part`);
  try {
    const { duration, cut } = await probe(clip);
    const at = posterAt(meta, duration);
    // Both ffmpeg runs end before the catch cleans up: when one fails, the other would still be writing
    // its .part (left behind in public/previews, or on Windows still open, so removing it throws).
    const [poster, clipRun] = await Promise.allSettled([posters(clip, at, parts.slice(0, -1)), loop(clip, parts.at(-1))]);
    for (const r of [poster, clipRun]) if (r.status === "rejected") throw r.reason;
    const seconds = clipRun.value;
    for (const p of parts) if (!(sizeOf(p) > 0)) throw new Error(`ffmpeg wrote nothing to ${path.basename(p)}`);
    parts.forEach((p, i) => fs.renameSync(p, files[i]));
    return { ...result, status: "built", seconds, at, cut, stale: removeStale(outDir, id, names) };
  } catch (e) {
    for (const p of parts) fs.rmSync(p, { force: true });
    return { ...result, status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Every id whose files are all in public/previews, by kind; `prefer` picks between two complete sets. */
function scan(prefer) {
  const manifest = {};
  for (const kind of Object.values(KINDS).sort()) {
    const dir = path.join(OUT, kind);
    if (!fs.existsSync(dir)) continue;
    const hashes = new Map();
    const stills = new Map();
    const names = fs.readdirSync(dir);
    for (const f of names) {
      const m = /^([a-z0-9-]+)\.([0-9a-f]{8})\.mp4$/.exec(f);
      if (m && kindOf(m[1]) === kind) hashes.set(m[1], [...(hashes.get(m[1]) ?? []), m[2]]);
      const s = /^([a-z0-9-]+)\.([0-9a-f]{8})\.480\.webp$/.exec(f);
      if (s && kindOf(s[1]) === kind && !names.includes(`${s[1]}.${s[2]}.mp4`)) stills.set(s[1], [...(stills.get(s[1]) ?? []), s[2]]);
    }
    const ids = {};
    // Stills first; a preset with a complete clip set is listed below with it instead.
    for (const id of [...stills.keys()].sort()) {
      const complete = stills.get(id).filter((h) => filesOf(id, h, true).every((f) => sizeOf(path.join(dir, f)) > 0));
      if (!complete.length) continue;
      const mtime = (h) => fs.statSync(path.join(dir, `${id}.${h}.480.webp`)).mtimeMs;
      const pick = complete.find((h) => `${h}s` === prefer(kind, id)) ?? complete.sort((a, b) => mtime(b) - mtime(a))[0];
      ids[id] = `${pick}s`;
    }
    for (const id of [...hashes.keys()].sort()) {
      const complete = hashes.get(id).filter((h) => filesOf(id, h).every((f) => sizeOf(path.join(dir, f)) > 0));
      if (!complete.length) continue;
      const mtime = (h) => fs.statSync(path.join(dir, `${id}.${h}.mp4`)).mtimeMs;
      const pick = complete.find((h) => h === prefer(kind, id)) ?? complete.sort((a, b) => mtime(b) - mtime(a))[0];
      if (complete.length > 1) console.warn(`  note       ${id}: ${complete.length} complete sets in public/previews/${kind}, listing ${pick}`);
      ids[id] = pick;
    }
    if (Object.keys(ids).length) manifest[kind] = Object.fromEntries(Object.entries(ids).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  return manifest;
}

const folders = fs.readdirSync(masters, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const withClip = folders.filter((id) => fs.existsSync(path.join(masters, id, "clip.mp4")));
const kindOf = (id) => KINDS[/^(motion|effect|app)-[a-z0-9-]+$/.exec(id)?.[1]];
const stillOnly = opts.stills ? folders.filter((id) => !withClip.includes(id) && fs.existsSync(path.join(masters, id, "start.png"))) : [];
const cards = [
  ...withClip.filter(kindOf).map((id) => ({ id, kind: kindOf(id), dir: path.join(masters, id) })),
  ...stillOnly.filter(kindOf).map((id) => ({ id, kind: kindOf(id), dir: path.join(masters, id), still: true })),
];
console.log(`${folders.length} master folders in ${masters}, ${withClip.length} with a clip.mp4${opts.stills ? `, ${stillOnly.length} stills (start.png only)` : ""} (${jobs} at a time)`);
for (const id of withClip.filter((id) => !kindOf(id))) console.warn(`  skipped    ${id}: not a motion-, effect- or app- preset id`);

const results = [];
const queue = [...cards];
await Promise.all(
  Array.from({ length: jobs }, async () => {
    for (let card = queue.shift(); card; card = queue.shift()) {
      const r = await (card.still ? buildStill(card) : build(card));
      results.push(r);
      const sizes = r.files.map(sizeOf);
      const sum = kb(sizes.reduce((a, b) => a + b, 0));
      const detail =
        r.status === "failed"
          ? r.error
          : `avif ${sizes.slice(0, 3).map(kb).join("/")} KB · webp ${kb(sizes[3])} KB${r.still ? " · still" : ` · mp4 ${kb(sizes[4])} KB`}` +
            (r.seconds ? ` (${r.seconds.toFixed(2)} s loop, poster at ${r.at.toFixed(2)} s${r.cut ? `, cut to ${MAX_SECONDS} s` : ""})` : "") +
            ` = ${sum} KB${sum > BUDGET_KB ? ` (over the ~${BUDGET_KB} KB budget)` : ""}`;
      console.log(`  ${r.status.padEnd(10)} ${r.id.padEnd(36)} ${r.hash}${r.meta?.kind ? ` ${r.meta.kind}` : ""}  ${detail}`);
    }
  }),
);

const built = new Map(results.filter((r) => r.status !== "failed").map((r) => [`${r.kind}/${r.id}`, r.still ? `${r.hash}s` : r.hash]));
let previous = {};
try {
  previous = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
} catch {
  // first run
}
const manifest = scan((kind, id) => built.get(`${kind}/${id}`) ?? previous[kind]?.[id]);
const text = `${JSON.stringify(manifest, null, 2)}\n`;
// A checkout may have turned the manifest's line ends into CRLF: that's not a change.
const changed = !fs.existsSync(MANIFEST) || fs.readFileSync(MANIFEST, "utf8").replace(/\r\n/g, "\n") !== text;
if (changed) fs.writeFileSync(MANIFEST, text);

const count = (s) => results.filter((r) => r.status === s).length;
const listed = Object.values(manifest).flatMap((ids) => Object.entries(ids));
const total = Object.entries(manifest).reduce((sum, [kind, ids]) => sum + Object.entries(ids).reduce((s, [id, h]) => s + filesOf(id, h.slice(0, 8), h.length > 8).reduce((t, f) => t + sizeOf(path.join(OUT, kind, f)), 0), 0), 0);
console.log(
  `built ${count("built")}, unchanged ${count("unchanged")}, failed ${count("failed")}, removed ${results.reduce((s, r) => s + (r.stale ?? 0), 0)} stale files\n` +
    `manifest ${changed ? "written" : "unchanged"}: ${Object.values(KINDS).map((k) => `${Object.keys(manifest[k] ?? {}).length} ${k}`).join(" · ")} → ${path.relative(root, MANIFEST)}\n` +
    `public/previews: ${listed.length} presets, ${kb(total)} KB${listed.length ? ` (${kb(total / listed.length)} KB each on average, budget ~${BUDGET_KB} KB)` : ""}`,
);
if (count("failed")) process.exitCode = 1;
