import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PageHeader, PresetGallery } from "@/components/preset-gallery";
import { MOTIONS } from "@/lib/catalog";

export const metadata: Metadata = { title: "Camera motions" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Camera motions"
        description="Director-grade camera moves for any image. Pick a move, drop in a start frame, and it runs on Kling, Veo, Seedance… or Wan 2.2 on your own GPU."
      />
      <PresetGallery presets={MOTIONS} href="/video?preset={id}" />
    </PageShell>
  );
}
