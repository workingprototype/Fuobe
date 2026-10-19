import { connection } from "next/server";
import { skillMarkdown } from "@/server/skills";

/** The skill as SKILL.md, to keep or share (upload it on another Fuobe, or use it with Claude). */
export async function GET(_req: Request, ctx: RouteContext<"/api/assist/skills/[name]/download">) {
  await connection();
  const { name } = await ctx.params;
  const md = skillMarkdown(name);
  if (md === null) return Response.json({ error: "No such skill" }, { status: 404 });
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-SKILL.md"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
