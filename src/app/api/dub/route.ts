import { connection } from "next/server";
import { z } from "zod";
import { ONE_SHOT_MODELS } from "@/lib/av/dub";
import { createDubSession, listDubSessions, previewDub } from "@/server/dub";
import { priceAs } from "@/server/visitor";

const Body = z.object({
  engine: z.enum(["cloud", "open"]),
  mode: z.enum(["oneshot", "steps"]),
  video: z.string().startsWith("/api/files/").max(500),
  title: z.string().max(200).optional(),
  source: z.string().max(12).optional(),
  targets: z.array(z.string().min(2).max(12)).min(1).max(8),
  model: z.enum(ONE_SHOT_MODELS).optional(),
  /** The video's length as the browser measured it (seconds). */
  duration: z.number().positive().max(36_000).optional(),
});

/** Recent dubs with the state of every step. */
export async function GET(request: Request) {
  await connection();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 30);
  return Response.json({ items: listDubSessions(Number.isFinite(limit) ? limit : 30) });
}

/** Start a dub: one-shot jobs (cloud) or the prepare pipeline (both engines); `?preview=1` only prices it. */
async function post(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const msg = first?.path[0] === "video" ? "Add the video to translate" : first?.path[0] === "targets" ? "Pick up to 8 languages to dub into" : "Check the dub settings";
    return Response.json({ error: msg }, { status: 400 });
  }
  try {
    if (new URL(request.url).searchParams.get("preview") === "1") return Response.json(previewDub(parsed.data));
    return Response.json(createDubSession(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
