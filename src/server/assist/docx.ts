import "server-only";
import { unzip, ZipError } from "./unzip";

/**
 * The text of a Word document (.docx): the paragraphs of word/document.xml in order (table cells
 * separated by tabs, line and page breaks kept), and the title from docProps/core.xml. Read with the
 * bounded unzip: only those two entries are inflated, so pictures in the file cost nothing. Deleted
 * text (tracked changes), field codes and tab stops are left out. The markup is read in one linear
 * pass from its start until there's enough text, so a crafted file can't hold the server up. Old
 * binary .doc files are refused with a hint.
 */

export class DocxError extends Error {}

const DOCUMENT = "word/document.xml";
const CORE = "docProps/core.xml";
/** The most of document.xml's markup that's read (the text a source needs comes long before it). */
const MAX_XML = 16_000_000;
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

/** Elements whose content isn't shown: alternate content's fallback copy (text boxes say everything twice), deleted text, field codes and paragraph properties (their tab stops are <w:tab>s too). */
const HIDDEN = new Set(["mc:Fallback", "w:delText", "w:instrText", "w:pPr"]);

const isNameEnd = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x2f /* / */ || c === 0x3e; /* > */

/**
 * The visible text of a document.xml, paragraph by paragraph: one pass over the tags with indexOf and
 * a few counters (no regex that rescans the rest of the file), so a crafted document — thousands of
 * tags that never close, a run of a million spaces — costs time in proportion to its size. It stops
 * once `limit` characters (before blanks are tidied) are read.
 */
export function documentXmlText(xml: string, limit = Infinity): string {
  let raw = "";
  let hidden = 0; // depth inside HIDDEN elements
  let cells = 0; // depth inside table cells: a row is one line, its cells separated by tabs
  let inText = false; // inside <w:t>
  let i = 0;
  while (i < xml.length && raw.length < limit) {
    const lt = xml.indexOf("<", i);
    const textEnd = lt < 0 ? xml.length : lt;
    // An entity never decodes to more characters than it's written with, so the room left bounds the slice.
    if (inText && !hidden && textEnd > i) raw += decodeXml(xml.slice(i, Math.min(textEnd, i + (limit - raw.length))));
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    const gt = xml.indexOf(">", lt + 1);
    // A tag that never ends: the rest isn't XML.
    if (gt < 0) break;
    i = gt + 1;
    const closing = xml.charCodeAt(lt + 1) === 0x2f;
    const empty = xml.charCodeAt(gt - 1) === 0x2f;
    let e = closing ? lt + 2 : lt + 1;
    const from = e;
    while (e < gt && !isNameEnd(xml.charCodeAt(e))) e++;
    const name = xml.slice(from, e);
    if (HIDDEN.has(name)) {
      if (closing) hidden = Math.max(0, hidden - 1);
      else if (!empty) hidden++;
      continue;
    }
    if (hidden) continue;
    switch (name) {
      case "w:t":
        inText = !closing && !empty;
        break;
      case "w:tab":
      case "w:ptab":
        if (!closing) raw += "\t";
        break;
      case "w:br":
      case "w:cr":
        if (!closing) raw += cells ? " " : "\n";
        break;
      case "w:tc":
        if (closing) {
          cells = Math.max(0, cells - 1);
          raw += "\t";
        } else if (!empty) cells++;
        break;
      case "w:p":
      case "w:tr":
        // A paragraph ends a line; inside a cell its paragraphs run on with spaces.
        if (closing || (empty && name === "w:p")) raw += cells ? " " : "\n";
        break;
    }
  }
  return raw.split("\n").map(tidyLine).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** One line, cleaned up in one pass: blanks around a tab and at the end dropped, runs of blanks made one space. */
function tidyLine(line: string): string {
  let out = "";
  let blanks = 0;
  let blank = " ";
  let afterTab = false;
  for (const ch of line) {
    if (ch === " " || ch === "\u00a0") {
      if (!afterTab) {
        blanks++;
        blank = ch;
      }
    } else if (ch === "\t") {
      blanks = 0;
      afterTab = true;
      out += ch;
    } else {
      if (blanks) out += blanks === 1 ? blank : " ";
      blanks = 0;
      afterTab = false;
      out += ch;
    }
  }
  let end = out.length;
  while (end > 0 && out.charCodeAt(end - 1) === 0x09) end--;
  return out.slice(0, end);
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
  // The text is read from the start of the document until there's enough of it (blanks tidied away can
  // shrink it, hence the margin), and from at most the first MAX_XML bytes of markup.
  const xml = doc.data.toString("utf8", 0, Math.min(doc.data.length, MAX_XML));
  const text = documentXmlText(xml, opts.maxChars * 4 + 1024).slice(0, opts.maxChars);
  if (!text.trim()) throw new DocxError("This Word file has no text to read (it may only hold pictures) — paste the text into the prompt instead");
  const core = entries.find((e) => e.name === CORE)?.data.toString("utf8");
  const title = core && /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1];
  const clean = title ? decodeXml(title).trim() : "";
  return { text, ...(clean && { title: clean }) };
}
