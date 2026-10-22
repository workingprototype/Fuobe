import { z } from "zod";
import { deleteForever, moveToFolder, restoreGenerations, setFavorites, setPinned, setReview, trashGenerations } from "@/server/library";

const Body = z.object({
  action: z.enum(["trash", "restore", "delete", "favorite", "unfavorite", "move", "pin", "unpin", "review"]),
  ids: z.array(z.string().min(1).max(40)).min(1).max(500),
  /** For "move": the folder, or null for the library root. */
  folderId: z.string().max(40).nullable().optional(),
  /** For "review": the status, or null to clear it. */
  review: z.enum(["in-progress", "needs-review", "approved", "rejected"]).nullable().optional(),
});

/** One action on many generations: Trash / Restore / Delete forever / (un)favorite / move to a folder / (un)pin / review status. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick something first" }, { status: 400 });
  const { action, ids, folderId, review } = parsed.data;
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
              : action === "pin" || action === "unpin"
                ? setPinned(ids, action === "pin")
                : action === "review"
                  ? setReview(ids, review ?? null)
                  : setFavorites(ids, action === "favorite");
    return Response.json({ count });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
