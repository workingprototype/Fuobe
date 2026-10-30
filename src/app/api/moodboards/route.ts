import { connection } from "next/server";
import { z } from "zod";
import { createMoodboard, curatedMoodboards, listMoodboards } from "@/server/moodboards";
import { handler } from "@/server/access/route";

const Body = z.object({
  name: z.string().max(200),
  images: z.array(z.string().startsWith("/api/files/")).max(200),
  collages: z.array(z.string().startsWith("/api/files/")).max(2).optional(),
  engine: z.enum(["cloud", "open"]).default("cloud"),
});

/** Your moodboards (each one's status follows its cover job) and Soul 2.0's curated looks. */
export const GET = handler({ access: "signed-in" }, async () => {
  await connection();
  return Response.json({ items: listMoodboards(), curated: curatedMoodboards() });
});

export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Upload at least 5 photos to continue." }, { status: 400 });
  try {
    return Response.json(createMoodboard(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
});
