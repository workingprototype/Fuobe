"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, CircleAlert, Copy, ExternalLink, RotateCcw, Search, Workflow } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProgressive } from "@/components/use-progressive";
import { copyText } from "@/lib/clipboard";
import type { ManifestWorkflow } from "@/lib/comfy";
import { installScript } from "@/lib/comfy-install";
import { cn } from "@/lib/utils";
import { capabilityGroup, usedByIndex, WORKFLOW_GROUPS, type ComfyRoute } from "@/lib/workflow-usage";

type WF = Omit<ManifestWorkflow, "models"> & { models: (ManifestWorkflow["models"][number] & { present: boolean | null })[] };

interface ComfyStatus {
  reachable: boolean;
  generatedAt: string;
  comfyuiCommit?: string;
  workflows: WF[];
}

async function fetchStatus(): Promise<ComfyStatus> {
  const res = await fetch("/api/comfyui");
  const body = (await res.json().catch(() => ({}))) as Partial<ComfyStatus> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Couldn’t load the workflow library (${res.status})`);
  return { reachable: !!body.reachable, generatedAt: body.generatedAt ?? "", comfyuiCommit: body.comfyuiCommit, workflows: body.workflows ?? [] };
}

function WorkflowCard({ wf, usedBy }: { wf: WF; usedBy: string[] }) {
  const missing = wf.models.filter((m) => m.present === false && !m.optional).length;
  const total = wf.models.reduce((a, m) => a + (m.optional ? 0 : (m.sizeGb ?? 0)), 0);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="font-medium break-words">{wf.title}</h2>
          <p className="font-mono text-[11px] break-all text-muted-foreground">{wf.id}</p>
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
      <p className="text-[12px] break-words text-muted-foreground">
        {wf.source}
        {wf.vramGb ? ` · ~${wf.vramGb} GB VRAM` : ""}
        {total ? ` · ${total.toFixed(1)} GB of models` : ""}
        {usedBy.length ? ` · used by ${usedBy.join(", ")}` : ""}
      </p>
      {wf.models.length > 0 && (
        <ul className="space-y-1 text-[12px]">
          {wf.models.map((m) => (
            <li key={m.file} className="flex min-w-0 items-center gap-2">
              {m.present === true ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-label="Installed" />
              ) : m.present === false && !m.optional ? (
                <CircleAlert className="size-3.5 shrink-0 text-warning" aria-label="Missing" />
              ) : (
                <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-label="Unknown" />
              )}
              <span className="min-w-0 truncate font-mono" title={m.file}>
                {m.file}
              </span>
              <span className="hidden shrink-0 text-muted-foreground sm:inline">{m.folder}</span>
              {m.optional && <span className="shrink-0 text-muted-foreground">optional</span>}
              {m.sizeGb ? <span className="ml-auto shrink-0 font-mono text-muted-foreground">{m.sizeGb} GB</span> : null}
              {m.url && (
                <a href={m.url} target="_blank" rel="noreferrer" className={cn("shrink-0 text-muted-foreground hover:text-foreground", !m.sizeGb && "ml-auto")} aria-label={`Download ${m.file}`}>
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {wf.customNodes.length > 0 && (
        <p className="text-[12px] break-words text-muted-foreground">
          Custom nodes:{" "}
          {wf.customNodes.map((n, i) => (
            <a key={n.repo} href={n.repo} target="_blank" rel="noreferrer" className="text-brand-text underline underline-offset-2">
              {n.name}
              {i < wf.customNodes.length - 1 ? ", " : ""}
            </a>
          ))}
        </p>
      )}
      {wf.notes && <p className="text-[12px] leading-relaxed break-words text-muted-foreground">{wf.notes}</p>}
      <div className="mt-auto flex gap-2 pt-1">
        <Button
          variant="secondary"
          size="sm"
          className="max-w-full"
          onClick={async () => {
            if (await copyText(installScript(wf))) toast("Install commands copied");
            else toast.error("Couldn’t copy — your browser blocked the clipboard");
          }}
        >
          <Copy /> <span className="truncate">{missing ? `Copy install commands (${missing} missing)` : "Copy install commands"}</span>
        </Button>
      </div>
    </article>
  );
}

export function WorkflowsView({ routes = [] }: { routes?: ComfyRoute[] }) {
  const q = useQuery({ queryKey: ["comfyui"], queryFn: fetchStatus });
  const [search, setSearch] = useState("");
  const [cap, setCap] = useState("All");
  const term = useDeferredValue(search.trim().toLowerCase());
  const usedBy = useMemo(() => usedByIndex(routes), [routes]);
  const workflows = useMemo(() => q.data?.workflows ?? [], [q.data]);
  // Filter chips by what a workflow makes (Image, Video, Audio, Text & 3D), with counts.
  const caps = useMemo(() => {
    const n = new Map<string, number>();
    for (const w of workflows) n.set(capabilityGroup(w.capability), (n.get(capabilityGroup(w.capability)) ?? 0) + 1);
    return [["All", workflows.length] as const, ...WORKFLOW_GROUPS.filter((g) => n.has(g)).map((g) => [g, n.get(g)!] as const)];
  }, [workflows]);
  const list = useMemo(
    () =>
      workflows.filter(
        (w) =>
          (cap === "All" || capabilityGroup(w.capability) === cap) &&
          (!term || `${w.id} ${w.title} ${w.capability} ${usedBy(w.id).join(" ")}`.toLowerCase().includes(term)),
      ),
    [workflows, term, cap, usedBy],
  );
  // 105 cards with model lists: render a page at a time.
  const { shown, hasMore, moreFrom, sentinel, left } = useProgressive(list.length, `${cap}|${term}`, 20, 30);
  const grid = useRef<HTMLDivElement>(null);

  if (q.isPending)
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading workflows">
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );

  if (q.isError)
    return (
      <div className="rounded-xl border border-dashed px-6 py-12 text-center">
        <Workflow className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 font-heading text-[22px]">Couldn’t load the workflows</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{(q.error as Error).message}</p>
        <Button className="mt-5" variant="outline" onClick={() => void q.refetch()}>
          <RotateCcw /> Try again
        </Button>
      </div>
    );

  const data = q.data;
  const validated = workflows.filter((w) => w.validated).length;
  return (
    <div className="space-y-6">
      <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-[13px]", data.reachable ? "bg-background" : "bg-brand-faint")}>
        {data.reachable ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <CircleAlert className="size-4 shrink-0 text-warning" />}
        <span className="min-w-0 flex-1 basis-56">
          {data.reachable ? "Connected to ComfyUI — model checkmarks below reflect what’s installed." : "ComfyUI is not reachable, so open-source runs fall back to demo output."}
        </span>
        <Link href="/settings#comfyui" className="text-brand-text underline underline-offset-2">
          Server settings
        </Link>
      </div>
      {workflows.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workflows, models, capabilities"
              aria-label="Search workflows"
              className="h-9 w-full rounded-full border bg-background pr-3 pl-9 text-[14px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-brand-faint"
            />
          </div>
          <span className="text-[12px] text-muted-foreground tabular-nums sm:ml-auto" aria-live="polite">
            {list.length === workflows.length ? `${workflows.length} workflows` : `${list.length} of ${workflows.length}`} · {validated} validated
          </span>
        </div>
      )}
      {caps.length > 2 && (
        <div role="group" aria-label="What it makes" className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1">
          {caps.map(([c, n]) => (
            <button
              key={c}
              type="button"
              aria-pressed={cap === c}
              onClick={() => setCap(c)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                cap === c && "bg-secondary text-foreground",
              )}
            >
              {c}
              <span className="text-[11px] text-muted-foreground tabular-nums">{n}</span>
            </button>
          ))}
        </div>
      )}
      {!workflows.length ? (
        <p className="text-sm text-muted-foreground">No workflows in workflows/comfyui/manifest.json yet.</p>
      ) : !list.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {term ? `No ${cap === "All" ? "" : `${cap} `}workflows match “${search.trim()}”.` : `No ${cap} workflows.`}
        </p>
      ) : (
        <>
          <div ref={grid} className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {list.slice(0, shown).map((wf) => (
              <WorkflowCard key={wf.id} wf={wf} usedBy={usedBy(wf.id)} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button ref={sentinel} variant="outline" size="sm" className="rounded-full" onClick={(e) => moreFrom(e, grid.current)}>
                Show more · {left} left
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
