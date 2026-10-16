"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, CircleAlert, Copy, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ManifestWorkflow } from "@/lib/comfy";
import { MODELS } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type WF = Omit<ManifestWorkflow, "models"> & { models: (ManifestWorkflow["models"][number] & { present: boolean | null })[] };

function downloadScript(wf: WF): string {
  const lines = wf.models
    .filter((m) => m.url && m.present !== true)
    .map((m) => `mkdir -p "$COMFYUI/models/${m.folder}" && wget -c -O "$COMFYUI/models/${m.folder}/${m.file}" "${m.url}"`);
  const nodes = wf.customNodes.map((n) => `git -C "$COMFYUI/custom_nodes" clone ${n.repo}`);
  return ["COMFYUI=${COMFYUI:-$HOME/ComfyUI}", ...nodes, ...lines].join("\n");
}

export function WorkflowsView() {
  const q = useQuery({
    queryKey: ["comfyui"],
    queryFn: async () =>
      (await (await fetch("/api/comfyui")).json()) as { reachable: boolean; generatedAt: string; comfyuiCommit?: string; workflows: WF[] },
  });
  if (q.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  const data = q.data!;
  const usedBy = (id: string) => MODELS.filter((m) => m.routes.some((r) => r.provider === "comfyui" && r.endpoint === id)).map((m) => m.name);

  return (
    <div className="space-y-6">
      <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-[13px]", data.reachable ? "bg-background" : "bg-brand-faint")}>
        {data.reachable ? <CheckCircle2 className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
        <span>
          {data.reachable ? "Connected to ComfyUI — model checkmarks below reflect what’s installed." : "ComfyUI is not reachable, so open-source runs fall back to demo output."}
        </span>
        <Link href="/settings" className="ml-auto text-brand-text hover:underline">
          Server settings
        </Link>
      </div>
      {!data.workflows.length && <p className="text-sm text-muted-foreground">No workflows in workflows/comfyui/manifest.json yet.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {data.workflows.map((wf) => {
          const missing = wf.models.filter((m) => m.present === false).length;
          const total = wf.models.reduce((a, m) => a + (m.sizeGb ?? 0), 0);
          return (
            <article key={wf.id} className="flex flex-col gap-3 rounded-xl border bg-background p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{wf.title}</h3>
                  <p className="font-mono text-[11px] text-muted-foreground">{wf.id}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Badge variant="secondary" className="rounded-[4px] text-[11px]">
                    {wf.capability}
                  </Badge>
                  <Badge className={cn("rounded-[4px] text-[11px]", wf.validated ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
                    {wf.validated ? "validated" : "unverified"}
                  </Badge>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {wf.source}
                {wf.vramGb ? ` · ~${wf.vramGb} GB VRAM` : ""}
                {total ? ` · ${total.toFixed(1)} GB of models` : ""}
                {usedBy(wf.id).length ? ` · used by ${usedBy(wf.id).join(", ")}` : ""}
              </p>
              <ul className="space-y-1 text-[12px]">
                {wf.models.map((m) => (
                  <li key={m.file} className="flex items-center gap-2">
                    {m.present === true ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                    ) : m.present === false ? (
                      <CircleAlert className="size-3.5 shrink-0 text-warning" />
                    ) : (
                      <Circle className="size-3.5 shrink-0 text-subtle-foreground" />
                    )}
                    <span className="truncate font-mono">{m.file}</span>
                    <span className="shrink-0 text-muted-foreground">{m.folder}</span>
                    {m.sizeGb ? <span className="ml-auto shrink-0 font-mono text-muted-foreground">{m.sizeGb} GB</span> : null}
                    {m.url && (
                      <a href={m.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Download">
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              {wf.customNodes.length > 0 && (
                <p className="text-[12px] text-muted-foreground">
                  Custom nodes:{" "}
                  {wf.customNodes.map((n, i) => (
                    <a key={n.repo} href={n.repo} target="_blank" rel="noreferrer" className="text-brand-text hover:underline">
                      {n.name}
                      {i < wf.customNodes.length - 1 ? ", " : ""}
                    </a>
                  ))}
                </p>
              )}
              {wf.notes && <p className="text-[12px] leading-relaxed text-muted-foreground">{wf.notes}</p>}
              <div className="mt-auto flex gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(downloadScript(wf));
                    toast("Install commands copied");
                  }}
                >
                  <Copy /> {missing ? `Copy install commands (${missing} missing)` : "Copy install commands"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
