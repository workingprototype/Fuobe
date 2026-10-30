import { connection } from "next/server";
import { publicSettings, setSetting, SETTINGS, validateSetting, type SettingName } from "@/server/settings";
import { rethrowAccess } from "@/server/access/errors";
import { handler } from "@/server/access/route";

export const GET = handler({ access: "signed-in" }, async () => {
  await connection();
  return Response.json({ settings: publicSettings() });
});

export const PUT = handler({ access: "perm:install.settings" }, async (request: Request) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const entries = Object.entries(body).filter(([name, value]) => name in SETTINGS && typeof value === "string") as [SettingName, string][];
  try {
    entries.forEach(([name, value]) => validateSetting(name, value.trim()));
  } catch (e) {
    rethrowAccess(e);
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  for (const [name, value] of entries) setSetting(name, value.trim());
  return Response.json({ settings: publicSettings() });
});
