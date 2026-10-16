import { connection } from "next/server";
import { z } from "zod";
import { createCharacter, listCharacters } from "@/server/characters";

const Body = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  references: z.array(z.string().startsWith("/api/files/")).min(1).max(20),
});

export async function GET() {
  await connection();
  return Response.json({ items: listCharacters() });
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give your character a name and at least one photo" }, { status: 400 });
  return Response.json(createCharacter(parsed.data), { status: 201 });
}
