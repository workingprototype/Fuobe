// End-to-end check of the open engine's Ken Burns, joins and audio loops against a live ComfyUI (r4/faceless-plus).
// Usage: node tests/e2e/comfyui-faceless-plus.mjs [appUrl]   (app running with ComfyUI reachable, demo mode off or nothing else configured)
// Through Fuobe's own API (/api/uploads → POST /api/generations → poll → download), every graph model-free on CPU:
//   - Ken Burns (oss-ken-burns → kenburns-still): one eased push-in, then one move split into two linear pieces;
//   - the "Frame by frame" join (oss-join-encoded → video-concat-encoded, expanded to three clips): packets copied,
//     the frame count the sum of the clips', and the split move continuous through its seam;
//   - a music bed looped with crossfades (oss-audio-loop → audio-loop-crossfade, the fade curve written by the provider);
//   - three clips joined with crossfades (oss-audio-join → audio-join-crossfade, expanded in one prompt).
// Every output is probed with ffprobe / ffmpeg; the ComfyUI process's RSS is sampled around the join (local server only).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const app = process.argv[2] ?? "http://localhost:3000";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-faceless-plus-"));
for (const tool of ["ffprobe", "ffmpeg"]) if (spawnSync(tool, ["-version"]).status !== 0) throw new Error(`${tool} is needed on PATH`);

function comfyPid() {
  if (process.env.COMFYUI_PID) return Number(process.env.COMFYUI_PID);
  const r = spawnSync("pgrep", ["-f", `main.py.*--port ${process.env.COMFYUI_PORT ?? "8188"}`], { encoding: "utf8" });
  const pid = Number(r.stdout?.split("\n")[0]);
  return pid && fs.existsSync(`/proc/${pid}/status`) ? pid : null;
}
const rssOf = (pid) => Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024;
async function watchMemory(fn) {
  const pid = comfyPid();
  if (!pid) return { result: await fn(), peakGb: null };
  const base = rssOf(pid);
  let peak = base;
  const timer = setInterval(() => {
    try {
      peak = Math.max(peak, rssOf(pid));
    } catch {}
  }, 50);
  try {
    return { result: await fn(), peakGb: (peak - base) / 2 ** 30 };
  } finally {
    clearInterval(timer);
  }
}

