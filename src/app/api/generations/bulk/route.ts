import { z } from "zod";
import { deleteForever, moveToFolder, restoreGenerations, setFavorites, trashGenerations } from "@/server/library";

const Body = z.object({
  action: z.enum(["trash", "restore", "delete", "favorite", "unfavorite", "move"]),
  ids: z.array(z.string().min(1).max(40)).min(1).max(500),
  /** For "move": the folder, or null for the library root. */
  folderId: z.string().max(40).nullable().optional(),
});

/** One action on many generations: Trash / Restore / Delete forever / (un)favorite / move to a folder. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick something first" }, { status: 400 });
  const { action, ids, folderId } = parsed.data;
  try {
    const count =
      action === "trash"
        ? trashGenerations(ids)
        : action === "restore"
          ? restoreGenerations(ids)
          : action === "delete"
            ? await deleteForever(ids)
            : action === "move"
              ? moveToFolder(ids, folderId ?? null)
              : setFavorites(ids, action === "favorite");
    return Response.json({ count });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
