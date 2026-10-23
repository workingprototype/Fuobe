"use client";

import { AppWindow, ArrowUpRight, AudioLines, Box, Brain, Captions, Check, CircleAlert, Clapperboard, Film, FileText, ImageIcon, Info, Languages, Layers, Loader2, Megaphone, Scissors, Search, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FailedTile, MediaThumb, PendingTile, tileRatio } from "@/components/studio/feed";
import { useCreateGeneration } from "@/lib/api";
import { planRunnable, type AssistItem, type AssistThread, type PlannedJob, type SkillSummary } from "@/lib/assist";
import { OPERATION_LABELS, type Generation, type MediaKind, type Operation } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SkillIcon } from "./skill-icon";

const KIND_ICON: Record<MediaKind | "storyboard" | "memory", typeof ImageIcon> = { image: ImageIcon, video: Video, audio: AudioLines, text: FileText, model3d: Box, storyboard: Clapperboard, memory: Brain };

/** Paragraphs, "- " bullets and **bold** — the little markdown the assistant uses. */
export function Prose({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  return (
    <div className="space-y-2.5 text-[15px] leading-relaxed">
      {text.split(/\n{2,}/).map((para, i) => {
        const lines = para.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="break-words whitespace-pre-wrap">
            {inline(para)}
          </p>
        );
      })}
    </div>
  );
}

function jobPrice(j: PlannedJob): string {
  if (j.error) return "—";
  if (j.op === "memory") return "";
  if (j.demo) return "Demo";
  if (j.costUsd === 0) return "Free";
  return j.costUsd === null ? "Price varies" : formatCost(j.costUsd);
}

function jobLine(j: PlannedJob): string {
  if (j.op === "storyboard") return `Storyboard · ${j.count} frames`;
  if (j.op === "memory") return j.note ?? "Memory";
  const op = OPERATION_LABELS[j.op as Operation] ?? j.op;
  return [j.note && j.note !== op ? j.note : op, j.count > 1 ? `${j.count} takes` : ""].filter(Boolean).join(" · ");
}

