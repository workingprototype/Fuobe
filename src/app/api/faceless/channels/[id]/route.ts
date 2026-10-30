import { connection } from "next/server";
import { z } from "zod";
import { body, deleteChannel, FacelessError, GenreSchema, getChannel, handle, listEpisodes, SettingsSchema, updateChannel } from "@/server/faceless";
import { handler } from "@/server/access/route";

const Patch = z.object({
  name: z.string().max(60).optional(),
  idea: z.string().max(500).optional(),
  genre: GenreSchema.optional(),
  avatarUrl: z.string().startsWith("/api/files/").max(500).nullable().optional(),
  reference: z.string().max(500).nullable().optional(),
  settings: SettingsSchema.pick({ engine: true, styleId: true, styleRefs: true, voice: true, aspect: true, subtitles: true, music: true, animation: true, length: true }).partial().optional(),
});

/** The channel with its episodes. */
export const GET = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/faceless/channels/[id]">) => {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const channel = getChannel(id);
    if (!channel) throw new FacelessError("Channel not found", 404);
    return Response.json({ channel, episodes: listEpisodes({ channelId: id, limit: 200 }) });
  });
});

export const PATCH = handler({ access: "signed-in" }, async (request: Request, ctx: RouteContext<"/api/faceless/channels/[id]">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = await body(request, Patch, "Those channel settings aren't valid");
    return Response.json(await updateChannel(id, patch));
  });
});

/** Deletes the channel and its episodes, stopping what they still render (finished videos stay in the Library). */
export const DELETE = handler({ access: "signed-in" }, async (_req: Request, ctx: RouteContext<"/api/faceless/channels/[id]">) => {
  return handle(async () => {
    const { id } = await ctx.params;
    await deleteChannel(id);
    return new Response(null, { status: 204 });
  });
});
