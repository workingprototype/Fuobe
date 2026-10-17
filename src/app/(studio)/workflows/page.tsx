import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { WorkflowsView } from "@/components/workflows-view";
import { MODELS } from "@/lib/catalog";

export const metadata: Metadata = { title: "ComfyUI workflows" };

/** Which open models run each workflow; computed here so the view needs no catalog in the browser. */
const ROUTES = MODELS.flatMap((m) => m.routes.filter((r) => r.provider === "comfyui").map((r) => ({ endpoint: r.endpoint, name: m.name })));

export default function Page() {
  return (
    <PageShell wide>
      <PageHeader
        title="ComfyUI workflows"
        description="The open-source engine. Each workflow is an API-format ComfyUI graph exported from the official templates, with bindings Fuobe uses to inject prompts, images and settings."
      />
      <WorkflowsView routes={ROUTES} />
    </PageShell>
  );
}
