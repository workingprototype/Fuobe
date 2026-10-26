import { z } from "zod";
import { MAX_CLOTHING, MAX_DIRECTION } from "@/lib/influencer";
import { createInfluencer, previewInfluencer, type InfluencerBody } from "@/server/influencer";

const File = z.string().startsWith("/api/files/").max(500);

const Body = z.object({
  engine: z.enum(["cloud", "open"]),
  state: z.record(z.string(), z.unknown()),
  direction: z.string().max(MAX_DIRECTION).optional(),
  start: z.enum(["scratch", "reference", "face"]),
  photo: File.optional(),
  clothing: z.array(File).max(MAX_CLOTHING).optional(),
  modelId: z.string().max(60).optional(),
});

/** What's wrong with a body, in Higgsfield's words where it has them. */
function bodyError(issues: z.core.$ZodIssue[]): string {
  const at = (key: string) => issues.some((i) => i.path[0] === key);
  if (at("engine")) return "Pick Cloud or Open source";
  if (at("direction")) return "Keep the direction under 4,000 characters";
  if (at("clothing")) return issues.some((i) => i.path[0] === "clothing" && i.code === "too_big") ? "You can add up to three clothing references" : "Upload the clothing references again";
  if (at("photo")) return "Upload the photo again";
  if (at("start")) return "Pick how to start: from scratch, from a reference or with your face";
  return "Build your character first";
}

/**
 * AI Influencer builder: a character sheet from the builder's picks — Nano Banana Pro or Seedream 5.0
 * Pro on the cloud, the Soul Cast sheet workflow (plus Qwen-Image-Edit 2511 for a face, a reference or
 * clothing) on the open engine. `?preview=1` prices it instead.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: bodyError(parsed.error.issues) }, { status: 400 });
  const body = parsed.data as InfluencerBody;
  if (new URL(request.url).searchParams.get("preview")) return Response.json(previewInfluencer(body));
  try {
    return Response.json(createInfluencer(body), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
