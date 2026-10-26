// The canvas Video concatenator on the open engine, end to end against a live ComfyUI (r4/canvas-plus).
// Usage: node tests/e2e/comfyui-canvas-concat.mjs [appUrl]   (app running with ComfyUI reachable; no cloud keys needed)
// Through the canvas API (/api/uploads → POST /api/canvases → POST /api/canvases/:id/run → poll → download):
// three clips made here with ffmpeg (different sizes, frame rates and sound: one with a tone, one without sound,
// one with a tone that the node mutes) are reordered, cut and framed to 9:16 by video-fit-clip (one CPU pass each),
// then joined packet by packet by video-concat-encoded. The film is probed: 720x1280, 30 fps, the kept frames of
// every clip in the order picked, and sound only where it was kept. Every step is model-free.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const app = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-canvas-concat-"));
for (const tool of ["ffprobe", "ffmpeg"]) if (spawnSync(tool, ["-version"]).status !== 0) throw new Error(`${tool} is needed on PATH`);

/** A test clip: a moving pattern at w x h and fps for `seconds`, with a tone (Hz) or no sound at all. */
function clip(name, { w, h, fps, seconds, tone }) {
  const file = path.join(tmp, name);
  const args = ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=${fps}:duration=${seconds}`];
  if (tone) args.push("-f", "lavfi", "-i", `sine=frequency=${tone}:sample_rate=44100:duration=${seconds}`, "-ac", "2", "-c:a", "aac");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", file);
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${r.stderr}`);
  return file;
}

async function upload(file) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "video/mp4" }), path.basename(file));
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  const up = await res.json();
  if (!res.ok) throw new Error(`upload ${file}: ${up.error}`);
  return up.url;
}

const json = async (p, init) => {
  const res = await fetch(app + p, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${p}: ${body.error}`);
  return body;
};

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,sample_rate,channels:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    duration: Number(j.format?.duration ?? 0),
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: num / (den || 1), frames: Number(v.nb_read_frames) } : null,
    audio: a ? { codec: a.codec_name, rate: Number(a.sample_rate), channels: a.channels } : null,
  };
}

/** RMS level (dB) of a stretch of a file's sound. */
function level(file, start, seconds) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(start), "-t", String(seconds), "-i", file, "-vn", "-ac", "1", "-f", "f32le", "-"], { maxBuffer: 64 * 2 ** 20 });
  if (r.status !== 0) throw new Error(`ffmpeg audio ${file}: ${r.stderr}`);
  const s = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
  let sum = 0;
  for (const x of s) sum += x * x;
  return 10 * Math.log10(sum / Math.max(1, s.length) + 1e-12);
}

function check(label, cond, detail) {
  if (!cond) throw new Error(`${label}: ${detail}`);
  console.log(`  ${label}: ${detail}`);
}

try {
  const files = [
    clip("tone-16x9.mp4", { w: 640, h: 360, fps: 24, seconds: 3, tone: 440 }),
    clip("silent-9x16.mp4", { w: 360, h: 640, fps: 25, seconds: 2.5 }),
    clip("tone-4x3.mp4", { w: 640, h: 480, fps: 30, seconds: 4, tone: 880 }),
  ];
  const urls = [];
  for (const f of files) urls.push(await upload(f));
  const n = (id, type, data, x, y) => ({ id, type, position: { x, y }, data });
  // Play order: the silent clip, the tone cut to 0.5–2.5 s, then the 4:3 clip cut to 1–3 s and muted.
  const graph = {
    nodes: [
      n("a", "video-input", { url: urls[0], label: "Tone" }, 0, 0),
      n("b", "video-input", { url: urls[1], label: "Silent" }, 0, 320),
      n("c", "video-input", { url: urls[2], label: "Muted" }, 0, 640),
      n("film", "concat", { label: "Film", modelId: "oss-join-encoded", params: { aspectRatio: "9:16" }, order: ["b", "a", "c"], clips: { a: { start: 0.5, end: 2.5 }, c: { start: 1, end: 3, mute: true } } }, 420, 300),
    ],
    edges: ["a", "b", "c"].map((s) => ({ id: `e-${s}`, source: s, sourceHandle: "out", target: "film", targetHandle: "videos" })),
  };
  const canvas = await json("/api/canvases", { method: "POST", body: JSON.stringify({ name: "Concatenator live check", graph }) });
  const run = await json(`/api/canvases/${canvas.id}/run`, { method: "POST", body: JSON.stringify({}) });
  check("one pipeline", run.ran.length === 1 && run.items.length === 4, `${run.items.length} jobs: ${run.items.map((g) => g.modelId).join(", ")}; price ${run.costUsd}`);
  const out = run.canvas.runs.film.out;
  const t0 = Date.now();
  let g;
  for (;;) {
    g = await json(`/api/generations/${out}`);
    if (g.status === "succeeded") break;
    if (g.status === "failed" || g.status === "canceled") throw new Error(`film: ${g.status} — ${g.error}`);
    if (Date.now() - t0 > 600_000) throw new Error(`film: timed out (${g.status} ${g.message ?? ""})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const steps = await Promise.all(run.items.map((x) => json(`/api/generations/${x.id}`)));
  check("on ComfyUI", steps.every((x) => x.provider === "comfyui" && x.status === "succeeded"), steps.map((x) => `${x.modelId} ${x.provider} ${x.status}`).join(", "));
  const video = g.outputs.find((o) => o.kind === "video");
  const local = path.join(tmp, "film.mp4");
  fs.writeFileSync(local, Buffer.from(await (await fetch(app + video.url)).arrayBuffer()));
  const p = probe(local);
  // 2.5 s + 2 s + 2 s at 30 fps.
  check("frame and rate", p.video?.width === 720 && p.video.height === 1280 && Math.abs(p.video.fps - 30) < 0.01, `${p.video?.width}x${p.video?.height} at ${p.video?.fps} fps, ${p.video?.codec}`);
  check("kept frames", Math.abs(p.video.frames - 195) <= 2, `${p.video.frames} frames (75 + 60 + 60 expected), ${p.duration.toFixed(3)} s in ${Date.now() - t0} ms`);
  check("sound track", !!p.audio, `${p.audio?.codec} ${p.audio?.rate} Hz × ${p.audio?.channels}`);
  const [silent, tone, muted] = [level(local, 0.4, 1.6), level(local, 2.8, 1.4), level(local, 4.9, 1.4)];
  check("sound only where kept", tone > -30 && silent < -60 && muted < -60, `silent clip ${silent.toFixed(1)} dB, tone ${tone.toFixed(1)} dB, muted clip ${muted.toFixed(1)} dB`);
  console.log(`\nThe open-engine Video concatenator works end to end (files in ${tmp}).`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
}
