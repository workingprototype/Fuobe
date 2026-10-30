import { connection } from "next/server";
import { createKatana, KatanaBody, listKatana, previewKatana } from "@/server/katana";
import { handler } from "@/server/access/route";

/** Recent Katana runs with the state of every step. */
export const GET = handler({ access: "signed-in" }, async (request: Request) => {
  await connection();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  return Response.json({ items: listKatana(Number.isFinite(limit) ? limit : 20) });
});

/** Start a run; `?preview=1` only plans and prices it (segments, steps, cost). */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const parsed = KatanaBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const path = String(parsed.error.issues[0]?.path[0] ?? "");
    const msg = path === "reference" ? "Add the reference edit" : path === "photos" ? "Add 1–5 photos of your subject" : path === "instructions" ? "Keep the instructions under 2,000 characters" : "Check the Katana settings";
    return Response.json({ error: msg }, { status: 400 });
  }
  try {
    if (new URL(request.url).searchParams.get("preview") === "1") return Response.json(previewKatana(parsed.data));
    return Response.json(createKatana(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
});
