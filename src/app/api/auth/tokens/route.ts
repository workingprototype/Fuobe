import { connection } from "next/server";
import { z } from "zod";
import { resolvePrincipal, type Actor } from "@/server/identity/principal";
import { createToken, listTokens, revokeToken } from "@/server/identity/tokens";

/**
 * API tokens, managed from a signed-in browser (or Just me on this computer): a token can't mint or revoke
 * tokens. Each person sees and revokes their own (admins revoking anyone's arrives with the admin console).
 */
async function browserActor(request: Request): Promise<Actor | Response> {
  const { actor } = await resolvePrincipal(request);
  if (actor && (actor.via === "session" || actor.via === "local")) return actor;
  return Response.json({ error: "Manage API tokens from a signed-in browser" }, { status: 403 });
}

export async function GET(request: Request) {
  await connection();
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  return Response.json({ tokens: listTokens(actor.userId) });
}

/** Create a token; the full value is in this response only. */
export async function POST(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const parsed = z.object({ name: z.string().max(60) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Name the token" }, { status: 400 });
  return Response.json(createToken(actor.userId, parsed.data.name), { status: 201 });
}

export async function DELETE(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Which token?" }, { status: 400 });
  if (!revokeToken(actor.userId, id)) return Response.json({ error: "No such token" }, { status: 404 });
  return new Response(null, { status: 204 });
}
