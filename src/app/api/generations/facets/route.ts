import { connection } from "next/server";
import { libraryFacets } from "@/server/library";

/** Counts for the Library's filter menus: models used, kinds, favorites, failed, pinned, review statuses, helper steps, Trash. `steps=1` counts the steps in. */
export async function GET(request: Request) {
  await connection();
  return Response.json(libraryFacets({ steps: new URL(request.url).searchParams.get("steps") === "1" }));
}
