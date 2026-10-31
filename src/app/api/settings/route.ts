import { connection } from "next/server";
import { forgetComputer } from "@/server/computer/tasks";
import { getSetting, publicSettings, setSetting, SETTINGS, validateSetting, type SettingName } from "@/server/settings";

export async function GET() {
  await connection();
  return Response.json({ settings: publicSettings() });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const entries = Object.entries(body).filter(([name, value]) => name in SETTINGS && typeof value === "string") as [SettingName, string][];
  try {
    entries.forEach(([name, value]) => validateSetting(name, value.trim()));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const onComputer = getSetting("comfyWhere") === "computer";
  for (const [name, value] of entries) setSetting(name, value.trim());
  // ComfyUI no longer runs on the owner's computer: the runs still going there stop, saying why.
  if (onComputer && getSetting("comfyWhere") !== "computer") forgetComputer("owner", "switched");
  return Response.json({ settings: publicSettings() });
}
