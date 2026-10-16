import { connection } from "next/server";
import { publicSettings, setSetting, SETTINGS, type SettingName } from "@/server/settings";

export async function GET() {
  await connection();
  return Response.json({ settings: publicSettings() });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  for (const [name, value] of Object.entries(body)) {
    if (!(name in SETTINGS) || typeof value !== "string") continue;
    setSetting(name as SettingName, value.trim());
  }
  return Response.json({ settings: publicSettings() });
}
