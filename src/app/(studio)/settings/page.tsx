import type { Metadata } from "next";
import { AccountsAdmin } from "@/components/accounts-admin";
import { AccountGpuSection } from "@/components/gpu/account-gpu-section";
import { OwnerSettings, SettingsIntro } from "@/components/owner-settings";
import { PageHeader, PageShell } from "@/components/page-shell";
import { SettingsForm } from "@/components/settings-form";
import { starterPriceLine } from "@/lib/starter-prices";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader title="Settings" description={<SettingsIntro />} />
      <AccountGpuSection />
      <OwnerSettings>
        <SettingsForm prices={starterPriceLine()} />
      </OwnerSettings>
      <AccountsAdmin />
    </PageShell>
  );
}
