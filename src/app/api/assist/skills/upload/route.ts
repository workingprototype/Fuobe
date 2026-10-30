import { importSkill, SkillError } from "@/server/skills";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

const MAX_BYTES = 5 * 1024 * 1024;

/** Add a skill from a .zip / .skill archive or a SKILL.md (multipart "file"; `?replace=1` overwrites your skill of the same name). */
export const POST = handler({ access: "signed-in" }, async (request: Request) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a .zip, .skill or SKILL.md file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "That file is over 5 MB — a skill is mostly text; leave large assets out" }, { status: 413 });
  try {
    const replace = new URL(request.url).searchParams.get("replace") === "1";
    const r = importSkill({ name: file.name, data: Buffer.from(await file.arrayBuffer()) }, { replace });
    return Response.json(r, { status: r.replaced ? 200 : 201 });
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: e instanceof SkillError ? e.status : 500 });
  }
});
