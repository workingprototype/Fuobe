import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PageHeader } from "@/components/preset-gallery";
import { ModelsTable } from "@/components/models-table";

export const metadata: Metadata = { title: "Models" };

export default function Page() {
  return (
    <PageShell wide>
      <PageHeader
        title="Models"
        description="Every model Fuobe can drive. Cloud models run through your fal.ai or Replicate key; open-source models run as ComfyUI workflows on your own GPU."
      />
      <ModelsTable />
    </PageShell>
  );
}
