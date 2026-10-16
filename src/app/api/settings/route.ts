import { connection } from "next/server";
import { publicSettings, setSetting, SETTINGS, validateSetting, type SettingName } from "@/server/settings";

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
  for (const [name, value] of entries) setSetting(name, value.trim());
  return Response.json({ settings: publicSettings() });
}
