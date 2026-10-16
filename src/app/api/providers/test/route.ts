import { PROVIDERS } from "@/server/providers";
import type { ProviderId } from "@/lib/catalog/types";

export async function POST(request: Request) {
  const { provider } = (await request.json().catch(() => ({}))) as { provider?: ProviderId };
  const adapter = provider ? PROVIDERS[provider] : undefined;
  if (!adapter?.test) return Response.json({ ok: false, detail: "Unknown provider" }, { status: 400 });
  return Response.json(await adapter.test());
}