/** A 640x360 still with detail to see a move in: a gradient, a grid and a bright disc right of centre. */
function still(w = 640, h = 360) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) {
      const grid = x % 40 < 2 || y % 40 < 2;
      const disc = (x - w * 0.62) ** 2 + (y - h * 0.4) ** 2 < (h * 0.12) ** 2;
      row.push(disc ? 250 : grid ? 30 : (x * 255) / w, disc ? 220 : grid ? 30 : (y * 255) / h, disc ? 40 : 150);
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

/** Stereo 16-bit PCM WAV: a tone (or noise with freq 0) at 44.1 kHz. */
function wav(seconds, freq, rate = 44100) {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = freq ? Math.sin((2 * Math.PI * freq * i) / rate) * 0.3 : (Math.random() * 2 - 1) * 0.2;
    data.writeInt16LE(Math.round(v * 32767), i * 4);
    data.writeInt16LE(Math.round(v * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function upload(buf, type, name) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  const up = await res.json();
  if (!res.ok) throw new Error(`upload ${name}: ${up.error}`);
  return up.url;
}

async function generate(label, body, kind) {
  const res = await fetch(`${app}/api/generations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "selftest", ...body }) });
  const created = await res.json();
  if (!res.ok) throw new Error(`${label}: ${created.error}`);
  const id = created.items[0].id;
  const t0 = Date.now();
  for (;;) {
    const g = await (await fetch(`${app}/api/generations/${id}`)).json();
    if (g.status === "succeeded") {
      if (g.provider !== "comfyui") throw new Error(`${label} ran on ${g.provider}, not ComfyUI`);
      const out = g.outputs.find((o) => o.kind === kind);
      if (!out) throw new Error(`${label}: no ${kind} output (${g.outputs.map((o) => o.kind)})`);
      const bytes = Buffer.from(await (await fetch(`${app}${out.url}`)).arrayBuffer());
      const local = path.join(tmp, `${label}${path.extname(new URL(out.url, app).pathname)}`);
      fs.writeFileSync(local, bytes);
      console.log(`✓ ${label} (${body.modelId}): ${kind} ${bytes.length} B in ${Date.now() - t0} ms`);
      return { url: out.url, local, ms: Date.now() - t0 };
    }
    if (g.status === "failed" || g.status === "canceled") throw new Error(`${label}: ${g.status} — ${g.error}`);
    if (Date.now() - t0 > 600_000) throw new Error(`${label}: timed out (${g.status} ${g.message ?? ""})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

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

function check(label, cond, detail) {
  if (!cond) throw new Error(`${label}: ${detail}`);
  console.log(`  ${label}: ${detail}`);
}

/** Gray pixels of frame `n` (0-based). */
function frame(file, n) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 64 * 2 ** 20 });
  if (r.status !== 0) throw new Error(`ffmpeg frame ${n} of ${file}: ${r.stderr}`);
  return r.stdout;
}
const meanDiff = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length;

/** RMS level (dB) of a stretch of an audio file, and the largest sample-to-sample step in it. */
function level(file, start, seconds) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(start), "-t", String(seconds), "-i", file, "-ac", "1", "-f", "f32le", "-"], { maxBuffer: 256 * 2 ** 20 });
  if (r.status !== 0) throw new Error(`ffmpeg audio ${file}: ${r.stderr}`);
  const s = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
  let sum = 0;
  let step = 0;
  for (let i = 0; i < s.length; i++) {
    sum += s[i] * s[i];
    if (i) step = Math.max(step, Math.abs(s[i] - s[i - 1]));
  }
  return { db: 10 * Math.log10(sum / Math.max(1, s.length) + 1e-12), step };
}

async function kenBurnsAndJoin() {
  const image = await upload(still(), "image/png", "kenburns-still.png");
  const base = { op: "still-motion", modelId: "oss-ken-burns", inputs: { images: [image] }, params: { aspectRatio: "16:9", resolution: "480p", fps: 24 } };
  // A 2 s eased push-in toward the disc, then a 3 s pan split into 2 s + 1 s linear pieces of one move.
  const push = await generate("ken-burns push-in", { ...base, params: { ...base.params, duration: 2, zoomFrom: 1, zoomTo: 1.2, panFrom: { x: 0.5, y: 0.5 }, panTo: { x: 0.583, y: 0.417 }, easing: "ease-in-out" } }, "video");
  // As splitMove cuts it (src/lib/av/ken-burns.ts): 72 frames, piece 1 shows frames 0–47 of the move, piece 2 frames 48–71.
  const pan = { zoom: 1.2, from: 0.417, to: 0.583 };
  const x = (frame) => Math.round((pan.from + ((pan.to - pan.from) * frame) / 71) * 1e5) / 1e5;
  const a = await generate("ken-burns piece 1", { ...base, params: { ...base.params, duration: 2, zoomFrom: pan.zoom, zoomTo: pan.zoom, panFrom: { x: x(0), y: 0.5 }, panTo: { x: x(47), y: 0.5 }, easing: "linear" } }, "video");
  const b = await generate("ken-burns piece 2", { ...base, params: { ...base.params, duration: 1, zoomFrom: pan.zoom, zoomTo: pan.zoom, panFrom: { x: x(48), y: 0.5 }, panTo: { x: x(71), y: 0.5 }, easing: "linear" } }, "video");
  const pp = probe(push.local);
  check("push-in", pp.video?.width === 854 && pp.video.height === 480 && pp.video.frames === 48 && Math.abs(pp.video.fps - 24) < 0.01, JSON.stringify(pp));
  // The eased move barely moves at its ends and moves most in the middle.
  const f = (n) => frame(push.local, n);
  const [start, early, centre, late, end] = [f(0), f(2), f(23), f(25), f(47)];
  check("eased push-in", meanDiff(start, early) < meanDiff(centre, late), `start step ${meanDiff(start, early).toFixed(2)} < middle step ${meanDiff(centre, late).toFixed(2)}; first vs last ${meanDiff(start, end).toFixed(1)}`);

  const { result: joined, peakGb } = await watchMemory(() => generate("join (3 clips, packet copy)", { modelId: "oss-join-encoded", op: "concat", inputs: { videos: [push.url, a.url, b.url] } }, "video"));
  const pj = probe(joined.local);
  check("join", pj.video?.frames === 48 + 48 + 24 && pj.video.width === 854 && Math.abs(pj.duration - 5) < 0.1, `${pj.video?.frames} frames, ${pj.duration.toFixed(3)} s, ${pj.video?.codec}${peakGb === null ? "" : `, ComfyUI RSS +${peakGb.toFixed(2)} GB`}`);
  // Packet copy: the joined frames are the clips' own frames.
  check("frames copied", meanDiff(frame(joined.local, 50), frame(a.local, 2)) < 0.5 && meanDiff(frame(joined.local, 100), frame(b.local, 4)) < 0.5, "frames 50 and 100 of the join equal frames 2 and 4 of the pieces");
  // The split move goes on at the same speed through the seam between its pieces (frames 95 | 96).
  const steps = [93, 94, 95, 96, 97].map((n) => meanDiff(frame(joined.local, n), frame(joined.local, n + 1)));
  const spread = Math.max(...steps) / Math.max(1e-6, Math.min(...steps));
  check("split move", spread < 3, `frame-to-frame change around the seam ${steps.map((s) => s.toFixed(2)).join(", ")}`);
}