export function ApprovalCard({ item, live, onAnswer }: { item: Extract<AssistItem, { role: "approval" }>; live: boolean; onAnswer: (ok: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState<boolean | null>(null);
  const runnable = planRunnable(item.jobs);
  const memoryOnly = item.jobs.length > 0 && item.jobs.every((j) => j.op === "memory");
  const allDemo = item.jobs.every((j) => j.demo || j.error || j.op === "memory");
  const total = memoryOnly
    ? "Saved to memory for future chats"
    : !runnable && item.status === "pending"
      ? "Can't run yet — fix what's marked above, or tell Assist what to change"
      : allDemo
      ? "Demo run — no provider connected"
      : item.totalUsd === null
        ? "Some prices vary"
        : item.totalUsd === 0
          ? "Free"
          : `≈ ${formatCost(item.totalUsd)}`;
  const answer = async (ok: boolean) => {
    setBusy(ok);
    try {
      await onAnswer(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  // Long studio plans (a dub, a faceless episode) fold after six steps.
  const [all, setAll] = useState(false);
  const shown = all ? item.jobs : item.jobs.slice(0, 6);
  return (
    <div className={cn("animate-fade-up overflow-hidden rounded-2xl border bg-background shadow-soft", item.status !== "pending" && "opacity-80")}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        {memoryOnly ? <Brain className="size-3.5 text-brand-text" /> : <Sparkles className="size-3.5 text-brand-text" />}
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.summary}</p>
        {item.status === "approved" && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-text">
            <Check className="size-3" /> {memoryOnly ? "Saved" : "Approved"}
          </span>
        )}
        {item.status === "declined" && <span className="text-[12px] text-muted-foreground">Skipped</span>}
      </div>
      <ul className="divide-y">
        {shown.map((j, i) => {
          const Icon = KIND_ICON[j.op === "storyboard" ? "storyboard" : j.op === "memory" ? "memory" : j.kind];
          return (
            <li key={i} className="flex gap-3 px-4 py-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium break-words">
                  {j.modelName}
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    {jobLine(j)}
                  </span>
                </p>
                <p className={cn("mt-0.5 text-[13px] break-words", j.op === "memory" ? "text-foreground" : "line-clamp-2 text-muted-foreground")}>{j.prompt}</p>
                {j.error && (
                  <p className="mt-1 flex items-start gap-1 text-[12px] text-destructive">
                    <CircleAlert className="mt-0.5 size-3 shrink-0" /> {j.error}
                  </p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{jobPrice(j)}</span>
            </li>
          );
        })}
      </ul>
      {!!(item.opens?.length || item.notes?.length) && (
        <div className="space-y-1 border-t px-4 py-2.5 text-[12px] text-muted-foreground">
          {item.opens?.length ? (
            <p className="flex items-start gap-1.5">
              <AppWindow className="mt-0.5 size-3.5 shrink-0" /> Opens in {item.opens.join(" and ")}, where you can keep working on it
            </p>
          ) : null}
          {item.notes?.map((n, k) => (
            <p key={k} className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {n}
            </p>
          ))}
        </div>
      )}
      {item.jobs.length > 6 && (
        <button onClick={() => setAll((v) => !v)} className="w-full border-t px-4 py-2 text-left text-[12px] font-medium text-brand-text hover:bg-accent">
          {all ? "Show fewer steps" : `Show all ${item.jobs.length} steps`}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <p className="text-[12px] text-muted-foreground">{total}</p>
        {live && item.status === "pending" && (
          <div className="ml-auto flex gap-1.5">
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void answer(false)}>
              Not now
            </Button>
            <Button size="sm" disabled={busy !== null || !runnable} onClick={() => void answer(true)}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} {memoryOnly ? "Remember" : `Run${item.totalUsd && !allDemo ? ` · ${formatCost(item.totalUsd)}` : ""}`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const STUDIO_ICON: Record<string, typeof ImageIcon> = { Layers, "Shorts Studio": Clapperboard, "Translate & dub": Languages, "Faceless Studio": Film, "Ads Studio": Megaphone, Captions, Katana: Scissors };

/** A job a studio took: where it lives, and the way there. */
function StudioCard({ text, studio, href }: { text: string; studio: string; href: string }) {
  const Icon = STUDIO_ICON[studio] ?? AppWindow;
  return (
    <div className="flex animate-fade-up flex-col gap-3 rounded-2xl border bg-background px-4 py-3 shadow-soft sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-faint text-brand-text">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium break-words">{text}</p>
          <p className="text-[12px] text-muted-foreground">Follow it and keep editing in {studio}.</p>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="w-full rounded-full sm:w-auto">
        <Link href={href}>
          Open in {studio} <ArrowUpRight />
        </Link>
      </Button>
    </div>
  );
}

export function GenerationCards({ ids, all, storyboard, onOpen }: { ids: string[]; all: Map<string, Generation>; storyboard?: boolean; onOpen: (g: Generation, i: number) => void }) {
  const create = useCreateGeneration();
  const gens = ids.map((id) => all.get(id)).filter((g): g is Generation => !!g);
  if (!gens.length) return null;
  // Several stills are numbered, so "animate 2" names one (the offline planner reads it the same way).
  const stills = gens.filter((g) => g.status === "succeeded" && g.kind === "image").reduce((n, g) => n + g.outputs.filter((o) => o.kind === "image").length, 0);
  let take = 0;
  const tiles = gens.flatMap((g) => {
    const ratio = tileRatio(g);
    if (g.status === "succeeded") {
      return g.outputs.map((o, i) => {
        const n = stills > 1 && g.kind === "image" && o.kind === "image" ? ++take : 0;
        return (
          <button
            key={`${g.id}-${i}`}
            onClick={() => onOpen(g, i)}
            className="group relative overflow-hidden rounded-xl bg-muted"
            style={{ aspectRatio: ratio }}
            aria-label={`Open ${n ? `take ${n}: ` : ""}${g.request.prompt?.slice(0, 60) || "result"}`}
          >
            {/* A text card says "Demo" in its own header row: on a narrow tile a corner badge would cover its label. */}
            <MediaThumb output={o} className="transition duration-300 group-hover:scale-[1.02]" tag={g.provider === "mock" && o.kind === "text" ? "Demo" : undefined} />
            {/* Top right, next to "Demo": the other corners hold the picture's own caption on demo stills. */}
            {(n > 0 || (g.provider === "mock" && o.kind !== "text")) && (
              <span className="absolute top-2 right-2 flex items-center gap-1">
                {n > 0 && (
                  <span aria-hidden className="grid size-6 place-items-center rounded-full bg-background/85 text-[12px] font-medium tabular-nums shadow-soft">
                    {n}
                  </span>
                )}
                {g.provider === "mock" && o.kind !== "text" && <span className="rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium">Demo</span>}
              </span>
            )}
          </button>
        );
      });
    }
    if (g.status === "failed" || g.status === "canceled") {
      return [<FailedTile key={g.id} g={g} ratio={ratio} onRetry={() => create.mutate(g.request, { onError: (e) => toast.error((e as Error).message) })} />];
    }
    return Array.from({ length: Math.max(1, g.request.params?.numOutputs ?? 1) }, (_, i) => <PendingTile key={`${g.id}-${i}`} g={g} ratio={ratio} />);
  });
  const portrait = tileRatio(gens[0]) < 1;
  return (
    <div className={cn("grid gap-2", storyboard ? "grid-cols-2 sm:grid-cols-4" : portrait ? "grid-cols-2 sm:grid-cols-3" : tiles.length === 1 ? "grid-cols-1 sm:w-4/5" : "grid-cols-2")}>{tiles}</div>
  );
}

export function Transcript({
  thread,
  all,
  skills,
  onAnswer,
  onOpen,
}: {
  thread: AssistThread;
  all: Map<string, Generation>;
  skills?: SkillSummary[];
  onAnswer: (ok: boolean) => Promise<void>;
  onOpen: (g: Generation, i: number) => void;
}) {
  const lastApproval = thread.items.findLast((i) => i.role === "approval")?.id;
  const skill = (n: string) => skills?.find((s) => s.name === n);
  return (
    <div className="space-y-5">
      {thread.items.map((item) => {
        switch (item.role) {
          case "user":
            return (
              <div key={item.id} className="flex animate-fade-up flex-col items-end gap-2">
                {item.attachments?.length ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {item.attachments.map((a) => (
                      <div key={a} className="size-16 overflow-hidden rounded-xl border bg-muted">
                        <MediaThumb output={{ url: a, kind: /\.(mp4|webm|mov)$/i.test(a) ? "video" : /\.(mp3|wav|ogg|m4a)$/i.test(a) ? "audio" : "image" }} />
                      </div>
                    ))}
                  </div>
                ) : null}
                {item.skills?.length ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {item.skills.map((n) => (
                      <Link
                        key={n}
                        href={`/assist/skills?skill=${n}`}
                        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-faint pr-2.5 pl-1 text-[12px] font-medium text-brand-text hover:bg-brand-faint-hover"
                      >
                        <SkillIcon name={n} icon={skill(n)?.icon} size="sm" className="size-5" />
                        {skill(n)?.title ?? `/${n}`}
                      </Link>
                    ))}
                  </div>
                ) : null}
                {item.text && <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap">{item.text}</div>}
              </div>
            );
          case "assistant":
            return (
              <div key={item.id} className="animate-fade-up">
                <Prose text={item.text} />
              </div>
            );
          case "tool":
            if (item.studio && item.href) return <StudioCard key={item.id} text={item.text} studio={item.studio} href={item.href} />;
            return item.href ? (
              <Link key={item.id} href={item.href} className="flex w-fit items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
                <Search className="size-3" /> {item.text} <ArrowUpRight className="size-3" />
              </Link>
            ) : (
              <p key={item.id} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Search className="size-3" /> {item.text}
              </p>
            );
          case "approval":
            return <ApprovalCard key={item.id} item={item} live={item.id === lastApproval && thread.status === "waiting"} onAnswer={onAnswer} />;
          case "generations":
            return <GenerationCards key={item.id} ids={item.ids} all={all} storyboard={item.storyboard} onOpen={onOpen} />;
          case "notice":
            return (
              <p key={item.id} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[13px]", item.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {item.text}
              </p>
            );
        }
      })}
      {thread.status === "running" && (
        <p className="shimmer-text animate-shimmer-text flex items-center gap-2 text-[14px] font-medium">
          <Sparkles className="size-3.5" /> Thinking…
        </p>
      )}
    </div>
  );
}
