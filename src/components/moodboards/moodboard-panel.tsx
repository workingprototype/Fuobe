"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MoodboardPick } from "@/lib/catalog/palettes";
import { cn } from "@/lib/utils";
import { BoardCover, CuratedCover, StatusBadge } from "./cards";
import { CreateMoodboardDialog } from "./create-moodboard";
import { useMoodboards } from "./hooks";
import { COPY, curatedPick, toPick } from "./logic";

const CURATED_TABS = ["All presets", "Mood", "Styles", "Camera"];

/** The composer's Moodboard panel: Curated (Soul 2.0's looks) and My moodboards, search, Create moodboard. */
export function MoodboardPanel({ value, onPick }: { value?: MoodboardPick; onPick: (m?: MoodboardPick) => void }) {
  const { data, isLoading } = useMoodboards();
  const [tab, setTab] = useState<"curated" | "mine">(value?.kind === "personal" ? "mine" : "curated");
  const [cat, setCat] = useState("All presets");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const needle = q.trim().toLowerCase();
  const curated = useMemo(
    () => (data?.curated ?? []).filter((c) => (needle ? `${c.name} ${c.description}`.toLowerCase().includes(needle) : cat === "All presets" || c.category === cat)),
    [data, needle, cat],
  );
  const mine = useMemo(() => (data?.items ?? []).filter((m) => !needle || m.name.toLowerCase().includes(needle)), [data, needle]);
  const card = "group block w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Moodboards" className="inline-flex rounded-full bg-muted p-0.5">
          {(
            [
              ["curated", "Curated"],
              ["mine", "My moodboards"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn("h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground transition", tab === id && "bg-background text-foreground shadow-soft")}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <Plus className="size-3.5" /> Create moodboard
        </button>
      </div>
      <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 focus-within:border-primary">
        <Search className="size-3.5 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search presets..." aria-label="Search presets" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
      </label>

      {tab === "curated" ? (
        <>
          {!needle && (
            <div className="scrollbar-none flex gap-1 overflow-x-auto">
              {CURATED_TABS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={cat === c}
                  onClick={() => setCat(c)}
                  className={cn("h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-colors", cat === c ? "bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent")}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="grid max-h-[46svh] grid-cols-3 gap-1.5 overflow-y-auto sm:max-h-[320px]">
            {isLoading
              ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[3/4]" />)
              : curated.map((c) => (
                  <button key={c.id} type="button" title={c.description} aria-pressed={value?.id === c.id} onClick={() => onPick(value?.id === c.id ? undefined : curatedPick(c))} className={card}>
                    <CuratedCover m={c} className={cn("aspect-[3/4] rounded-lg ring-offset-2 ring-offset-background", value?.id === c.id && "ring-2 ring-primary")} />
                  </button>
                ))}
            {!isLoading && !curated.length && <p className="col-span-3 py-6 text-center text-[13px] text-muted-foreground">No presets match “{q}”</p>}
          </div>
        </>
      ) : (
        <div className="grid max-h-[50svh] grid-cols-2 gap-2 overflow-y-auto sm:max-h-[340px]">
          {isLoading ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-square" />)
          ) : mine.length ? (
            mine.map((m) => {
              const ready = m.status === "complete";
              const btn = (
                <button
                  type="button"
                  aria-disabled={!ready}
                  aria-pressed={value?.id === m.id}
                  onClick={() => ready && onPick(value?.id === m.id ? undefined : toPick(m))}
                  className={cn(card, !ready && "cursor-not-allowed opacity-70")}
                >
                  <span className={cn("relative block aspect-square overflow-hidden rounded-lg ring-offset-2 ring-offset-background", value?.id === m.id && "ring-2 ring-primary")}>
                    <BoardCover m={m} className="size-full" />
                    <StatusBadge status={m.status} className="absolute top-1.5 left-1.5" />
                  </span>
                  <span className="mt-1 block truncate px-0.5 text-[12px] font-medium">{m.name}</span>
                </button>
              );
              return ready ? (
                <div key={m.id}>{btn}</div>
              ) : (
                <Tooltip key={m.id}>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent>{m.status === "failed" ? (m.error ?? "Failed") : COPY.notReady}</TooltipContent>
                </Tooltip>
              );
            })
          ) : (
            <div className="col-span-2 rounded-xl border border-dashed p-4 text-center">
              <p className="text-[13px] font-medium">Create your moodboard</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{COPY.recommended}</p>
            </div>
          )}
        </div>
      )}
      <p className="text-[11.5px] text-muted-foreground">
        Soul 2.0 takes curated looks natively; other models get the look in words or your board&apos;s images as style references.{" "}
        <Link href="/moodboards" className="text-brand-text hover:underline">
          Manage moodboards
        </Link>
      </p>
      <CreateMoodboardDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setTab("mine");
        }}
      />
    </div>
  );
}
