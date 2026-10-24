import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { SettingsForm } from "@/components/settings-form";
import { starterPriceLine } from "@/lib/starter-prices";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader title="Settings" description="Choose open source, paid APIs or both, connect providers, point Fuobe at your ComfyUI server, and choose how prompts get enhanced. Keys stay on this server." />
      <SettingsForm prices={starterPriceLine()} />
    </PageShell>
  );
}
