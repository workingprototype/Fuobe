import fs from "node:fs";

/**
 * A checked SVG: the only SVG Fuobe keeps as image/svg+xml (a computer's result, an account's result). No "server-only"
 * import, so the repair script (scripts/ops/readopt-svg-results.mjs) can load it with Node's own type stripping.
 */

/** What a kept SVG never holds: scripts, event handlers, a page inside it, entities. */
export const SVG_ACTIVE = /<script\b|<foreignObject\b|<!ENTITY|\son[a-z]+\s*=|javascript:/i;
export const SVG_MAX_BYTES = 64 * 2 ** 20;

/**
 * A real SVG: UTF-8, its root an <svg> in the SVG namespace after at most an XML declaration, comments and a DOCTYPE
 * with no internal subset, closed at its end, with nothing active in it (SVG_ACTIVE).
 */
export function isSvgData(data: Uint8Array): boolean {
  try {
    if (data.length > SVG_MAX_BYTES) return false;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    const body = text.replace(/^(?:\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg\b[^[>]*>)*/, "");
    const root = /^<svg\b[^>]*>/.exec(body)?.[0];
    return !!root && /\sxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(root) && /<\/svg\s*>\s*$/.test(body) && !SVG_ACTIVE.test(body);
  } catch {
    return false;
  }
}

/** isSvgData for a file on disk (never read when it is over SVG_MAX_BYTES). */
export function isSvgFile(file: string): boolean {
  try {
    if (fs.statSync(file).size > SVG_MAX_BYTES) return false;
    return isSvgData(fs.readFileSync(file));
  } catch {
    return false;
  }
}
