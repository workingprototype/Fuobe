import { z } from "zod";
import { badBody, recipeFailure } from "@/server/recipe-routes";
import { checkDraft } from "@/server/recipes";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

const Body = z.object({
  recipe: z.unknown(),
  /** `plan` prices it (quick); `demo` adds the free dry run on the demo provider. */
  level: z.enum(["plan", "demo"]).default("plan"),
  title: z.string().trim().max(80).optional(),
});

/** Check a drafted skill's recipe before it is saved: free, with or without keys. What passed is kept for its save. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    return Response.json(await checkDraft(parsed.data.recipe, parsed.data.level, parsed.data.title || undefined));
  } catch (e) {
    rethrowAccess(e);
    return recipeFailure(e);
  }
});
