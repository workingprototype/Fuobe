import { z } from "zod";
import { attachLora } from "@/server/training";
import { getElement } from "@/server/elements";

const Body = z.object({ file: z.string().min(1).max(300), trigger: z.string().max(80).default(""), modelId: z.string().default("oss-z-image-turbo") });

/** Attach a LoRA you trained yourself (already in ComfyUI/models/loras). */
export async function POST(request: Request, ctx: RouteContext<"/api/elements/[id]/lora">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter the LoRA file name" }, { status: 400 });
  try {
    attachLora(id, parsed.data);
    return Response.json(getElement(id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
