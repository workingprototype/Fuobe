import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PageHeader } from "@/components/preset-gallery";
import { WorkflowsView } from "@/components/workflows-view";

export const metadata: Metadata = { title: "ComfyUI workflows" };

export default function Page() {
  return (
    <PageShell wide>
      <PageHeader
        title="ComfyUI workflows"
        description="The open-source engine. Each workflow is an API-format ComfyUI graph exported from the official templates, with bindings Fuobe uses to inject prompts, images and settings."
      />
      <WorkflowsView />
    </PageShell>
  );
}
