import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery } from "@/components/preset-gallery";
import { EFFECTS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-card-data";

export const metadata: Metadata = { title: "Effects" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Effects"
        description="Explosions, transformations and viral VFX from a single photo. Fuobe DoP runs each with its effect LoRA where one is cleared, free on your GPU or hosted in the cloud; colour looks are graded in your browser."
      />
      <PresetGallery presets={EFFECTS.map(toPresetCard)} href="/video?preset={id}" noun="effects" />
    </PageShell>
  );
}
