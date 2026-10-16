import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PageHeader, PresetGallery } from "@/components/preset-gallery";
import { APPS } from "@/lib/catalog";

export const metadata: Metadata = { title: "Apps" };

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Apps"
        description="One-click tools for faces, products, styles and fun. Every app runs on a frontier cloud model or an open-source ComfyUI workflow."
      />
      <PresetGallery presets={APPS} href="/apps/{id}" />
    </PageShell>
  );
}
