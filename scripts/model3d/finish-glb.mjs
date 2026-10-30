#!/usr/bin/env node
// Finish an image-to-3D GLB from ComfyUI (Pixal3D, TRELLIS.2, Hunyuan3D) for the web. The Fuobe server runs
// this in a child process after the job (src/server/model3d-finish.ts); it also works by hand:
//
//   node scripts/model3d/finish-glb.mjs --in raw.glb --out web.glb [--material auto|matte|metal|mixed] [--texture-size 2048]
//
// 1. Material: "auto" reads the baked metallic channel (B of the metallicRoughness texture). Mostly metal
//    (>= 25 % of texels at metallic >= 0.5) -> "metal"; almost none (< 2 % and mean < 0.05) -> "matte";
//    anything else -> "mixed". No texture (Hunyuan3D shapes) -> "unknown".
// 2. Every texture sampler gets mipmapped minification; roughness gets a floor by material:
//      matte  : roughness >= 0.8 everywhere and metallic zeroed (the bake reads ~0.25-0.4, glossy plastic on ceramic)
//      metal  : no floor, metallic kept (chrome stays chrome)
//      mixed / unknown (the safe default): roughness >= 0.45 on non-metal texels only, metallic kept
//    A primitive with no material, or a material with no metallicRoughness texture still at the glTF defaults
//    (metallic 1, roughness 1: three.js shows dark, rough metal), becomes a matte dielectric (metallic 0,
//    roughness 0.8; for a material, in every class but metal): Hunyuan3D's shape-only GLBs, for one.
// 3. center --pivot below: Pixal3D's origin is the camera-aligned volume centre, so the object orbits off-centre.
// 4. optimize like `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 2048
//    --simplify false` (dedup, instance, palette, flatten, join, weld, prune, sparse, WebP, meshopt). No simplify:
//    the graph already decimated to ~250k triangles.
//
// Prints one JSON line: { material, metalFraction, roughFloor, noMetal, triangles, vertices, bytesIn, bytesOut, ms }.
import fs from "node:fs";
import { parseArgs } from "node:util";
import { Logger, NodeIO, TextureInfo } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { center, dedup, flatten, instance, join, meshopt, palette, prune, sparse, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const { values: a } = parseArgs({
  options: {
    in: { type: "string" },
    out: { type: "string" },
    material: { type: "string", default: "auto" },
    "texture-size": { type: "string", default: "2048" },
  },
});
if (!a.in || !a.out) {
  console.error("usage: finish-glb.mjs --in raw.glb --out web.glb [--material auto|matte|metal|mixed] [--texture-size 2048]");
  process.exit(2);
}
// Run by the Fuobe server (src/server/model3d-finish.ts): stop when it goes away (its end of stdin closes).
if (process.env.FUOBE_PARENT_PIPE === "1") {
  process.stdin.on("end", () => process.exit(1));
  process.stdin.on("error", () => process.exit(1));
  process.stdin.resume();
  process.stdin.unref?.();
}

/** Roughness floor and metal handling for each material class (see the header). */
const FINISH = {
  matte: { roughFloor: 0.8, noMetal: true, floorMetalTexels: true },
  metal: { roughFloor: 0, noMetal: false, floorMetalTexels: false },
  mixed: { roughFloor: 0.45, noMetal: false, floorMetalTexels: false },
  unknown: { roughFloor: 0.45, noMetal: false, floorMetalTexels: false },
};

const t0 = Date.now();
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const bytesIn = fs.statSync(a.in).size;
const doc = await io.read(a.in);
// stdout carries only the JSON result line.
doc.setLogger(new Logger(Logger.Verbosity.ERROR));
const root = doc.getRoot();

// ---- 1. material class from the metallic channel
const mrTextures = [...new Set(root.listMaterials().map((m) => m.getMetallicRoughnessTexture()).filter(Boolean))];
const decoded = new Map();
let metalTexels = 0;
let metalSum = 0;
let texels = 0;
for (const tex of mrTextures) {
  // 8-bit sRGB (a grey or 16-bit PNG too), stepped by the decoded pixels' own channel count (alpha or not).
  const { data: raw, info } = await sharp(Buffer.from(tex.getImage())).toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  decoded.set(tex, { raw, width, height, channels });
  for (let i = 0; i < raw.length; i += channels) {
    const m = raw[i + 2];
    metalSum += m / 255;
    if (m >= 128) metalTexels++;
    texels++;
  }
}
const metalFraction = texels ? metalTexels / texels : 0;
const metalMean = texels ? metalSum / texels : 0;
const auto = !texels ? "unknown" : metalFraction >= 0.25 ? "metal" : metalFraction < 0.02 && metalMean < 0.05 ? "matte" : "mixed";
const material = ["matte", "metal", "mixed"].includes(a.material) ? a.material : auto;
const rule = FINISH[material];

// ---- 2. samplers + roughness floor
for (const mat of root.listMaterials()) {
  for (const info of [mat.getBaseColorTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getNormalTextureInfo(), mat.getOcclusionTextureInfo(), mat.getEmissiveTextureInfo()]) {
    if (!info) continue;
    info.setMinFilter(TextureInfo.MinFilter.LINEAR_MIPMAP_LINEAR);
    info.setMagFilter(TextureInfo.MagFilter.LINEAR);
  }
  if (rule.noMetal && !mat.getMetallicRoughnessTexture()) mat.setMetallicFactor(0);
  if (material !== "metal" && !mat.getMetallicRoughnessTexture() && mat.getMetallicFactor() === 1 && mat.getRoughnessFactor() === 1) {
    mat.setMetallicFactor(0).setRoughnessFactor(0.8);
  }
}
// Primitives with no material at all: one shared matte dielectric (three.js would make them dark metal).
let plain = null;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial()) continue;
    plain ??= doc.createMaterial("default").setMetallicFactor(0).setRoughnessFactor(0.8);
    prim.setMaterial(plain);
  }
}
if (rule.roughFloor > 0 || rule.noMetal) {
  const floor = Math.round(rule.roughFloor * 255);
  for (const [tex, { raw, width, height, channels }] of decoded) {
    for (let i = 0; i < raw.length; i += channels) {
      const metal = raw[i + 2] >= 128;
      if (rule.floorMetalTexels || !metal) raw[i + 1] = Math.max(raw[i + 1], floor);
      if (rule.noMetal) raw[i + 2] = 0;
    }
    const png = await sharp(raw, { raw: { width, height, channels } }).png({ compressionLevel: 6 }).toBuffer();
    tex.setImage(new Uint8Array(png)).setMimeType("image/png");
  }
}

// ---- 3 + 4. pivot at the bottom centre, then the web optimisation
const size = Number(a["texture-size"]) || 2048;
await doc.transform(
  center({ pivot: "below" }),
  dedup(),
  instance({ min: 5 }),
  palette({ min: 5 }),
  flatten(),
  join(),
  weld(),
  prune({ keepAttributes: true, keepIndices: false, keepLeaves: false, keepSolidTextures: true }),
  sparse(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [size, size] }),
  meshopt({ encoder: MeshoptEncoder, level: "high" }),
);

let triangles = 0;
let vertices = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    const pos = prim.getAttribute("POSITION");
    vertices += pos?.getCount() ?? 0;
    triangles += Math.floor((idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3);
  }
}
await io.write(a.out, doc);
const bytesOut = fs.statSync(a.out).size;
console.log(
  JSON.stringify({
    material,
    metalFraction: Math.round(metalFraction * 1000) / 1000,
    roughFloor: rule.roughFloor,
    noMetal: rule.noMetal,
    triangles,
    vertices,
    bytesIn,
    bytesOut,
    ms: Date.now() - t0,
  }),
);
