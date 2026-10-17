"use client";

import {
  ArchiveRestore,
  AudioLines,
  Box,
  Clapperboard,
  Columns2,
  Copy,
  Crop,
  Download,
  FastForward,
  FileDown,
  FolderDown,
  Heart,
  ImagePlus,
  Mic2,
  MoreHorizontal,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRoundPlus,
  Wand2,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCreateGeneration, useGenerationActions, useSaveElement } from "@/lib/api";
import { ELEMENT_KINDS, type ElementKind } from "@/lib/catalog/elements";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { downloadName } from "@/lib/library";
import { cuesOf, cuesToSrt, outputActions, textOf, type ActionContext, type OutputAction, type OutputActionId } from "@/lib/output-actions";
import { cn } from "@/lib/utils";

export const ACTION_ICONS: Record<OutputActionId, LucideIcon> = {
  animate: Clapperboard,
  edit: Wand2,
  upscale: ZoomIn,
  reference: ImagePlus,
  grade: SlidersHorizontal,
  "save-character": UserRoundPlus,
  extend: FastForward,
  reframe: Crop,
  lipsync: Mic2,
  "add-sound": AudioLines,
  "voice-change": AudioLines,
  "copy-text": Copy,
  "view-3d": Box,
  download: Download,
  "download-txt": FileDown,
  "download-srt": FileDown,
  "download-all": FolderDown,
  favorite: Heart,
  finalize: Sparkles,
  compare: Columns2,
  reuse: RotateCcw,
  "copy-prompt": Copy,
  delete: Trash2,
  restore: ArchiveRestore,
  "delete-forever": Trash2,
};

/** "a 26-year-old surfer from Lisbon, freckles" → "Surfer From Lisbon": a starting name the popover lets you change. */
export function characterName(prompt: string | undefined): string {
  const words = (prompt ?? "")
    .replace(/@\S+/g, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/\d/.test(w) && !/^(the|and|with|from|who|year|old|of)$/i.test(w));
  const pick = words
    .slice(0, 3)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return pick || "New character";
}

