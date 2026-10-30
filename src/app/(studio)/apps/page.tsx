import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery } from "@/components/preset-gallery";
import { APPS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-card-data";

export const metadata: Metadata = { title: "Apps" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Apps"
        description="One-click tools for faces, products, styles and fun. Every app runs on a frontier cloud model or an open-source ComfyUI workflow."
      />
      {/* Slim card data only: no prompt templates, routes or LoRA URLs in the page payload. */}
      <PresetGallery presets={APPS.map(toPresetCard)} href="/apps/{id}" noun="apps" />
    </PageShell>
  );
}
