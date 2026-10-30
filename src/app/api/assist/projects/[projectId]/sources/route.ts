import { z } from "zod";
import { addSource, ProjectError } from "@/server/assist/projects";
import { contentTypeFor, deleteAsset, saveFile } from "@/server/storage";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

const MAX_BYTES = 25 * 1024 * 1024;
/** Documents Assist can read (text, Markdown, PDF), plus media it can pass on as inputs. */
const ALLOWED = /^(text\/[\w.+-]+|application\/(json|pdf|xml|x-subrip|x-yaml|yaml)|image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|wav|x-wav|ogg|flac|mp4|webm))$/;
const TEXT_EXT: Record<string, string> = { md: "text/markdown", markdown: "text/markdown", txt: "text/plain", csv: "text/csv", srt: "application/x-subrip", vtt: "text/vtt", json: "application/json", yml: "application/x-yaml", yaml: "application/x-yaml", pdf: "application/pdf" };

const Json = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), url: z.string().trim().min(4).max(2000) }),
  z.object({ kind: z.literal("file"), url: z.string().startsWith("/api/files/"), name: z.string().max(160).optional() }),
  z.object({ kind: z.literal("element"), elementId: z.string().min(1).max(40) }),
  z.object({ kind: z.literal("text"), title: z.string().max(160).optional(), text: z.string().min(1).max(20_000) }),
]);

/**
 * Add a source: JSON (a link, an uploaded file URL, an element, a note) or multipart "file"
 * (documents and media are stored like uploads). Links are fetched through the guarded fetcher.
 */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/assist/projects/[projectId]/sources">) => {
  const { projectId } = await ctx.params;
  try {
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
      if (file.size > MAX_BYTES) return Response.json({ error: "That file is over 25 MB" }, { status: 413 });
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const type = TEXT_EXT[ext] ?? (!file.type || file.type === "application/octet-stream" ? contentTypeFor(file.name, "") : file.type);
      if (!ALLOWED.test(type)) return Response.json({ error: `Assist can't use ${type || "that kind of"} files — add text, Markdown, PDF, images, video or audio` }, { status: 415 });
      // The stored file's extension comes from the name for types storage doesn't map: keep it a plain one.
      let name = file.name.replace(/[\\/]/g, "_").replace(/[^\w.\- ()]+/g, "_").slice(-120) || "file";
      if (!/\.[a-z0-9]{1,8}$/i.test(name)) name = `${name}.${Object.entries(TEXT_EXT).find(([, t]) => t === type)?.[0] ?? "bin"}`;
      const asset = saveFile({ data: Buffer.from(await file.arrayBuffer()), contentType: type, name, source: "upload" });
      try {
        return Response.json(await addSource(projectId, { kind: "file", url: asset.url, name: file.name.slice(0, 160) }), { status: 201 });
      } catch (e) {
        // Refused (an unreadable PDF, the project is full): don't keep the upload.
        deleteAsset(asset.id);
        throw e;
      }
    }
    const parsed = Json.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Add a link, a file, an element or a note" }, { status: 400 });
    return Response.json(await addSource(projectId, parsed.data), { status: 201 });
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: e instanceof ProjectError ? e.status : 500 });
  }
});
