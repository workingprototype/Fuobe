import { episodeView, handle, renderEpisode, retryEpisode, rewriteEpisode, undoChange } from "@/server/faceless";

const ACTIONS = {
  /** Render the reviewed script. */
  render: renderEpisode,
  /** Redo the failed steps and what waited on them. */
  retry: retryEpisode,
  /** Write the script again. */
  rewrite: rewriteEpisode,
  /** Go back to the version before the last change. */
  undo: undoChange,
} as const;

export async function POST(_req: Request, ctx: RouteContext<"/api/faceless/episodes/[id]/[action]">) {
  return handle(async () => {
    const { id, action } = await ctx.params;
    const run = ACTIONS[action as keyof typeof ACTIONS];
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });
    run(id);
    return Response.json(episodeView(id));
  });
}
