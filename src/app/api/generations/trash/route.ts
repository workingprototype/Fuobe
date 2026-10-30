import { connection } from "next/server";
import { listGenerations } from "@/server/generations";
import { emptyTrash, ensureTrashPurge, listOptionsFrom } from "@/server/library";
import { handler } from "@/server/access/route";

/** The Trash, most recently deleted first (paging: before=<deletedAt>:<id> of the last row). Same filters as GET /api/generations. */
export const GET = handler({ access: "signed-in" }, async (request: Request) => {
  await connection();
  ensureTrashPurge();
  return Response.json({ items: listGenerations({ ...listOptionsFrom(new URL(request.url).searchParams), trashed: true }) });
});

/** Empty the Trash: everything in it is deleted for good. */
export const DELETE = handler({ access: "signed-in" }, async () => {
  return Response.json({ count: await emptyTrash() });
});
