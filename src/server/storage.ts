import "server-only";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { DATA_DIR, db } from "./db";
import type { MediaKind } from "@/lib/catalog/types";
import { fetchRemote } from "./remote-fetch";

export const FILES_DIR = path.join(DATA_DIR, "files");

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  // Text outputs (transcripts, translations, scripts) and 3D models.
  "text/plain": "txt",
  "application/x-subrip": "srt",
  "text/vtt": "vtt",
  "application/json": "json",
  "model/gltf-binary": "glb",
  "model/gltf+json": "gltf",
  // Gaussian splats (TripoSplat on fal writes .ply; the open TripoSplat graph writes .spz).
  "model/ply": "ply",
  "model/x-spz": "spz",
};

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  txt: "text/plain",
  srt: "application/x-subrip",
  vtt: "text/vtt",
  json: "application/json",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  ply: "model/ply",
  spz: "model/x-spz",
};

export function contentTypeFor(fileName: string, fallback = "application/octet-stream"): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXT[ext] ?? fallback;
}

export function kindFor(contentType: string): MediaKind {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  // Transcripts, translations and scripts: plain text, subtitles or JSON cue lists.
  if (type.startsWith("text/") || type === "application/json" || type === "application/x-subrip") return "text";
  if (type.startsWith("model/")) return "model3d";
  return "image";
}

export interface Asset {
  id: string;
  kind: MediaKind;
  name: string | null;
  relPath: string;
  contentType: string;
  size: number;
  /** "derived": a picture a tool rendered for a model (a layer, a region, a mask), not listed with your uploads. */
  source: "upload" | "generation" | "derived";
  generationId: string | null;
  createdAt: number;
  url: string;
}

interface AssetRow {
  id: string;
  kind: MediaKind;
  name: string | null;
  rel_path: string;
  content_type: string;
  size: number;
  source: Asset["source"];
  generation_id: string | null;
  created_at: number;
}

export function fileUrl(relPath: string): string {
  return `/api/files/${relPath.split(path.sep).join("/")}`;
}

function toAsset(r: AssetRow): Asset {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    relPath: r.rel_path,
    contentType: r.content_type,
    size: r.size,
    source: r.source,
    generationId: r.generation_id,
    createdAt: r.created_at,
    url: fileUrl(r.rel_path),
  };
}

export function saveFile(opts: {
  data: Buffer;
  contentType: string;
  name?: string;
  source: Asset["source"];
  generationId?: string;
}): Asset {
  const id = nanoid(12);
  const ext = EXT_BY_TYPE[opts.contentType.split(";")[0].trim()] ?? opts.name?.split(".").pop()?.toLowerCase() ?? "bin";
  const day = new Date().toISOString().slice(0, 10);
  const relPath = path.join(/*turbopackIgnore: true*/ opts.source === "generation" ? "outputs" : "uploads", day, `${id}.${ext}`);
  const abs = path.join(FILES_DIR, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, opts.data);
  const row: AssetRow = {
    id,
    kind: kindFor(opts.contentType),
    name: opts.name ?? null,
    rel_path: relPath,
    content_type: opts.contentType,
    size: opts.data.length,
    source: opts.source,
    generation_id: opts.generationId ?? null,
    created_at: Date.now(),
  };
  db()
    .prepare(
      `INSERT INTO assets (id, kind, name, rel_path, content_type, size, source, generation_id, created_at)
       VALUES (@id, @kind, @name, @rel_path, @content_type, @size, @source, @generation_id, @created_at)`,
    )
    .run(row);
  return toAsset(row);
}

export function getAsset(id: string): Asset | null {
  const row = db().prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
  return row ? toAsset(row) : null;
}

/** Newest first; page with `before` (+ `beforeId`): the last asset of the previous page. Derived renders only when asked for. */
export function listAssets(opts: { source?: Asset["source"]; kind?: MediaKind; limit?: number; before?: number; beforeId?: string }): Asset[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.source) {
    where.push("source = ?");
    args.push(opts.source);
  } else where.push("source != 'derived'");
  if (opts.kind) {
    where.push("kind = ?");
    args.push(opts.kind);
  }
  if (opts.before) {
    where.push(opts.beforeId ? "(created_at < ? OR (created_at = ? AND id < ?))" : "created_at < ?");
    args.push(...(opts.beforeId ? [opts.before, opts.before, opts.beforeId] : [opts.before]));
  }
  const sql = `SELECT * FROM assets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, opts.limit ?? 100) as AssetRow[]).map(toAsset);
}

export function deleteAsset(id: string): void {
  const a = getAsset(id);
  if (!a) return;
  fs.rmSync(absolutePath(a.relPath), { force: true });
  db().prepare("DELETE FROM assets WHERE id = ?").run(id);
}

/** Resolve a relative path inside FILES_DIR, refusing traversal. */
export function absolutePath(relPath: string): string {
  const abs = path.resolve(FILES_DIR, relPath);
  if (!abs.startsWith(FILES_DIR + path.sep)) throw new Error("Invalid path");
  return abs;
}

/**
 * Resolve an asset reference from the UI (asset id, /api/files/... URL, http(s) URL or data URI)
 * to bytes + content type.
 */
export async function readRef(ref: string): Promise<{ data: Buffer; contentType: string; name: string }> {
  if (ref.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(ref);
    if (!m) throw new Error("Malformed data URI");
    const contentType = m[1] ?? "application/octet-stream";
    const data = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    return { data, contentType, name: `input.${EXT_BY_TYPE[contentType] ?? "bin"}` };
  }
  if (ref.startsWith("/api/files/")) {
    const rel = decodeURIComponent(ref.slice("/api/files/".length));
    const abs = absolutePath(rel);
    return { data: fs.readFileSync(abs), contentType: contentTypeFor(abs), name: path.basename(abs) };
  }
  if (/^https?:\/\//.test(ref)) {
    // Public links only: never this machine or its private network (see remote-fetch.ts).
    const res = await fetchRemote(ref);
    const path0 = new URL(res.url).pathname;
    const header = res.contentType && res.contentType !== "application/octet-stream" ? res.contentType : null;
    return { data: res.data, contentType: header ?? contentTypeFor(path0), name: path0.split("/").pop() || "input" };
  }
  const asset = getAsset(ref);
  if (!asset) throw new Error(`Unknown asset ${ref}`);
  return {
    data: fs.readFileSync(absolutePath(asset.relPath)),
    contentType: asset.contentType,
    name: asset.name ?? path.basename(asset.relPath),
  };
}

export function toDataUri(data: Buffer, contentType: string): string {
  return `data:${contentType};base64,${data.toString("base64")}`;
}
