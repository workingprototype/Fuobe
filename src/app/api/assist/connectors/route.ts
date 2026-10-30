import { connection } from "next/server";
import { ConnectorError, createConnector, listConnectors } from "@/server/assist/connectors";
import { ConnectorBody } from "@/server/assist/schemas";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

/** Custom MCP connectors, tokens masked. */
export const GET = handler({ access: "signed-in" }, async () => {
  await connection();
  return Response.json({ items: listConnectors() });
});

export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const parsed = ConnectorBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the connector's name, URL and token" }, { status: 400 });
  try {
    return Response.json(createConnector(parsed.data), { status: 201 });
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: e instanceof ConnectorError ? e.status : 500 });
  }
});
