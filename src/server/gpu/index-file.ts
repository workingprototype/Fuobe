import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseIndex } from "@/lib/gpu/requirements";
import type { RequirementIndex } from "@/lib/gpu/types";

/**
 * The GPU pre-flight: on unless FUOBE_GPU_PREFLIGHT=0. It only reads the viewer's ComfyUI and fails open
 * (a check that is unknown or failed never blocks a run), so it ships on.
 */
export const preflightOn = (): boolean => process.env.FUOBE_GPU_PREFLIGHT?.trim() !== "0";

export const INDEX_FILE = path.join(process.cwd(), "workflows", "comfyui", "requirements.json");

let cache: { mtime: number; index: RequirementIndex; raw: string; key: string } | null = null;

/** workflows/comfyui/requirements.json (scripts/comfy/build-requirements.mjs), cached by mtime like loadManifest. */
export function loadIndex(): RequirementIndex {
  return loadIndexRaw().index;
}

/** The index and its file text (GET /api/gpu/requirements serves the text as it is). */
export function loadIndexRaw(): { index: RequirementIndex; raw: string; key: string } {
  const mtime = fs.statSync(INDEX_FILE).mtimeMs;
  if (!cache || cache.mtime !== mtime) {
    const raw = fs.readFileSync(INDEX_FILE, "utf8");
    cache = { mtime, index: parseIndex(JSON.parse(raw)), raw, key: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16) };
  }
  return cache;
}

/** Which requirements index this is: a short hash of its file text. A worker's lanes say which index they were worked out with. */
export function indexKey(): string {
  return loadIndexRaw().key;
}
