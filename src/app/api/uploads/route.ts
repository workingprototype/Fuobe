import { saveFile } from "@/server/storage";

const MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|wav|x-wav|ogg|flac|mp4|webm))$/;

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "File too large (200 MB max)" }, { status: 413 });
  if (!ALLOWED.test(file.type)) return Response.json({ error: `Unsupported file type ${file.type || "unknown"}` }, { status: 415 });
  const asset = saveFile({
    data: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
    name: file.name,
    source: "upload",
  });
  return Response.json(asset, { status: 201 });
}
