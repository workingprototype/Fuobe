import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PageHeader, PresetGallery } from "@/components/preset-gallery";
import { EFFECTS } from "@/lib/catalog";

export const metadata: Metadata = { title: "Effects" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Effects"
        description="Explosions, transformations and viral VFX from a single photo. Open-source versions use Wan effect LoRAs where available."
      />
      <PresetGallery presets={EFFECTS} href="/video?preset={id}" />
    </PageShell>
  );
}
