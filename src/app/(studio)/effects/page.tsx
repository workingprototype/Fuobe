import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery } from "@/components/preset-gallery";
import { EFFECTS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-card-data";

export const metadata: Metadata = {
  title: "Effects",
  description: "Explosions, transformations and viral VFX from one photo, made with open-source models on your own GPU.",
};

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Effects"
        description="Explosions, transformations and viral VFX from one photo. Runs free on your GPU or in the cloud; color looks apply instantly in your browser."
      />
      <PresetGallery presets={EFFECTS.map(toPresetCard)} href="/video?preset={id}" noun="effects" />
    </PageShell>
  );
}
