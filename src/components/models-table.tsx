"use client";

import { Cloud, Cpu } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ModelBadges } from "@/components/studio/model-picker";
import { MODELS } from "@/lib/catalog";
import { OPERATION_LABELS, type Engine, type MediaKind } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { useEngine } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ModelsTable() {
  const [engineChoice, setEngine] = useState<Engine | "all">("all");
  const [, , mode] = useEngine();
  const engine: Engine | "all" = mode === "both" ? engineChoice : mode;
  const [kind, setKind] = useState<MediaKind | "all">("all");
  const list = MODELS.filter((m) => (engine === "all" || m.engine === engine) && (kind === "all" || m.kind === kind));
  const chip = (active: boolean) =>
    cn("h-8 rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:bg-accent", active && "bg-secondary text-foreground");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {(mode === "both" ? (["all", "cloud", "open"] as const) : [mode]).map((e) => (
          <button key={e} className={chip(engine === e)} onClick={() => setEngine(e)}>
            {e === "all" ? "All engines" : e === "cloud" ? "Cloud" : "Open source"}
          </button>
        ))}
        <span className="mx-2 w-px bg-border" />
        {(["all", "image", "video", "audio"] as const).map((k) => (
          <button key={k} className={chip(kind === k)} onClick={() => setKind(k)}>
            {k === "all" ? "All media" : k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
        <span className="ml-auto self-center text-[13px] text-muted-foreground">{list.length} models</span>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-muted/50 text-[12px] text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Model</th>
              <th className="px-4 py-2.5 font-medium">Engine</th>
              <th className="px-4 py-2.5 font-medium">Can do</th>
              <th className="px-4 py-2.5 font-medium">Runs on</th>
              <th className="px-4 py-2.5 font-medium">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((m) => (
              <tr key={m.id} className="align-top hover:bg-accent/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 font-medium">
                    {m.name} <ModelBadges model={m} />
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {m.vendor} — {m.tagline}
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    {m.engine === "open" ? <Cpu className="size-3.5" /> : <Cloud className="size-3.5" />}
                    {m.engine === "open" ? "Open source" : "Cloud"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {[...new Set(m.routes.map((r) => r.op))].map((op) => (
                      <Badge key={op} variant="secondary" className="rounded-[4px] text-[11px] font-normal">
                        {OPERATION_LABELS[op]}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                  {m.routes.map((r) => (
                    <div key={`${r.provider}-${r.op}-${r.endpoint}`}>
                      {r.provider}: {r.endpoint}
                    </div>
                  ))}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] whitespace-nowrap">
                  {m.engine === "open" ? "Free" : m.pricing ? `${formatCost(m.pricing.usd)} / ${m.pricing.unit}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
