import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery } from "@/components/preset-gallery";
import { EFFECTS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-cards";

export const metadata: Metadata = { title: "Effects" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Effects"
        description="Explosions, transformations and viral VFX from a single photo. Open-source versions use Wan effect LoRAs where available."
      />
      <PresetGallery presets={EFFECTS.map(toPresetCard)} href="/video?preset={id}" noun="effects" />
    </PageShell>
  );
}
