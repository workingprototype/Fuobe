import { connection } from "next/server";
import { z } from "zod";
import { createPalette, listPalettes, signatureCaps } from "@/server/palettes";

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  colors: z.array(z.string().max(9)).min(1).max(12),
  background: z.string().max(9).nullable().optional(),
  source: z.enum(["manual", "images"]).default("manual"),
  thumb: z.string().startsWith("/api/files/").nullable().optional(),
});

/** Your colour signatures and the 50 built-in palettes, plus which models take a palette natively. */
export async function GET() {
  await connection();
  return Response.json({ items: listPalettes(), caps: signatureCaps() });
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the palette a name and 1–12 colours" }, { status: 400 });
  try {
    return Response.json(createPalette(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
