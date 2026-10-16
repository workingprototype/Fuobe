import { connection } from "next/server";
import { higgsfieldKey, higgsfieldPresets } from "@/server/providers/higgsfield";

/** Soul styles, Genjutsu looks and Marketing Studio templates, straight from Higgsfield. */
export async function GET(request: Request) {
  await connection();
  const source = new URL(request.url).searchParams.get("source") ?? "";
  if (!higgsfieldKey()) return Response.json({ items: [], error: "Add a Higgsfield API key in Settings to load these" });
  try {
    return Response.json({ items: await higgsfieldPresets(source) });
  } catch (e) {
    return Response.json({ items: [], error: (e as Error).message }, { status: 502 });
  }
}
