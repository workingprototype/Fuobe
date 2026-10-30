import { connection } from "next/server";
import { SkillBody } from "@/server/assist/schemas";
import { createSkill, listSkills, SkillError } from "@/server/skills";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

/** Every skill: built-in (from skills/) and the user's own. */
export const GET = handler({ access: "signed-in" }, async () => {
  await connection();
  return Response.json({ items: listSkills() });
});

/** Create a skill from the form (name, title, description, when to use, instructions). */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const parsed = SkillBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the skill a name, a description and instructions" }, { status: 400 });
  try {
    return Response.json(createSkill(parsed.data), { status: 201 });
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: e instanceof SkillError ? e.status : 500 });
  }
});
