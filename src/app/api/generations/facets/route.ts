import { connection } from "next/server";
import { libraryFacets } from "@/server/library";

/** Counts for the Library's filter menus: models used, kinds, favorites, failed, Trash. */
export async function GET() {
  await connection();
  return Response.json(libraryFacets());
}
