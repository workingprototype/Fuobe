import { badBody, recipeFailure, RunBody } from "@/server/recipe-routes";
import { runRecipe } from "@/server/recipes";
import { handler } from "@/server/access/route";

/** Run a skill's recipe with new inputs, once or once per row, with no LLM. Every row is checked before any starts. */
export const POST = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/assist/skills/[name]/run">) => {
  const parsed = RunBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    const { engine, ...input } = parsed.data;
    return Response.json(await runRecipe((await ctx.params).name, input, engine), { status: 201 });
  } catch (e) {
    return recipeFailure(e);
  }
});
