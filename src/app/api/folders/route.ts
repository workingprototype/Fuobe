import { connection } from "next/server";
import { z } from "zod";
import { createFolder, LibraryError, listFolders } from "@/server/library";

const Body = z.object({ name: z.string().trim().min(1).max(60), color: z.string().max(20).optional(), parentId: z.string().max(40).nullable().optional() });

/** Every folder, flat: each has its parentId (null at the library root) and pinnedAt. */
export async function GET() {
  await connection();
  return Response.json({ items: listFolders() });
}

/** A new folder; `parentId` makes it a subfolder. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the folder a name" }, { status: 400 });
  try {
    return Response.json(createFolder(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof LibraryError ? e.status : 409 });
  }
}
