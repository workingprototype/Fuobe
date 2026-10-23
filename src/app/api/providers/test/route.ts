import { candidateValues, isTestProvider, settingProblem } from "@/lib/connections";
import { PROVIDERS } from "@/server/providers";
import { validateSetting, withCandidates, type SettingName } from "@/server/settings";

/**
 * Test a provider's connection. With `value` (the provider's main setting) or `values` (by setting
 * name), the test runs with those unsaved values instead of the saved ones, so Settings can check a
 * key or an address before saving it. Nothing is stored here.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { provider?: unknown; value?: unknown; values?: unknown };
  const provider = body.provider;
  const adapter = isTestProvider(provider) ? PROVIDERS[provider] : undefined;
  if (!isTestProvider(provider) || !adapter?.test) return Response.json({ ok: false, detail: "Unknown provider" }, { status: 400 });
  const values = candidateValues(provider, body.values, body.value) as Partial<Record<SettingName, string>>;
  try {
    for (const [name, v] of Object.entries(values)) validateSetting(name as SettingName, v);
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 400 });
  }
  const test = adapter.test.bind(adapter);
  try {
    const res = await withCandidates(values, test);
    // A rejected key that doesn't look like one: say what it should look like.
    const hint = !res.ok && Object.entries(values).map(([n, v]) => settingProblem(n, v ?? "")).find(Boolean);
    return Response.json(hint && !res.detail.includes(hint) ? { ...res, detail: `${res.detail} — ${hint}` } : res);
  } catch (e) {
    return Response.json({ ok: false, detail: `Couldn't run the test: ${(e as Error).message}` });
  }
}
