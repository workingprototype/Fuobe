// Inputs on their way to the server: local files are uploaded once per run (POST /api/uploads, the
// same route the studios use) and remembered in uploads.json so a resumed run doesn't send them again;
// clips are probed with ffprobe so studio routes get the length, frame rate and size they ask for.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isRemote } from "./paths.mjs";
import { readJson, writeJson } from "./store.mjs";

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
};

export const contentType = (file) => TYPES[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";

/** Every local file a job sends (inputs and a training case's photos are handled apart). */
export function localInputs(inputs) {
  return Object.values(inputs ?? {})
    .flat()
    .filter((v) => typeof v === "string" && !isRemote(v));
}

/** Uploads through the server, cached by path + size + mtime in <runDir>/uploads.json. */
export function uploader(client, runDir, { dry = false, log = () => {} } = {}) {
  const cacheFile = runDir ? path.join(runDir, "uploads.json") : null;
  const cache = (cacheFile && readJson(cacheFile, {})) || {};
  const pending = new Map();
  const keyOf = (abs) => {
    const st = fs.statSync(abs);
    return `${abs}|${st.size}|${Math.round(st.mtimeMs)}`;
  };
  return {
    /** The /api/files/… URL for a local file (a link or server file stays as it is). */
    async url(ref) {
      if (isRemote(ref)) return ref;
      // A dry run prices with stand-ins and sends nothing.
      if (dry) return `/api/files/uploads/estimate/${path.basename(ref)}`;
      const key = keyOf(ref);
      if (cache[key]) return cache[key];
      // The same file twice in one request (a clip joined to itself) goes up once.
      if (!pending.has(key)) pending.set(key, send(ref, key).finally(() => pending.delete(key)));
      return pending.get(key);
    },
    /** The same inputs with every local path replaced by its URL. */
    async inputs(inputs) {
      const out = {};
      for (const [slot, v] of Object.entries(inputs ?? {})) out[slot] = Array.isArray(v) ? await Promise.all(v.map((x) => this.url(x))) : await this.url(v);
      return out;
    },
  };
  /** Upload one file and remember its URL. */
  async function send(ref, key) {
    const type = contentType(ref);
    const blob = typeof fs.openAsBlob === "function" ? await fs.openAsBlob(ref, { type }) : new Blob([fs.readFileSync(ref)], { type });
    const form = new FormData();
    form.append("file", blob, path.basename(ref));
    log(`Uploading ${path.basename(ref)}`);
    const asset = await client.request("POST", "/api/uploads", { form });
    cache[key] = asset.url;
    if (cacheFile) writeJson(cacheFile, cache);
    return asset.url;
  }
}

/** ffprobe's facts about a clip: {duration, fps, width, height, hasAudio}, or {} when ffprobe isn't there. */
export function probeClip(file) {
  if (!file || isRemote(file)) return {};
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return {};
  try {
    const j = JSON.parse(r.stdout);
    const video = (j.streams ?? []).find((s) => s.codec_type === "video");
    const rate = (s) => {
      const [n, d] = String(s ?? "0/1").split("/").map(Number);
      return d ? n / d : 0;
    };
    const fps = video ? rate(video.avg_frame_rate) || rate(video.r_frame_rate) : 0;
    const duration = Number(j.format?.duration);
    return {
      ...(duration > 0 && { duration: Math.round(duration * 1000) / 1000 }),
      ...(fps > 0 && { fps: Math.round(fps * 1000) / 1000 }),
      ...(video?.width && { width: video.width, height: video.height }),
      hasAudio: (j.streams ?? []).some((s) => s.codec_type === "audio"),
    };
  } catch {
    return {};
  }
}

const TOKEN = /\{\{\s*([\w.:-]+)\s*\}\}/g;

/**
 * Fill a studio route's body template. A string that is one token takes the value's own type
 * ("{{seed}}" → 1001); "{{source:inputs.video}}" is the clip as studios take it ({url, name,
 * duration, fps, width, height, hasAudio}); other tokens are read from `vars` by their dotted path.
 */
export function fillTemplate(value, vars) {
  const lookup = (name) => {
    if (name.startsWith("source:")) return vars.sources?.[name.slice(7)];
    return name.split(".").reduce((o, k) => (o == null ? undefined : o[k]), vars);
  };
  if (typeof value === "string") {
    const whole = /^\{\{\s*([\w.:-]+)\s*\}\}$/.exec(value);
    if (whole) {
      const v = lookup(whole[1]);
      if (v === undefined) throw new Error(`The route body names {{${whole[1]}}}, which this case doesn't have`);
      return v;
    }
    return value.replace(TOKEN, (_, name) => {
      const v = lookup(name);
      if (v === undefined) throw new Error(`The route body names {{${name}}}, which this case doesn't have`);
      return String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, vars)]));
  return value;
}

/**
 * A requestId for a studio route (8–64 characters). The same job and attempt get the same one, so a run
 * interrupted mid-submit doesn't start a pipeline twice; a retry of a failed job is a new attempt.
 */
export const requestIdFor = (runId, jobId, attempt = 1) => `eval-${crypto.createHash("sha256").update(`${runId}/${jobId}/${attempt}`).digest("hex").slice(0, 24)}`;
