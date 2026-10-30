import { EngineSchema, FacelessError, handle, MAX_DOCUMENT_BYTES, readDocument } from "@/server/faceless";
import { handler } from "@/server/access/route";

/**
 * A PDF or Word source (multipart: "file", "engine"): the text is read on the server and, when the
 * document is longer than the script writer reads, summarised. The file itself isn't kept.
 */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new FacelessError("Choose a PDF or a Word file (.docx)");
    if (file.size > MAX_DOCUMENT_BYTES) throw new FacelessError(`${file.name} is over ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB — add the part that matters, or paste its text into the prompt`, 413);
    const engine = EngineSchema.safeParse(form?.get("engine"));
    return Response.json(await readDocument({ name: file.name, data: Buffer.from(await file.arrayBuffer()), type: file.type }, engine.success ? engine.data : "cloud"));
  });
});
