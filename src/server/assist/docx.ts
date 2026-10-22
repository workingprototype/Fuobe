import "server-only";
import { unzip, ZipError } from "./unzip";

/**
 * The text of a Word document (.docx): the paragraphs of word/document.xml in order (table cells
 * separated by tabs, line and page breaks kept), and the title from docProps/core.xml. Read with the
 * bounded unzip: only those two entries are inflated, so pictures in the file cost nothing. Deleted
 * text (tracked changes) and field codes are left out. Old binary .doc files are refused with a hint.
 */

export class DocxError extends Error {}

const DOCUMENT = "word/document.xml";
const CORE = "docProps/core.xml";
/** An OLE compound file: the old binary .doc (also .xls / .ppt). */
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

// Markers that can't appear in XML text (C0 controls are not allowed there).
const TAB = "\u0001";
const BREAK = "\u0002";

/** The visible text of a document.xml, paragraph by paragraph. */
export function documentXmlText(xml: string): string {
  const marked = xml
    // Alternate content repeats itself in its fallback (text boxes); deleted text and field codes aren't shown.
    .replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "")
    .replace(/<w:(delText|instrText)\b[^>]*>[\s\S]*?<\/w:\1>/g, "")
    .replace(/<w:(?:tab|ptab)\b[^>]*\/>/g, TAB)
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, BREAK)
    // A table row is one line, its cells separated by tabs (a cell's paragraphs run on with spaces).
    .replace(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g, (_, cell: string) => `${cell.replace(/<\/w:p>/g, " ")}${TAB}`)
    .replace(/<\/w:(?:p|tr)>|<w:p\b[^>]*\/>/g, BREAK);
  let out = "";
  for (const m of marked.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|\u0001|\u0002/g)) {
    out += m[1] !== undefined ? decodeXml(m[1]) : m[0] === TAB ? "\t" : "\n";
  }
  return out
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+$/g, "").replace(/[ \u00a0]*\t[ \u00a0]*/g, "\t").replace(/[ \u00a0]{2,}/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function docxText(data: Buffer, opts: { maxChars: number }): { text: string; title?: string } {
  if (data.subarray(0, 8).equals(OLE)) throw new DocxError("This is an older Word file (.doc) — save it as .docx or PDF and add it again");
  let entries: { name: string; data: Buffer }[];
  try {
    entries = unzip(data, { maxEntries: 20_000, maxFileBytes: 40_000_000, maxTotalBytes: 45_000_000, only: (n) => n === DOCUMENT || n === CORE });
  } catch (e) {
    if (e instanceof ZipError && /over|more than/.test(e.message)) throw new DocxError("This Word file's text is too large to read — split it, or save the part you need as PDF");
    if (e instanceof ZipError && /password/.test(e.message)) throw new DocxError("This Word file is password-protected — remove the password and add it again");
    throw new DocxError("This file is damaged or isn't a Word document (.docx)");
  }
  const doc = entries.find((e) => e.name === DOCUMENT);
  if (!doc) throw new DocxError("This file isn't a Word document (.docx) — it has no document text inside");
  const text = documentXmlText(doc.data.toString("utf8")).slice(0, opts.maxChars);
  if (!text.trim()) throw new DocxError("This Word file has no text to read (it may only hold pictures) — paste the text into the prompt instead");
  const core = entries.find((e) => e.name === CORE)?.data.toString("utf8");
  const title = core && /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1];
  const clean = title ? decodeXml(title).trim() : "";
  return { text, ...(clean && { title: clean }) };
}