function saveBlob(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download a file URL without navigating (keyboard shortcut, menus). */
export function downloadUrl(href: string, name?: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name ?? "";
  a.click();
}

export interface RunnerOptions {
  onOpen?: (g: Generation, index: number) => void;
  onReuse?: (g: Generation) => void;
  onCompare?: () => void;
  onDeleted?: () => void;
}

/** Handlers for the actions that aren't plain links. "save-character" is handled by the caller's popover. */
export function useActionRunner(opts: RunnerOptions = {}) {
  const actions = useGenerationActions();
  const create = useCreateGeneration();
  return (a: OutputAction, g: Generation, index: number) => {
    const o = g.outputs[index];
    switch (a.id) {
      case "favorite":
        return void actions.favorite(g);
      case "copy-text":
        void navigator.clipboard.writeText(textOf(o));
        return void toast("Copied");
      case "copy-prompt":
        void navigator.clipboard.writeText(g.prompt ?? "");
        return void toast("Prompt copied");
      case "download-txt":
        return saveBlob(textOf(o), downloadName(g, o, index, "txt"), "text/plain");
      case "download-srt":
        return saveBlob(cuesToSrt(cuesOf(o)), downloadName(g, o, index, "srt"), "application/x-subrip");
      case "finalize":
        return create.mutate(
          { feature: g.feature, modelId: g.modelId, op: "finalize", prompt: g.request.prompt, params: { draftId: o.draftId, resolution: "1080p", duration: g.request.params?.duration } },
          { onSuccess: () => toast.success("Rendering the final 1080p version"), onError: (e) => toast.error((e as Error).message) },
        );
      case "reuse":
        return opts.onReuse?.(g);
      case "compare":
        return opts.onCompare?.();
      case "view-3d":
        return opts.onOpen?.(g, index);
      case "delete":
        void actions.trash([g]);
        return opts.onDeleted?.();
      case "restore":
        void actions.restore([g]);
        return void toast("Restored");
      case "delete-forever":
        void actions.deleteForever([g]);
        toast("Deleted for good");
        return opts.onDeleted?.();
    }
  };
}

/** Name + kind before saving an output as an @element (U26). */
export function SaveElementForm({ g, o, onDone }: { g: Generation; o: OutputFile; onDone: () => void }) {
  const save = useSaveElement();
  const router = useRouter();
  const [name, setName] = useState(() => characterName(g.request.prompt));
  const [kind, setKind] = useState<ElementKind>("character");
  const submit = () =>
    save.mutate(
      { name: name.trim() || "New character", kind, references: [o.url] },
      {
        onSuccess: (el) => {
          onDone();
          toast.success(`Saved as @${el.handle}`, { action: { label: "Open", onClick: () => router.push(`/elements/${el.id}`) } });
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="space-y-1">
        <label htmlFor={`el-name-${g.id}`} className="text-[12px] font-medium text-muted-foreground">
          Save as element
        </label>
        <input
          id={`el-name-${g.id}`}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="e.g. “Maya”"
          className="h-9 w-full rounded-lg border bg-background px-3 text-[14px] outline-none focus:border-primary focus:ring-4 focus:ring-brand-faint"
        />
      </div>
      <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1 rounded-full bg-muted p-0.5">
        {ELEMENT_KINDS.filter((k) => k.kind !== "voice").map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={kind === k.kind}
            onClick={() => setKind(k.kind)}
            className={cn("h-7 flex-1 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors", kind === k.kind ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
          >
            {k.label}
          </button>
        ))}
      </div>
      <button
        type="submit"
        disabled={save.isPending}
        className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-[13px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        <UserRoundPlus className="size-3.5" /> Save
      </button>
    </form>
  );
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const HOVER = "(hover: hover)";
/** Whether the device can hover (mouse, trackpad); false on touch screens. True until hydrated. */
export function useCanHover(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(HOVER);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(HOVER).matches,
    () => true,
  );
}

const TILE_ICON = "grid size-8 place-items-center rounded-lg text-white/90 transition-colors hover:bg-white/20 hover:text-white focus-visible:bg-white/20 outline-none";

/**
 * The action strip on a result tile: a labelled primary pill, Download and Favorite icons, and a ⋯
 * menu with the rest. Tiles mount it lazily (on first hover or focus), so long feeds don't mount
 * thousands of tooltips, menus and mutation observers. `menuOnly` (touch screens): just the ⋯ menu
 * with every action, opened right away.
 */
export function TileActions({
  g,
  index,
  ctx,
  opts,
  menuOnly,
  className,
  triggerClassName,
}: {
  g: Generation;
  index: number;
  ctx?: ActionContext;
  opts?: RunnerOptions;
  menuOnly?: boolean;
  className?: string;
  /** menuOnly: the ⋯ button's look (default: white on a dark chip, for media). */
  triggerClassName?: string;
}) {
  const run = useActionRunner(opts);
  const list = useMemo(() => outputActions(g, index, ctx), [g, index, ctx]);
  const [saving, setSaving] = useState(false);
  const popover = saving && (
    <Popover open onOpenChange={(v) => !v && setSaving(false)}>
      <PopoverAnchor className="absolute right-2 bottom-2" />
      <PopoverContent align="end" collisionPadding={12} className="w-72" onClick={stop}>
        <SaveElementForm g={g} o={g.outputs[index]} onDone={() => setSaving(false)} />
      </PopoverContent>
    </Popover>
  );
  if (menuOnly) {
    return (
      <div className={className} onClick={stop} onKeyDown={stop}>
        <ActionMenu g={g} index={index} list={list} run={run} onSave={() => setSaving(true)} defaultOpen triggerClassName={triggerClassName ?? cn(TILE_ICON, "bg-black/45 backdrop-blur")} />
        {popover}
      </div>
    );
  }
  const primary = list.find((a) => a.placement === "primary");
  const bar = list.filter((a) => a.placement === "bar");
  const icon = TILE_ICON;
  const pill = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/90 px-3 text-[12px] font-medium text-black shadow-soft transition-colors hover:bg-white outline-none focus-visible:ring-2 focus-visible:ring-white";
  const PrimaryIcon = primary ? ACTION_ICONS[primary.id] : null;
  return (
    <div className={cn("flex items-center gap-0.5", className)} onClick={stop} onKeyDown={stop}>
      {primary &&
        PrimaryIcon &&
        (primary.href ? (
          <Link href={primary.href} prefetch={false} className={pill}>
            <PrimaryIcon className="size-3.5" /> {primary.label}
          </Link>
        ) : (
          <button className={pill} onClick={() => run(primary, g, index)}>
            <PrimaryIcon className="size-3.5" /> {primary.label}
          </button>
        ))}
      <span className="flex-1" />
      {bar.map((a) => {
        const Icon = ACTION_ICONS[a.id];
        const body = <Icon className={cn("size-4", a.id === "favorite" && g.favorite && "fill-current")} />;
        return (
          <Tooltip key={a.id}>
            <TooltipTrigger asChild>
              {a.download !== undefined ? (
                <a href={a.href} download={a.download} className={icon} aria-label={a.label}>
                  {body}
                </a>
              ) : (
                <button className={icon} aria-label={a.label} aria-pressed={a.id === "favorite" ? g.favorite : undefined} onClick={() => run(a, g, index)}>
                  {body}
                </button>
              )}
            </TooltipTrigger>
            <TooltipContent>{a.label}</TooltipContent>
          </Tooltip>
        );
      })}
      <ActionMenu g={g} index={index} list={list.filter((a) => a.placement === "menu")} run={run} onSave={() => setSaving(true)} triggerClassName={icon} />
      {popover}
    </div>
  );
}

/** The ⋯ menu. On touch screens tiles show only this (every action is inside). */
export function ActionMenu({
  g,
  index,
  list,
  run,
  onSave,
  triggerClassName,
  label = "More actions",
  defaultOpen,
}: {
  g: Generation;
  index: number;
  list: OutputAction[];
  run: ReturnType<typeof useActionRunner>;
  onSave: () => void;
  triggerClassName?: string;
  label?: string;
  defaultOpen?: boolean;
}) {
  const destructive = list.filter((a) => a.destructive);
  const rest = list.filter((a) => !a.destructive);
  const item = (a: OutputAction) => {
    const Icon = ACTION_ICONS[a.id];
    if (a.href && a.download !== undefined) {
      return (
        <DropdownMenuItem key={a.id} asChild>
          <a href={a.href} download={a.download}>
            <Icon /> {a.label}
          </a>
        </DropdownMenuItem>
      );
    }
    if (a.href) {
      return (
        <DropdownMenuItem key={a.id} asChild>
          <Link href={a.href} prefetch={false}>
            <Icon /> {a.label}
          </Link>
        </DropdownMenuItem>
      );
    }
    return (
      <DropdownMenuItem key={a.id} variant={a.destructive ? "destructive" : "default"} onSelect={() => (a.id === "save-character" ? onSave() : run(a, g, index))}>
        <Icon className={cn(a.id === "favorite" && g.favorite && "fill-current")} /> {a.id === "save-character" ? "Save as element…" : a.label}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu modal={false} defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <button className={triggerClassName} aria-label={label} onClick={stop}>
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12} className="min-w-48" onClick={stop} onCloseAutoFocus={(e) => e.preventDefault()}>
        {rest.map(item)}
        {destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
