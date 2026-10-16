import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PageHeader } from "@/components/preset-gallery";
import { SettingsForm } from "@/components/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader title="Settings" description="Connect cloud providers, point Fuobe at your ComfyUI server, and choose how prompts get enhanced. Keys stay on this server." />
      <SettingsForm />
    </PageShell>
  );
}
