import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { ModelsTable } from "@/components/models-table";
import { MODELS } from "@/lib/catalog";
import { toModelRow } from "@/lib/model-rows";

export const metadata: Metadata = { title: "Models" };

export default function Page() {
  return (
    <PageShell wide>
      <PageHeader
        title="Models"
        description="Every model Fuobe can drive. Cloud models run through your fal.ai, Replicate or Higgsfield key; open-source models run as ComfyUI workflows on your own GPU."
      />
      {/* Slim rows only: the catalog (field maps, options, LoRAs) stays on the server. */}
      <ModelsTable models={MODELS.map(toModelRow)} />
    </PageShell>
  );
}
