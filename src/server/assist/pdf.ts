import "server-only";

/**
 * The text of a PDF (brand guides, briefs, scripts), page by page, for project sources. Runs
 * PDF.js through unpdf's serverless build (no worker, no canvas), stops once `maxChars` is read,
 * and reads at most `maxPages` pages so a huge document can't hold the request up. (This PDF.js
 * no longer compiles fonts with eval, so there is no eval switch to turn off.)
 */

export class PdfError extends Error {}

export async function pdfText(data: Buffer, opts: { maxChars: number; maxPages?: number }): Promise<{ text: string; pages: number; title?: string }> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data), { stopAtErrors: false });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "PasswordException") throw new PdfError("This PDF is password-protected — remove the password and add it again");
    throw new PdfError("This PDF is damaged or isn't a PDF");
  }
  try {
    const pages = Math.min(pdf.numPages, opts.maxPages ?? 300);
    const parts: string[] = [];
    let chars = 0;
    for (let n = 1; n <= pages && chars < opts.maxChars; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str + (item.hasEOL ? "\n" : "");
      }
      page.cleanup();
      const clean = line
        .replace(/[ \t ]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (clean) {
        parts.push(clean);
        chars += clean.length + 2;
      }
    }
    const text = parts.join("\n\n").slice(0, opts.maxChars);
    if (!text.trim()) throw new PdfError("This PDF has no text to read (it may be scanned images) — paste the text as a note instead");
    const meta = await pdf.getMetadata().catch(() => null);
    const title = typeof (meta?.info as { Title?: unknown } | undefined)?.Title === "string" ? ((meta!.info as { Title: string }).Title.trim() || undefined) : undefined;
    return { text, pages: pdf.numPages, ...(title && { title }) };
  } finally {
    await pdf.loadingTask.destroy().catch(() => {});
  }
}
