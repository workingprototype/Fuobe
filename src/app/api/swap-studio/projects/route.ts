import { connection } from "next/server";
import { body, handle } from "@/server/shorts-schemas";
import { createProject, CreateSchema, listProjects } from "@/server/swap-studio";
import { handler } from "@/server/access/route";

/** Character Swap Studio projects, most recently changed first. */
export const GET = handler({ access: "signed-in" }, async () => {
  await connection();
  return handle(() => Response.json({ items: listProjects() }));
});

/** A new project: a name, the engine, and (optionally) the character. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => Response.json(createProject(await body(request, CreateSchema, "Name the project and pick an engine")), { status: 201 }));
});
