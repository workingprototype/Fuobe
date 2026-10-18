"use client";

import { Check, CircleDashed, Loader2, TriangleAlert } from "lucide-react";
import type { Generation } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

export interface StepRow {
  key: string;
  label: string;
  g?: Generation;
}

/** One line per pipeline step: waiting, running (with progress), done or failed (with the reason). */
export function StepList({ steps, className }: { steps: StepRow[]; className?: string }) {
  return (
    <ol className={cn("space-y-1.5", className)} aria-label="Steps">
      {steps.map((s) => {
        const g = s.g;
        const status = g?.status ?? "queued";
        const pct = g?.progress != null ? Math.round(g.progress * 100) : null;
        const waiting = status === "queued" && (!g || g.message?.startsWith("Waits"));
        return (
          <li key={s.key} className="flex min-w-0 items-start gap-2.5 text-[13px]">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
              {status === "succeeded" ? (
                <span className="grid size-5 place-items-center rounded-full bg-success text-background">
                  <Check className="size-3" />
                </span>
              ) : status === "failed" || status === "canceled" ? (
                <TriangleAlert className="size-4 text-destructive" />
              ) : waiting ? (
                <CircleDashed className="size-4 text-subtle-foreground" />
              ) : (
                <Loader2 className="size-4 animate-spin text-brand-text" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className={cn("truncate font-medium", waiting && "text-muted-foreground")}>{s.label}</span>
                {g?.modelName && <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">{g.modelName}</span>}
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                  {status === "succeeded" ? "Done" : status === "failed" ? "Failed" : status === "canceled" ? "Canceled" : waiting ? "Waiting" : pct != null ? `${pct}%` : "Working"}
                  {g?.provider === "mock" && status === "succeeded" ? " · demo" : ""}
                </span>
              </div>
              {(status === "running" || (status === "queued" && !waiting)) && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full bg-primary transition-[width] duration-500", pct == null && "w-1/3 animate-pulse")} style={pct != null ? { width: `${Math.max(4, pct)}%` } : undefined} />
                </div>
              )}
              {(status === "failed" || status === "canceled") && g?.error && <p className="mt-0.5 text-[12px] leading-snug break-words text-destructive">{g.error}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Whether any of these generations still renders (poll while true). */
export const anyActive = (gs: (Generation | undefined)[]) => gs.some((g) => g && (g.status === "queued" || g.status === "running"));
