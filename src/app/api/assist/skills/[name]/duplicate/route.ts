import { duplicateSkill, SkillError } from "@/server/skills";
import { handler } from "@/server/access/route";

/** Copy a skill into My skills (the way to change a built-in). */
export const POST = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/assist/skills/[name]/duplicate">) => {
  try {
    return Response.json(duplicateSkill((await ctx.params).name), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof SkillError ? e.status : 500 });
  }
});
