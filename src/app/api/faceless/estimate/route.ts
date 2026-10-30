import { z } from "zod";
import { BlockSchema, body, estimateEpisode, GenreSchema, handle, SettingsSchema } from "@/server/faceless";
import { handler } from "@/server/access/route";

const Ask = z.object({
  kind: z.enum(["faceless", "explainer"]),
  settings: SettingsSchema,
  blocks: z.array(BlockSchema).max(80).optional(),
  genre: GenreSchema.optional(),
});

/** What an episode would cost (by part), whether it runs as a demo, and what's in the way. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => Response.json(estimateEpisode(await body(request, Ask, "Those settings aren't valid"))));
});
