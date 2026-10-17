"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Clapperboard, Film, ImagePlus, Loader2, Minus, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { FailedTile, MediaThumb, PendingTile, tileRatio } from "@/components/studio/feed";
import { fileToSlot, MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { Viewer } from "@/components/studio/viewer";
import { useCreateGeneration, useEngine, useGenerationActions, useGenerations } from "@/lib/api";
import { getModel } from "@/lib/catalog";
import { MAX_FRAMES, STORYBOARD_MODELS } from "@/lib/catalog/storyboard";
import type { Generation } from "@/lib/catalog/types";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

function RatioPill({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-full bg-muted p-0.5">
      {ASPECTS.map((a) => (
        <button
          key={a}
          onClick={() => onChange(a)}
          className={cn("h-7 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground transition", value === a && "bg-background text-foreground shadow-soft")}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

/** The film made from a board: the joined video big, its shots small underneath. */
function FilmStrip({ items, ratio, onOpen }: { items: Generation[]; ratio: number; onOpen: (g: Generation) => void }) {
  const create = useCreateGeneration();
  const sorted = [...items].sort((a, b) => (a.request.step?.index ?? 0) - (b.request.step?.index ?? 0));
  const film = sorted.findLast((g) => g.op === "concat");
  const shots = sorted.filter((g) => g.op !== "concat");
  const tile = (g: Generation, className?: string) =>
    g.status === "succeeded" && g.outputs[0] ? (
      <button onClick={() => onOpen(g)} className={cn("block w-full overflow-hidden rounded-xl bg-muted", className)} style={{ aspectRatio: ratio }}>
        <MediaThumb output={g.outputs[0]} autoPlay={g === film} />
      </button>
    ) : g.status === "failed" || g.status === "canceled" ? (
      <FailedTile g={g} ratio={ratio} onRetry={() => create.mutate(g.request, { onError: (e) => toast.error((e as Error).message) })} />
    ) : (
      <PendingTile g={g} ratio={ratio} />
    );
  return (
    <div className="grid gap-3 rounded-2xl border bg-muted/30 p-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {film && <div className="min-w-0">{tile(film)}</div>}
      <div className="grid min-w-0 grid-cols-2 content-start gap-2">
        {shots.map((g) => (
          <figure key={g.id} className="min-w-0 space-y-1">
            {tile(g)}
            <figcaption className="text-[11px] text-muted-foreground">{g.request.step?.label}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function Board({ frames, film, onOpen }: { frames: Generation[]; film: Generation[]; onOpen: (g: Generation) => void }) {
  const { remove } = useGenerationActions();
  const create = useCreateGeneration();
  const qc = useQueryClient();
  const first = frames[0];
  const done = frames.filter((f) => f.status === "succeeded").length;
  const ratio = tileRatio(first);
  const makeFilm = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/storyboards/${first.batchId}/film`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body as { items: Generation[] };
    },
    onSuccess: (b) => {
      toast.success(`Animating ${b.items.length - 1} shots, then joining them into one film`);
      void qc.invalidateQueries({ queryKey: ["generations"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <section className="animate-fade-up space-y-3">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 font-heading text-[19px] leading-snug">{first.request.frame?.scene ?? first.request.prompt}</h3>
          <p className="text-[12px] text-muted-foreground">
            {frames.length} frames · {done === frames.length ? "done" : `${done}/${frames.length} ready`} · {getModel(first.modelId)?.name} · {timeAgo(first.createdAt)}
          </p>
        </div>
        {!film.length && frames.length > 1 && first.batchId && (
          <Button variant="secondary" size="sm" disabled={makeFilm.isPending} onClick={() => makeFilm.mutate()}>
            {makeFilm.isPending ? <Loader2 className="animate-spin" /> : <Film />} Make the film
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => {
            [...frames, ...film].forEach((f) => void remove(f));
            toast("Storyboard deleted");
          }}
        >
          <Trash2 /> Delete
        </Button>
      </header>
      <div className="scrollbar-none -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {frames.map((g, i) => {
          const o = g.outputs[0];
          return (
            <figure key={g.id} className="w-[min(70vw,280px)] shrink-0 space-y-1.5">
              <div className="relative overflow-hidden rounded-xl" style={{ aspectRatio: ratio }}>
                {g.status === "succeeded" && o ? (
                  <button onClick={() => onOpen(g)} className="group/tile block size-full cursor-zoom-in bg-muted">
                    <MediaThumb output={o} />
                    <span className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-2 pt-8 opacity-0 transition-opacity group-hover/tile:opacity-100">
                      <Link
                        href={`/video?image=${encodeURIComponent(o.url)}&prompt=${encodeURIComponent(g.request.frame?.scene ?? "")}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex h-7 items-center gap-1 rounded-full bg-white/20 px-2.5 text-[12px] font-medium text-white backdrop-blur hover:bg-white/30"
                      >
                        <Clapperboard className="size-3.5" /> Animate
                      </Link>
                      <Link
                        href={`/edit?image=${encodeURIComponent(o.url)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex h-7 items-center gap-1 rounded-full bg-white/20 px-2.5 text-[12px] font-medium text-white backdrop-blur hover:bg-white/30"
                      >
                        <Wand2 className="size-3.5" /> Edit
                      </Link>
                    </span>
                  </button>
                ) : g.status === "failed" || g.status === "canceled" ? (
                  <FailedTile g={g} ratio={ratio} onRetry={() => create.mutate(g.request, { onError: (e) => toast.error((e as Error).message) })} />
                ) : (
                  <PendingTile g={g} ratio={ratio} />
                )}
                <span className="pointer-events-none absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-background/90 font-mono text-[11px] font-semibold shadow-soft">
                  {i + 1}
                </span>
              </div>
              <figcaption className="line-clamp-2 px-0.5 text-[12px] leading-snug text-muted-foreground">{g.request.frame?.scene}</figcaption>
            </figure>
          );
        })}
      </div>
      {film.length > 0 && <FilmStrip items={film} ratio={ratio} onOpen={onOpen} />}
    </section>
  );
}

export function StoryboardView() {
  const qc = useQueryClient();
  const [engine, setEngine] = useEngine();
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [story, setStory] = useState("");
  const [count, setCount] = useState(4);
  const [scenes, setScenes] = useState<string[]>(["", "", ""]);
  const [style, setStyle] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [refs, setRefs] = useState<SlotValue[]>([]);
  const [open, setOpen] = useState<Generation | null>(null);
  const feed = useGenerations({ features: ["storyboard", "storyboard-film"], limit: 240 });

  const films = useMemo(() => {
    const by = new Map<string, Generation[]>();
    for (const g of feed.data ?? []) {
      if (g.feature !== "storyboard-film" || !g.batchId) continue;
      const k = g.batchId.replace(/-film$/, "");
      by.set(k, [...(by.get(k) ?? []), g]);
    }
    return by;
  }, [feed.data]);
  const boards = useMemo(() => {
    const by = new Map<string, Generation[]>();
    for (const g of (feed.data ?? []).filter((x) => x.feature === "storyboard")) {
      const k = g.batchId ?? g.id;
      by.set(k, [...(by.get(k) ?? []), g]);
    }
    return [...by.values()].map((fs) => fs.sort((a, b) => (a.request.frame?.index ?? 0) - (b.request.frame?.index ?? 0)));
  }, [feed.data]);
  const flat = boards.flatMap((b) => [...b, ...(films.get(b[0].batchId ?? "") ?? [])].filter((g) => g.status === "succeeded" && g.outputs[0]));
  const pos = open ? flat.findIndex((g) => g.id === open.id) : -1;

  const m = STORYBOARD_MODELS[engine];
  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/storyboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine,
          ...(mode === "auto" ? { story, frames: count } : { scenes: scenes.filter((s) => s.trim()) }),
          references: refs.filter((r) => r.ref).map((r) => r.ref),
          style: style || undefined,
          aspectRatio: aspect,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body as { scenes: string[] };
    },
    onSuccess: (b) => {
      toast.success(`${b.scenes.length} frames on the way — each one builds on the last`);
      void qc.invalidateQueries({ queryKey: ["generations"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const ready = (mode === "auto" ? story.trim().length > 3 : scenes.some((s) => s.trim())) && !refs.some((r) => r.uploading);
  const addRef = (f: File) => {
    const id = nanoid(6);
    void fileToSlot(f, (v) =>
      setRefs((rs) => {
        if (!v) return rs.filter((r) => r.id !== id);
        return rs.some((r) => r.id === id) ? rs.map((r) => (r.id === id ? { ...v, id } : r)) : [...rs, { ...v, id }];
      }),
    );
  };

  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-background/85 px-3 backdrop-blur sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <h1 className="font-heading text-[22px] leading-none">Storyboard</h1>
        <div className="ml-auto">
          <EngineSwitch value={engine} onChange={setEngine} />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[1240px] flex-1 space-y-10 px-3 pb-16 sm:px-6">
        <div className="mx-auto max-w-[820px] pt-6 text-center">
          <h2 className="font-heading text-display text-balance">Tell it frame by frame</h2>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Up to {MAX_FRAMES} consistent frames — each one is made from the previous frame, so faces, wardrobe and light carry through. Runs on{" "}
            {getModel(m.next)?.name}.
          </p>
          <div className="mt-6 rounded-composer border bg-background p-3 text-left shadow-soft focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint">
            <div className="mb-2 flex items-center gap-1 rounded-full bg-muted p-0.5 text-[13px] font-medium sm:w-fit">
              {(["auto", "manual"] as const).map((k) => (
                <button key={k} onClick={() => setMode(k)} className={cn("h-8 flex-1 rounded-full px-4 text-muted-foreground transition", mode === k && "bg-background text-foreground shadow-soft")}>
                  {k === "auto" ? "From one idea" : "Scene by scene"}
                </button>
              ))}
            </div>
            {mode === "auto" ? (
              <textarea
                value={story}
                onChange={(e) => setStory(e.target.value)}
                rows={2}
                placeholder="The whole story in a sentence or two — e.g. “a lighthouse keeper finds a glowing bottle and follows its map into the sea”"
                className="field-sizing-content max-h-52 min-h-16 w-full resize-none bg-transparent px-2 py-1.5 text-base leading-relaxed outline-none placeholder:text-subtle-foreground"
              />
            ) : (
              <div className="space-y-1.5">
                {scenes.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-xl border bg-muted/40 p-1.5 pl-2.5">
                    <span className="mt-1.5 font-mono text-[12px] font-semibold text-muted-foreground">{i + 1}</span>
                    <textarea
                      value={s}
                      onChange={(e) => setScenes((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                      rows={1}
                      placeholder={i ? "What happens next?" : "Opening frame — who, where, what"}
                      className="field-sizing-content max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1 text-[14px] outline-none placeholder:text-subtle-foreground"
                    />
                    <button
                      onClick={() => setScenes((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs))}
                      className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"
                      aria-label={`Remove frame ${i + 1}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                {scenes.length < MAX_FRAMES && (
                  <button onClick={() => setScenes((xs) => [...xs, ""])} className="inline-flex items-center gap-1 px-1 text-[12px] font-medium text-brand-text hover:underline">
                    <Plus className="size-3" /> Add frame
                  </button>
                )}
              </div>
            )}
            <input
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="Look (optional) — e.g. “35mm film, moody teal night, anamorphic”"
              className="mt-2 h-9 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none focus:border-primary"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {refs.map((r) => (
                <div key={r.id} className="relative size-12 overflow-hidden rounded-lg border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.preview} alt="" className="size-full object-cover" />
                  {r.uploading && <Loader2 className="absolute inset-0 m-auto size-4 animate-spin" />}
                  <button onClick={() => setRefs((rs) => rs.filter((x) => x.id !== r.id))} className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-foreground/80 text-background" aria-label="Remove reference">
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
              {refs.length < 4 && <MediaSlot label="Character / look" kind="image" value={null} onChange={(v) => v && setRefs((rs) => [...rs, { ...v, id: nanoid(6) }])} onFile={addRef} />}
              {mode === "auto" && (
                <div className="flex items-center gap-1 rounded-full bg-secondary px-1 py-0.5 text-[13px] font-medium">
                  <button onClick={() => setCount((c) => Math.max(2, c - 1))} className="grid size-7 place-items-center rounded-full hover:bg-accent" aria-label="Fewer frames">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-16 text-center tabular-nums">{count} frames</span>
                  <button onClick={() => setCount((c) => Math.min(MAX_FRAMES, c + 1))} className="grid size-7 place-items-center rounded-full hover:bg-accent" aria-label="More frames">
                    <Plus className="size-3.5" />
                  </button>
                </div>
              )}
              <RatioPill value={aspect} onChange={setAspect} />
              <Button size="icon" className="ml-auto size-10 rounded-full" disabled={!ready || submit.isPending} onClick={() => submit.mutate()} aria-label="Generate storyboard">
                {submit.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="size-3" />
              {mode === "auto" ? "Your story is split into frames by the prompt LLM (Settings → Prompt enhancement), or a shot list when none is set." : "One prompt per frame. References keep the cast consistent."}
            </p>
          </div>
        </div>

        {feed.isLoading ? (
          <div className="flex gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-64 rounded-xl" />
            ))}
          </div>
        ) : boards.length ? (
          <div className="space-y-10">
            {boards.map((b) => (
              <Board key={b[0].batchId ?? b[0].id} frames={b} film={films.get(b[0].batchId ?? "") ?? []} onOpen={setOpen} />
            ))}
          </div>
        ) : (
          <div className="grid place-items-center rounded-xl border border-dashed py-14 text-center text-muted-foreground">
            <ImagePlus className="size-6" />
            <p className="mt-2 text-[14px]">Your storyboards appear here.</p>
          </div>
        )}
      </main>
      {open && pos >= 0 && (
        <Viewer
          generation={flat[pos]}
          index={0}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => setOpen(flat[pos - 1]) : undefined}
          onNext={pos < flat.length - 1 ? () => setOpen(flat[pos + 1]) : undefined}
        />
      )}
    </div>
  );
}
