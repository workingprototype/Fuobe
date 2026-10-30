import { connection } from "next/server";
import { libraryFacets } from "@/server/library";
import { handler } from "@/server/access/route";

/** Counts for the Library's filter menus: models used, kinds, favorites, failed, pinned, review statuses, helper steps, Trash. `steps=1` counts the steps in. */
export const GET = handler({ access: "signed-in" }, async (request: Request) => {
  await connection();
  return Response.json(libraryFacets({ steps: new URL(request.url).searchParams.get("steps") === "1" }));
});
