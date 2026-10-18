"use client";

import {
  ArrowDown,
  ArrowUp,
  Brush,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Library,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  SplitSquareVertical,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LibraryGrid } from "@/components/studio/media-slot";
import { uploadFile } from "@/lib/api";
import { addNodes, deleteNode, duplicateNode, jobStatusText, moveNode, setRevision, TOOL_MODELS, updateNode, type LayerNode, type LayerRevision } from "@/lib/layers";
import { cn } from "@/lib/utils";
import { Field } from "./bits";
import { costLabel, isFailed, latestJob, modelsFor, useEditor } from "./editor-context";
import { downloadLayer, loadImage, sizeOf } from "./render";

/** A layer's thumbnail showing just the part of its image it uses (its crop), on a checkerboard. */
export function LayerThumb({ node, className }: { node: Pick<LayerNode, "src" | "crop" | "natural" | "w" | "h">; className?: string }) {
  const crop = node.crop;
  const nat = node.natural;
  const aspect = node.w / node.h;
  const style: React.CSSProperties =
    crop && nat
      ? {
          backgroundImage: `url("${node.src}")`,
          backgroundSize: `${(nat[0] / crop[2]) * 100}% ${(nat[1] / crop[3]) * 100}%`,
          backgroundPosition: `${nat[0] === crop[2] ? 0 : (crop[0] / (nat[0] - crop[2])) * 100}% ${nat[1] === crop[3] ? 0 : (crop[1] / (nat[1] - crop[3])) * 100}%`,
        }
      : { backgroundImage: `url("${node.src}")`, backgroundSize: "100% 100%" };
  return (
    <span className={cn("checkerboard grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border", className)}>
      <span className="block max-h-full max-w-full bg-no-repeat" style={{ ...style, aspectRatio: `${aspect}`, width: aspect >= 1 ? "100%" : "auto", height: aspect >= 1 ? "auto" : "100%" }} />
    </span>
  );
}

/** Add a layer from a file or the library: sized to fit 80% of the canvas, centred. */
async function layerFromImage(url: string, name: string, doc: { width: number; height: number }): Promise<LayerNode> {
  const img = await loadImage(url);
  const natural = sizeOf(img);
  const k = Math.min(1, (doc.width * 0.8) / natural[0], (doc.height * 0.8) / natural[1]);
  const w = natural[0] * k;
  const h = natural[1] * k;
  const rev: LayerRevision = { src: url, crop: null, natural, label: "Added", at: Date.now() };
  return { id: nanoid(8), name: name.slice(0, 80) || "Uploaded layer", z: 0, x: (doc.width - w) / 2, y: (doc.height - h) / 2, w, h, rotation: 0, src: url, crop: null, natural, revisions: [rev], revision: 0 };
}

