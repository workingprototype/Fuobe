#!/usr/bin/env node
/**
 * Demo-mode assets for "image to 3D": a small, valid glTF 2.0 binary (public/samples/demo-model.glb)
 * and a turntable clip of the same mesh (public/samples/demo-turntable.mp4, needs ffmpeg).
 * The mock provider returns both when no 3D provider is connected. Run: node scripts/gen-demo-3d.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "samples");

// ---------------------------------------------------------------------------
// Mesh: a faceted crystal (octagonal bipyramid with a flat girdle band), flat-shaded.

const SIDES = 8;
const ring = (y, r, twist = 0) => Array.from({ length: SIDES }, (_, i) => {
  const a = (i / SIDES) * Math.PI * 2 + twist;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
});
const top = [0, 1.05, 0];
const bottom = [0, -1.25, 0];
const upper = ring(0.25, 0.62, Math.PI / SIDES);
const lower = ring(-0.05, 0.62, Math.PI / SIDES);

/** Triangles, each [a, b, c] counter-clockwise seen from outside. */
const tris = [];
for (let i = 0; i < SIDES; i++) {
  const j = (i + 1) % SIDES;
  tris.push([top, upper[j], upper[i]]);
  tris.push([upper[i], upper[j], lower[j]], [upper[i], lower[j], lower[i]]);
  tris.push([bottom, lower[i], lower[j]]);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};

// Iris-to-violet facets (the brand colour, #5d4bdb), alternating so the facets read in any viewer.
const PALETTE = [
  [0.365, 0.294, 0.859],
  [0.51, 0.44, 0.95],
  [0.27, 0.2, 0.7],
  [0.62, 0.55, 0.98],
];
const positions = [];
const normals = [];
const colors = [];
tris.forEach((t, k) => {
  const n = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
  const c = PALETTE[(k + Math.floor(k / 4)) % PALETTE.length];
  for (const v of t) {
    positions.push(...v);
    normals.push(...n);
    colors.push(...c);
  }
});
const count = positions.length / 3;
const indices = Array.from({ length: count }, (_, i) => i);

// ---------------------------------------------------------------------------
// GLB writer

function glb() {
  const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
  const pos = f32(positions);
  const nor = f32(normals);
  const col = f32(colors);
  const idx = Buffer.from(new Uint16Array(indices).buffer);
  const views = [pos, nor, col, idx];
  let offset = 0;
  const bufferViews = views.map((b, i) => {
    const v = { buffer: 0, byteOffset: offset, byteLength: b.length, target: i === 3 ? 34963 : 34962 };
    offset += b.length;
    return v;
  });
  const bin = Buffer.concat(views);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const min = [0, 1, 2].map((a) => Math.min(...positions.filter((_, i) => i % 3 === a)));
  const max = [0, 1, 2].map((a) => Math.max(...positions.filter((_, i) => i % 3 === a)));
  const gltf = {
    asset: { version: "2.0", generator: "Fuobe demo (scripts/gen-demo-3d.mjs)", copyright: "Fuobe demo output" },
    scene: 0,
    scenes: [{ name: "Demo", nodes: [0] }],
    nodes: [{ name: "Demo crystal", mesh: 0 }],
    meshes: [{ name: "Demo crystal", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [{ name: "Demo facets", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.1, roughnessFactor: 0.4 } }],
    buffers: [{ byteLength: binPadded.length }],
    bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count, type: "VEC3" },
      { bufferView: 3, componentType: 5123, count, type: "SCALAR" },
    ],
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunk = (data, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(jsonPadded, 0x4e4f534a), chunk(binPadded, 0x004e4942)]);
}

// ---------------------------------------------------------------------------
// Turntable: a tiny software rasterizer → raw RGB frames → ffmpeg (H.264).

const W = 512;
const H = 512;
const FRAMES = 72;

function frame(angle) {
  const rgb = Buffer.alloc(W * H * 3);
  const depth = new Float32Array(W * H).fill(Infinity);
  for (let y = 0; y < H; y++) {
    // Dark violet backdrop with a soft vertical falloff.
    const t = y / H;
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / W;
      const glow = Math.max(0, 1 - Math.hypot(dx, t - 0.45) * 2.2);
      const i = (y * W + x) * 3;
      rgb[i] = 22 + glow * 30;
      rgb[i + 1] = 18 + glow * 22;
      rgb[i + 2] = 40 + glow * 60;
    }
  }
  const tilt = -0.32;
  const rot = (v) => {
    const [x, y, z] = v;
    const x1 = x * Math.cos(angle) + z * Math.sin(angle);
    const z1 = -x * Math.sin(angle) + z * Math.cos(angle);
    return [x1, y * Math.cos(tilt) - z1 * Math.sin(tilt), y * Math.sin(tilt) + z1 * Math.cos(tilt)];
  };
  const project = ([x, y, z]) => {
    const d = 4.2 - z;
    return [W / 2 + (x * 640) / d, H * 0.52 - (y * 640) / d, d];
  };
  const light = norm([0.5, 0.8, 0.9]);
  for (let k = 0; k < tris.length; k++) {
    const v = tris[k].map(rot);
    const n = norm(cross(sub(v[1], v[0]), sub(v[2], v[0])));
    if (n[2] <= 0) continue; // facing away
    const shade = 0.35 + 0.65 * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
    const c = colors.slice(k * 9, k * 9 + 3).map((x) => Math.min(255, x * 255 * shade + 18));
    const p = v.map(project);
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(area) < 1e-6) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((p[1][0] - px) * (p[2][1] - py) - (p[2][0] - px) * (p[1][1] - py)) / area;
        const w1 = ((p[2][0] - px) * (p[0][1] - py) - (p[0][0] - px) * (p[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2];
        const i = y * W + x;
        if (z >= depth[i]) continue;
        depth[i] = z;
        rgb[i * 3] = c[0];
        rgb[i * 3 + 1] = c[1];
        rgb[i * 3 + 2] = c[2];
      }
    }
  }
  return rgb;
}

fs.mkdirSync(out, { recursive: true });
const model = glb();
fs.writeFileSync(path.join(out, "demo-model.glb"), model);
console.log(`wrote demo-model.glb (${model.length} bytes, ${tris.length} triangles)`);

const font = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"].find((f) => fs.existsSync(f));
const label = font ? `,drawtext=fontfile=${font}:text='DEMO OUTPUT · 3D':fontcolor=white@0.9:fontsize=20:x=28:y=28:box=1:boxcolor=white@0.18:boxborderw=10` : "";
const frames = Buffer.concat(Array.from({ length: FRAMES }, (_, f) => frame((f / FRAMES) * Math.PI * 2)));
const ff = spawnSync(
  "ffmpeg",
  ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", "24", "-i", "-", "-vf", `format=yuv420p${label}`, "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(out, "demo-turntable.mp4")],
  { input: frames },
);
if (ff.status !== 0) {
  console.error(`ffmpeg failed (${ff.error?.message ?? ff.stderr?.toString()}); demo-turntable.mp4 not written`);
  process.exitCode = 1;
} else {
  console.log(`wrote demo-turntable.mp4 (${fs.statSync(path.join(out, "demo-turntable.mp4")).size} bytes, ${FRAMES} frames)`);
}
