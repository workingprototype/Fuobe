import "server-only";
import fs from "node:fs";
import { absolutePath, contentTypeFor } from "./storage";

/**
 * A stored file as an HTTP response, with byte ranges (video seeking), a UTF-8 charset for text,
 * `nosniff`, and a script-free CSP for SVG. `relPath` is under the files folder; traversal is
 * refused. Used by /api/files (signed in) and the share routes (/s/<token>/f/…).
 */
export function fileResponse(request: Request, relPath: string, opts: { cache?: string; headers?: Record<string, string> } = {}): Response {
  let abs: string;
  try {
    abs = absolutePath(relPath);
  } catch {
    return new Response("Bad path", { status: 400 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response("Not found", { status: 404 });
  const size = fs.statSync(abs).size;
  const type = contentTypeFor(abs);
  const headers: Record<string, string> = {
    // Transcripts, subtitles and scripts are UTF-8 text.
    "Content-Type": /^text\/|^application\/(json|x-subrip)$/.test(type) ? `${type}; charset=utf-8` : type,
    "Accept-Ranges": "bytes",
    "Cache-Control": opts.cache ?? "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ...opts.headers,
  };
  if (type === "image/svg+xml") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  const download = new URL(request.url).searchParams.get("download");
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^\w.-]/g, "_")}"`;
  const range = request.headers.get("range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = fs.createReadStream(abs, { start, end });
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(fs.createReadStream(abs) as unknown as ReadableStream, {
    headers: { ...headers, "Content-Length": String(size) },
  });
}
