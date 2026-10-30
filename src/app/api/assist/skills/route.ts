import { connection } from "next/server";
import { SkillBody } from "@/server/assist/schemas";
import { createSkill, listSkills, SkillError } from "@/server/skills";

/** Every skill: built-in (from skills/) and the user's own. */
export async function GET() {
  await connection();
  return Response.json({ items: listSkills() });
}

/** Create a skill from the form (name, title, description, when to use, instructions). */
export async function POST(request: Request) {
  const parsed = SkillBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the skill a name, a description and instructions" }, { status: 400 });
  try {
    return Response.json(createSkill(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof SkillError ? e.status : 500 });
  }
}
