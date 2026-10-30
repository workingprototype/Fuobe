import { connection } from "next/server";
import { createCustomPreset, listCustomPresets } from "@/server/shorts";
import { PresetBodySchema, body, handle } from "@/server/shorts-schemas";
import { handler } from "@/server/access/route";

/** The user's own presets ("Created by you"). */
export const GET = handler({ access: "signed-in" }, async () => {
  await connection();
  return handle(() => Response.json({ items: listCustomPresets() }));
});

/** Create a preset from up to 10 reference images. */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  return handle(async () => {
    const input = await body(request, PresetBodySchema, "Add 1–10 reference images");
    return Response.json(createCustomPreset(input), { status: 201 });
  });
});