async function audio() {
  const bed = await upload(wav(6, 220), "audio/wav", "bed.wav");
  const loop = await generate("loop 6 s → 20 s, 1 s crossfades", { modelId: "oss-audio-loop", op: "audio-loop", inputs: { audio: bed }, params: { duration: 20, crossfade: 1 } }, "audio");
  const pl = probe(loop.local);
  check("loop", Math.abs(pl.duration - 20) < 0.05 && pl.audio?.rate === 44100 && pl.audio.channels === 2, `${pl.audio?.codec} ${pl.duration.toFixed(3)} s ${pl.audio?.rate} Hz`);
  const seam = level(loop.local, 4.8, 1.4);
  const body = level(loop.local, 2, 2);
  check("loop seams", seam.step < body.step * 2 && Math.abs(seam.db - body.db) < 4, `seam ${seam.db.toFixed(1)} dB / step ${seam.step.toFixed(3)}; body ${body.db.toFixed(1)} dB / step ${body.step.toFixed(3)}`);
  const tail = level(loop.local, 19.9, 0.1);
  check("loop fade-out", tail.db < body.db - 12, `last 0.1 s at ${tail.db.toFixed(1)} dB`);

  const clips = await Promise.all([
    upload(wav(4, 330), "audio/wav", "one.wav"),
    upload(wav(3, 0), "audio/wav", "two.wav"),
    upload(wav(5, 550, 48000), "audio/wav", "three.wav"),
  ]);
  const joined = await generate("join 4 s + 3 s + 5 s, 0.5 s crossfades", { modelId: "oss-audio-join", op: "audio-join", inputs: { audios: clips }, params: { crossfade: 0.5 } }, "audio");
  const pj = probe(joined.local);
  check("audio join", Math.abs(pj.duration - 11) < 0.05 && pj.audio?.rate === 48000, `${pj.audio?.codec} ${pj.duration.toFixed(3)} s at ${pj.audio?.rate} Hz (4 + 3 + 5 − 2 × 0.5)`);
  const [one, two, three] = [level(joined.local, 1, 2), level(joined.local, 4.6, 1.5), level(joined.local, 8, 2)];
  check("audio join order", one.db > two.db && three.db > two.db, `tone ${one.db.toFixed(1)} dB, noise ${two.db.toFixed(1)} dB, tone ${three.db.toFixed(1)} dB`);
}

try {
  await kenBurnsAndJoin();
  await audio();
  console.log(`\nAll Faceless+ open-engine checks passed (files in ${tmp}).`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
}
