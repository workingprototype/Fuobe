import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery } from "@/components/preset-gallery";
import { MOTIONS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-cards";

export const metadata: Metadata = { title: "Camera motions" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Camera motions"
        description="Director-grade camera moves for any image. Pick a move, drop in a start frame: Fuobe DoP runs it with its camera LoRA, free on your GPU or hosted in the cloud. Any other video model takes the move's words."
      />
      <PresetGallery presets={MOTIONS.map(toPresetCard)} href="/video?preset={id}" noun="moves" />
    </PageShell>
  );
}
