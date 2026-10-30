import { connection } from "next/server";
import { createProject, listProjects } from "@/server/cinema";
import { ProjectCreate, body, handle } from "@/server/cinema-schemas";
import { handler } from "@/server/access/route";

export const GET = handler({ access: "signed-in" }, async () => {
  await connection();
  return handle(() => Response.json({ items: listProjects() }));
});

export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, ProjectCreate, "Give the project a name");
    return Response.json(createProject(input), { status: 201 });
  });
});
