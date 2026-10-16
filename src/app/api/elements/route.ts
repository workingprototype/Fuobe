import { connection } from "next/server";
import { z } from "zod";
import { createElement, listElements } from "@/server/elements";

const Kind = z.enum(["character", "location", "prop", "style"]);

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  kind: Kind.default("character"),
  description: z.string().max(500).optional(),
  references: z.array(z.string().startsWith("/api/files/")).max(20),
});

export async function GET(request: Request) {
  await connection();
  const kind = Kind.safeParse(new URL(request.url).searchParams.get("kind"));
  return Response.json({ items: listElements(kind.success ? kind.data : undefined) });
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the element a name" }, { status: 400 });
  if (!parsed.data.references.length && !parsed.data.description?.trim()) {
    return Response.json({ error: "Add at least one photo or a description" }, { status: 400 });
  }
  return Response.json(createElement(parsed.data), { status: 201 });
}
