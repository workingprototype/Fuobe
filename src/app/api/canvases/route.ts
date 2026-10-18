import { connection } from "next/server";
import { z } from "zod";
import { createCanvas, listCanvases, parseGraph } from "@/server/canvas";

const Body = z.object({
  name: z.string().max(80).optional(),
  templateId: z.string().max(60).optional(),
  engine: z.enum(["cloud", "open"]).optional(),
  graph: z.unknown().optional(),
});

export async function GET() {
  await connection();
  return Response.json({ items: listCanvases() });
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid canvas" }, { status: 400 });
  const { graph: rawGraph, ...rest } = parsed.data;
  const graph = rawGraph === undefined ? undefined : parseGraph(rawGraph);
  if (graph === null) return Response.json({ error: "That board couldn't be read" }, { status: 400 });
  try {
    return Response.json(createCanvas({ ...rest, graph }), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
