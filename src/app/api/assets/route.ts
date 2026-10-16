import { connection } from "next/server";
import { listAssets } from "@/server/storage";
import type { MediaKind } from "@/lib/catalog/types";

export async function GET(request: Request) {
  await connection();
  const u = new URL(request.url);
  return Response.json({
    items: listAssets({
      source: (u.searchParams.get("source") as "upload" | "generation" | null) ?? undefined,
      kind: (u.searchParams.get("kind") as MediaKind | null) ?? undefined,
      limit: Number(u.searchParams.get("limit") ?? 60),
    }),
  });
}
