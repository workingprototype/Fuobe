"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cloud, Cpu, Download, GraduationCap, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { StudioElement } from "@/lib/catalog/elements";
import { triggerFor, type TrainingTarget } from "@/lib/catalog/training";
import { cn } from "@/lib/utils";

interface Training {
  id: string;
  target: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number | null;
  message: string | null;
  error: string | null;
  createdAt: number;
}

type Target = TrainingTarget & { blocker: string | null };

function useTrainings(id: string) {
  return useQuery({
    queryKey: ["trainings", id],
    queryFn: async () => (await (await fetch(`/api/elements/${id}/trainings`)).json()) as { targets: Target[]; items: Training[] },
    refetchInterval: (q) => (q.state.data?.items.some((t) => t.status === "queued" || t.status === "running") ? 3000 : false),
  });
}

/** Soul ID: train the element once, then every @mention on that model uses the trained identity. */
export function TrainDialog({ element, open, onOpenChange }: { element: StudioElement; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const q = useTrainings(element.id);
  const [file, setFile] = useState("");
  const photos = element.references.length;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["trainings", element.id] });
    void qc.invalidateQueries({ queryKey: ["elements"] });
  };
  const start = useMutation({
    mutationFn: async (target: string) => {
      const res = await fetch(`/api/elements/${element.id}/trainings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body;
    },
    onSuccess: () => {
      toast.success(`Training ${element.name} — you can keep working`);
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const attach = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/elements/${element.id}/lora`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, trigger: triggerFor(element.handle) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
    },
    onSuccess: () => {
      toast.success("LoRA attached");
      setFile("");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = async (modelId: string) => {
    await fetch(`/api/elements/${element.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeIdentities: [modelId] }),
    });
    refresh();
  };

  const latest = (target: string) => q.data?.items.find((t) => t.target === target);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="size-5" /> Train {element.name}
          </DialogTitle>
          <DialogDescription>
            Train once and {element.name} looks right every time — @{element.handle} then uses the trained identity on that model instead of reference photos.
            Uses all {photos} photos; 15–30 varied ones work best.
          </DialogDescription>
        </DialogHeader>

        {element.loras.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Trained</p>
            {element.loras.map((l) => (
              <div key={l.modelId} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]">
                <Check className="size-4 text-success" />
                <span className="font-medium">{q.data?.targets.find((t) => t.modelIds.includes(l.modelId))?.name ?? l.modelId}</span>
                <span className="truncate text-muted-foreground">{l.referenceId ? "Soul ID" : l.trigger ? `trigger “${l.trigger}”` : l.file}</span>
                <button onClick={() => void remove(l.modelId)} className="ml-auto text-muted-foreground hover:text-destructive" aria-label="Remove">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {(q.data?.targets ?? []).map((t) => {
            const job = latest(t.id);
            const busy = job && (job.status === "queued" || job.status === "running");
            const tooFew = photos < t.minImages;
            return (
              <div key={t.id} className={cn("rounded-xl border p-3", busy && "border-primary")}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    {t.engine === "open" ? <Cpu className="size-4" /> : <Cloud className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium">{t.name}</p>
                    <p className="text-[12px] text-muted-foreground">{t.description}</p>
                    <p className="mt-1 text-[11px] text-subtle-foreground">
                      {t.price} · {t.eta}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={busy ? "secondary" : "default"}
                    disabled={!!t.blocker || tooFew || !!busy || start.isPending}
                    onClick={() => start.mutate(t.id)}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    {busy ? "Training" : job?.status === "succeeded" ? "Retrain" : "Train"}
                  </Button>
                </div>
                {(t.blocker || tooFew) && !busy && (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    {tooFew ? `Needs at least ${t.minImages} photos.` : t.blocker}{" "}
                    {t.blocker && !tooFew && (
                      <Link href="/settings" className="text-brand-text hover:underline">
                        Open Settings
                      </Link>
                    )}
                  </p>
                )}
                {busy && (
                  <div className="mt-3 space-y-1">
                    <Progress value={(job.progress ?? 0.05) * 100} className="h-1.5" />
                    <p className="text-[12px] text-muted-foreground">{job.message}</p>
                  </div>
                )}
                {job?.status === "failed" && <p className="mt-2 text-[12px] text-destructive">{job.error}</p>}
                {job?.status === "succeeded" && job.message && <p className="mt-2 text-[12px] text-warning">{job.message}</p>}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 rounded-xl bg-muted/50 p-3">
          <p className="text-[13px] font-medium">Train anywhere</p>
          <p className="text-[12px] text-muted-foreground">
            Download a ready-to-run AI-Toolkit kit (photos, captions, config), train on any GPU, then attach the LoRA file you copied into ComfyUI/models/loras.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/elements/${element.id}/training-kit`}>
                <Download /> Training kit
              </a>
            </Button>
            <div className="flex min-w-60 flex-1 gap-2">
              <Input value={file} onChange={(e) => setFile(e.target.value)} placeholder={`fuobe/${element.handle.toLowerCase()}.safetensors`} className="h-8" />
              <Button size="sm" variant="secondary" disabled={!file.trim() || attach.isPending} onClick={() => attach.mutate()}>
                Attach
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
