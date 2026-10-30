import { contentTypeFor, saveFile } from "@/server/storage";
import { handler } from "@/server/access/route";

const MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime|x-matroska|x-msvideo)|audio\/(mpeg|wav|x-wav|ogg|flac|mp4|webm))$/;
/** Names browsers give AVI and Matroska files, to the one Fuobe stores them under. */
const VIDEO_ALIASES: Record<string, string> = { "video/avi": "video/x-msvideo", "video/msvideo": "video/x-msvideo", "video/vnd.avi": "video/x-msvideo", "video/mkv": "video/x-matroska" };

export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "File too large (200 MB max)" }, { status: 413 });
  // Scripts often send no type (or octet-stream): go by the file extension then.
  const given = !file.type || file.type === "application/octet-stream" ? contentTypeFor(file.name, "") : file.type;
  const type = VIDEO_ALIASES[given] ?? given;
  if (!ALLOWED.test(type)) return Response.json({ error: `Unsupported file type ${type || file.type || "unknown"}` }, { status: 415 });
  const asset = saveFile({
    data: Buffer.from(await file.arrayBuffer()),
    contentType: type,
    name: file.name,
    source: "upload",
  });
  return Response.json(asset, { status: 201 });
});
