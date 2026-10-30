import { connection } from "next/server";
import { recipeFailure } from "@/server/recipe-routes";
import { recipeView, saveRecipe } from "@/server/recipes";
import { handler } from "@/server/access/route";

/** A skill's recipe with where it runs and what was checked (engines, ready, needs a re-check). */
export const GET = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/assist/skills/[name]/recipe">) => {
  await connection();
  try {
    return Response.json(recipeView((await ctx.params).name));
  } catch (e) {
    return recipeFailure(e);
  }
});

/** Save a user skill's recipe.json (it starts unchecked); every problem is named. */
export const PUT = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/assist/skills/[name]/recipe">) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Send the recipe as JSON" }, { status: 400 });
  try {
    const { name } = await ctx.params;
    saveRecipe(name, body);
    return Response.json(recipeView(name));
  } catch (e) {
    return recipeFailure(e);
  }
});
