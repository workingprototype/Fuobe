import { connection } from "next/server";
import { z } from "zod";
import { createToken, listTokens, revokeToken } from "@/server/identity/tokens";
import { currentActor } from "@/server/access/actor";
import { gate } from "@/server/access/gates";
import { handler } from "@/server/access/route";

/**
 * API tokens, managed from a signed-in browser (or Just me on this computer): a token can't mint or revoke
 * tokens (access "browser" answers it 403). Each person sees and revokes their own (admins revoking anyone's arrives
 * with the admin console).
 */

export const GET = handler({ access: "browser" }, async () => {
  await connection();
  const actor = currentActor();
  return Response.json({ tokens: listTokens(actor.userId) });
});

/** Create a token; the full value is in this response only. */
export const POST = handler({ access: "browser" }, async (request: Request) => {
  const actor = currentActor();
  gate("token.create", actor);
  const parsed = z.object({ name: z.string().max(60) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Name the token" }, { status: 400 });
  return Response.json(createToken(actor.userId, parsed.data.name), { status: 201 });
});

export const DELETE = handler({ access: "browser" }, async (request: Request) => {
  const actor = currentActor();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Which token?" }, { status: 400 });
  if (!revokeToken(actor.userId, id)) return Response.json({ error: "No such token" }, { status: 404 });
  return new Response(null, { status: 204 });
});
