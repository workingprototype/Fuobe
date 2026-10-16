import { trainingKit } from "@/server/training";

/** Dataset + AI-Toolkit config + README, to train the element's LoRA on any GPU. */
export async function GET(_req: Request, ctx: RouteContext<"/api/elements/[id]/training-kit">) {
  const { id } = await ctx.params;
  try {
    const kit = await trainingKit(id);
    return new Response(new Uint8Array(kit.data), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${kit.name}"` },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