function AddLayer() {
  const { doc, commit, select, run, engine, models, isDemo } = useEditor();
  const file = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [ref, setRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = modelsFor(models, TOOL_MODELS["generate-layer"][engine]);
  const [modelId, setModelId] = useState<string | undefined>();
  const model = options.find((m) => m.id === modelId) ?? options[0];

  const add = async (url: string, name: string) => {
    try {
      const n = await layerFromImage(url, name, doc);
      commit(addNodes(doc, [n]));
      select(n.id);
      toast.success("Layer added", { duration: 1500 });
    } catch {
      toast.error("Failed to add layer");
    }
  };

  return (
    <>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const a = await uploadFile(f);
            await add(a.url, f.name.replace(/\.[^.]+$/, "") || "Uploaded layer");
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      />
      <Popover open={picking} onOpenChange={setPicking}>
        <DropdownMenu>
          <PopoverAnchor asChild>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="secondary" className="rounded-full">
                <Plus /> Add layer
              </Button>
            </DropdownMenuTrigger>
          </PopoverAnchor>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => setTimeout(() => setPicking(true))}>
              <Library /> Choose asset
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => file.current?.click()}>
              <Upload /> Upload image
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeout(() => setGenerating(true))}>
              <Sparkles /> Generate layer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PopoverContent align="end" className="w-[min(92vw,380px)] p-2" collisionPadding={12}>
          <p className="px-1 pb-2 text-[13px] font-medium">Choose an image to add as a layer</p>
          {picking && (
            <LibraryGrid
              kinds={["image"]}
              onPick={(v) => {
                setPicking(false);
                void add(v.ref, v.name ?? "Library layer");
              }}
            />
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={generating} onOpenChange={setGenerating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate layer</DialogTitle>
            <DialogDescription>Describe one element. It arrives on its own transparent layer, ready to place.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!prompt.trim()) return;
              setBusy(true);
              const job = await run({ tool: "generate-layer", target: { kind: "whole" }, prompt: prompt.trim(), refs: ref ? [ref] : undefined, modelId: ref ? undefined : model?.id, label: "Generate layer" });
              setBusy(false);
              if (job) {
                setGenerating(false);
                setPrompt("");
                setRef(null);
              }
            }}
          >
            <Textarea autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} placeholder="e.g. “a red paper lantern with a gold tassel”" aria-label="Describe the layer" className="min-h-20" />
            <div className="flex flex-wrap items-center gap-2">
              <RefPicker value={ref} onChange={setRef} />
              {!ref && options.length > 1 && (
                <Select value={model?.id} onValueChange={setModelId}>
                  <SelectTrigger size="sm" className="h-8 rounded-full" aria-label="Model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <DialogFooter className="items-center sm:justify-between">
              <span className="font-mono text-[12px] text-muted-foreground">{costLabel(model, isDemo(model))}</span>
              <Button type="submit" className="rounded-full" disabled={!prompt.trim() || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate layer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Add reference": upload or pick an image, shown as a removable thumbnail. */
export function RefPicker({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  if (value) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary pr-1 pl-1 text-[13px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt="Reference" className="size-6 rounded-full object-cover" />
        Reference
        <button type="button" className="grid size-6 place-items-center rounded-full hover:bg-accent" aria-label="Remove reference" onClick={() => onChange(null)}>
          <X className="size-3.5" />
        </button>
      </span>
    );
  }
  return (
    <>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setUploading(true);
          try {
            onChange((await uploadFile(f)).url);
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setUploading(false);
          }
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="secondary" className="rounded-full" disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />} Add reference
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mb-2 w-full"
            onClick={() => {
              setOpen(false);
              file.current?.click();
            }}
          >
            <Upload /> Upload an image
          </Button>
          {open && (
            <LibraryGrid
              kinds={["image"]}
              onPick={(v) => {
                setOpen(false);
                onChange(v.ref);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

function LayerRow({
  node,
  selected,
  busy,
  index,
  total,
  onDragHandle,
  dropBefore,
}: {
  node: LayerNode;
  selected: boolean;
  busy?: string;
  index: number;
  total: number;
  onDragHandle: (e: React.PointerEvent, id: string) => void;
  dropBefore: boolean;
}) {
  const { doc, commit, select, busyJob, openTool, setSplitTarget, setMode, mode } = useEditor();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(node.name);
  const job = busyJob(node.id);
  const move = (dz: number) => {
    const to = node.z + dz;
    if (to < 0 || to >= total) return;
    commit(moveNode(doc, node.id, to));
  };
  const remove = () => {
    if (job) {
      toast.error(job.tool === "split" ? "Can't delete while this layer is being split" : "Can't delete while this layer is generating");
      return;
    }
    commit(deleteNode(doc, node.id));
    select(null);
    toast("Layer deleted", { duration: 1500 });
  };
  const finishRename = () => {
    setRenaming(false);
    const name = draft.trim();
    if (name && name !== node.name) commit(updateNode(doc, node.id, { name }));
    else setDraft(node.name);
  };

  return (
    <li className="relative">
      {dropBefore && <span className="absolute -top-px right-2 left-2 z-10 h-0.5 rounded-full bg-primary" aria-hidden />}
      <div
        className={cn(
          "group/row flex h-14 items-center gap-1.5 rounded-lg pr-1 pl-0.5 transition-colors",
          selected ? "bg-brand-faint" : "hover:bg-accent",
          node.hidden && "opacity-60",
        )}
      >
        <button
          type="button"
          className="grid h-10 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-subtle-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={`Reorder ${node.name}. Use the up and down arrow keys to move it.`}
          onPointerDown={(e) => onDragHandle(e, node.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              move(e.key === "ArrowUp" ? 1 : -1);
            }
          }}
        >
          <GripVertical className="size-4" />
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => select(node.id)} onDoubleClick={() => setRenaming(true)} aria-pressed={selected} aria-label={`Select layer ${node.name}`}>
          <LayerThumb node={node} />
          <span className="min-w-0 flex-1">
            {renaming ? null : <span className={cn("block truncate text-[13px]", selected && "font-medium text-brand-text")}>{node.name}</span>}
            <span className="block truncate text-[11px] text-muted-foreground">
              {busy ?? (node.revisions.length > 1 ? `Version ${node.revision + 1} of ${node.revisions.length}` : node.maskSrc ? "Masked" : `Layer ${index}`)}
            </span>
          </span>
        </button>
        {renaming && (
          <Input
            autoFocus
            value={draft}
            maxLength={80}
            aria-label="Layer name"
            className="absolute top-2 right-16 left-[4.25rem] h-7 text-[13px]"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={finishRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishRename();
              if (e.key === "Escape") {
                setDraft(node.name);
                setRenaming(false);
              }
            }}
          />
        )}
        {job && <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-text" aria-hidden />}
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground"
          aria-label={node.hidden ? `Show layer ${node.name}` : `Hide layer ${node.name}`}
          aria-pressed={!node.hidden}
          onClick={() => commit(updateNode(doc, node.id, { hidden: !node.hidden }))}
        >
          {node.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground data-[state=open]:bg-background/60" aria-label={`Actions for ${node.name}`}>
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 50)}>
              <Pencil /> Rename layer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => commit(duplicateNode(doc, node.id, nanoid(8)))}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void downloadLayer(doc, node).catch(() => toast.error("Could not download the layer."))}>
              <Download /> Download
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                select(node.id);
                setSplitTarget(node.id);
                openTool("decompose");
              }}
            >
              <SplitSquareVertical /> Separate layer
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                select(node.id);
                setMode("eraser");
              }}
              disabled={mode === "brush" || mode === "eraser"}
            >
              <Brush /> {node.maskSrc ? "Edit mask" : "Add mask"}
            </DropdownMenuItem>
            {node.maskSrc && (
              <DropdownMenuItem onSelect={() => commit(updateNode(doc, node.id, { maskSrc: undefined }))}>
                <Scissors /> Delete mask
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => move(1)} disabled={node.z >= total - 1}>
              <ArrowUp /> Bring forward
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => move(-1)} disabled={node.z <= 0}>
              <ArrowDown /> Send backward
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/** Per-layer AI: “Layer edit prompt” + reference → Generate / Regenerate, and the layer's revisions. */
function SelectedLayer({ node }: { node: LayerNode }) {
  const { doc, commit, run, engine, models, isDemo, jobs, endJob, busyJob } = useEditor();
  const [prompt, setPrompt] = useState(node.prompt ?? "");
  const [ref, setRef] = useState<string | null>(node.refSrc ?? null);
  const options = modelsFor(models, TOOL_MODELS.regenerate[engine]);
  const [modelId, setModelId] = useState<string | undefined>();
  const model = options.find((m) => m.id === modelId) ?? options[0];
  // Layers cut out of a picture keep their transparency; the bottom layer is usually a full picture.
  const [keepAlpha, setKeepAlpha] = useState(node.z > 0);
  const [starting, setStarting] = useState(false);
  const running = busyJob(node.id);
  const failed = useMemo(() => {
    const j = latestJob(jobs, ["regenerate"], node.id);
    return j && isFailed(j) ? j : undefined;
  }, [jobs, node.id]);
  const edited = node.revisions.length > 1;
  const rev = node.revisions[node.revision];

  const go = async () => {
    if (!prompt.trim()) {
      toast.error("Describe the change in the layer edit prompt");
      return;
    }
    setStarting(true);
    commit(updateNode(doc, node.id, { prompt: prompt.trim(), refSrc: ref ?? undefined }));
    await run({ tool: "regenerate", target: { kind: "node", node }, prompt: prompt.trim(), refs: ref ? [ref] : undefined, modelId: model?.id, settings: { keepAlpha }, label: "Layer edit" });
    setStarting(false);
  };

  return (
    <div className="space-y-3 border-t px-3 pt-3 pb-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-[13px] font-medium">{node.name}</h3>
        <span className="shrink-0 font-mono text-[11px] text-subtle-foreground">
          {Math.round(node.w)} × {Math.round(node.h)}
        </span>
      </div>
      <Field label="Layer edit prompt" htmlFor="layer-prompt">
        <Textarea
          id="layer-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={2000}
          placeholder="e.g. “make the jacket red leather”"
          className="min-h-16 text-[13px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void go();
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <RefPicker value={ref} onChange={setRef} />
        {options.length > 1 && (
          <Select value={model?.id} onValueChange={setModelId}>
            <SelectTrigger size="sm" className="h-8 max-w-[11rem] rounded-full text-[12px]" aria-label="Model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <label className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
        Keep transparency (cut the background back out)
        <Switch checked={keepAlpha} onCheckedChange={setKeepAlpha} aria-label="Keep transparency" />
      </label>
      {running ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[12px]">
          <Loader2 className="size-3.5 animate-spin text-brand-text" />
          <span className="min-w-0 flex-1 truncate">
            {running.label} · {jobStatusText(running.result)}
          </span>
          <button type="button" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => endJob(running.id, "cancel")}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[12px] text-muted-foreground">{costLabel(model, isDemo(model))}</span>
          <Button size="sm" className="rounded-full" onClick={() => void go()} disabled={starting || !model}>
            {starting ? <Loader2 className="animate-spin" /> : <Sparkles />} {edited ? "Regenerate layer" : "Generate layer"}
          </Button>
        </div>
      )}
      {failed && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px]">
          <p className="font-medium text-destructive">Layer generation failed</p>
          <p className="text-muted-foreground">{failed.result?.error ?? "Try again."}</p>
          <div className="mt-1.5 flex gap-3">
            <button type="button" className="font-medium text-brand-text hover:underline" onClick={() => void go()}>
              Try again
            </button>
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => endJob(failed.id, "dismiss")}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {edited && (
        <div className="space-y-1.5 rounded-lg bg-muted/60 p-2">
          <div className="flex items-center gap-1">
            <Button size="icon-xs" variant="ghost" aria-label="Show previous versions" disabled={node.revision === 0} onClick={() => commit(updateNode(doc, node.id, setRevision(node, node.revision - 1)))}>
              <ChevronLeft />
            </Button>
            <span className="min-w-0 flex-1 truncate text-center text-[12px]">
              <span className="font-medium">{rev?.label ?? "Version"}</span> · {node.revision + 1}/{node.revisions.length}
            </span>
            <Button size="icon-xs" variant="ghost" aria-label="Show next versions" disabled={node.revision >= node.revisions.length - 1} onClick={() => commit(updateNode(doc, node.id, setRevision(node, node.revision + 1)))}>
              <ChevronRight />
            </Button>
          </div>
          <Button size="xs" variant="ghost" className="w-full" disabled={node.revision === 0} onClick={() => commit(updateNode(doc, node.id, setRevision(node, 0)))}>
            <RotateCcw /> Reset layer
          </Button>
        </div>
      )}
      <Field label="Opacity" hint={`${Math.round((node.opacity ?? 1) * 100)}%`}>
        <Slider aria-label="Opacity" min={0} max={100} step={1} value={[Math.round((node.opacity ?? 1) * 100)]} onValueChange={([v]) => commit(updateNode(doc, node.id, { opacity: v / 100 }))} />
      </Field>
      <div className="grid grid-cols-5 gap-1.5">
        {(
          [
            ["x", "X"],
            ["y", "Y"],
            ["w", "W"],
            ["h", "H"],
            ["rotation", "°"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="space-y-0.5">
            <span className="block text-center text-[11px] text-muted-foreground">{label}</span>
            <Input
              type="number"
              inputMode="decimal"
              aria-label={k === "rotation" ? "Rotation in degrees" : `${label} in pixels`}
              className="h-7 px-1 text-center font-mono text-[12px]"
              value={Math.round(node[k])}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || ((k === "w" || k === "h") && v < 1)) return;
                commit(updateNode(doc, node.id, { [k]: v }));
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function LayersPanel() {
  const { doc, commit, selected, busyJob } = useEditor();
  const rows = useMemo(() => [...doc.nodes].sort((a, b) => b.z - a.z), [doc.nodes]);
  const list = useRef<HTMLUListElement>(null);
  const [dragging, setDragging] = useState<{ id: string; before: number } | null>(null);

  // Drag a row by its handle: drop it between two rows (top of the list = front).
  const onDragHandle = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = list.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>(":scope > li")];
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const slot = (y: number) => {
      const i = items.findIndex((li) => {
        const r = li.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      return i < 0 ? items.length : i;
    };
    let before = slot(e.clientY);
    setDragging({ id, before });
    const move = (ev: PointerEvent) => {
      before = slot(ev.clientY);
      setDragging({ id, before });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setDragging(null);
      const from = rows.findIndex((r) => r.id === id);
      let to = before > from ? before - 1 : before;
      to = Math.max(0, Math.min(rows.length - 1, to));
      if (to !== from) commit(moveNode(doc, id, rows.length - 1 - to));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col border-l bg-background" aria-label="Layers panel">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <h2 className="text-[13px] font-semibold">Layers</h2>
        <span className="font-mono text-[12px] text-subtle-foreground">{doc.nodes.length}</span>
        <div className="ml-auto">
          <AddLayer />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        <ul ref={list} className="space-y-0.5 px-2 pb-2" aria-label="Layers, front to back">
          {rows.map((n, i) => {
            const job = busyJob(n.id);
            const busy = job ? `${job.tool === "split" ? `Separating ${n.name}` : job.label} · ${jobStatusText(job.result)}` : undefined;
            return <LayerRow key={n.id} node={n} index={n.z} total={rows.length} selected={n.id === selected?.id} busy={busy} onDragHandle={onDragHandle} dropBefore={!!dragging && dragging.before === i && dragging.id !== n.id} />;
          })}
          {dragging && dragging.before === rows.length && <li className="mx-2 h-0.5 rounded-full bg-primary" aria-hidden />}
        </ul>
        {selected ? (
          <SelectedLayer key={selected.id} node={selected} />
        ) : (
          <p className="border-t px-4 py-4 text-[12px] text-pretty text-muted-foreground">Select a layer in the Layers panel, then move it, resize it, or describe your change in its prompt.</p>
        )}
      </div>
    </aside>
  );
}
