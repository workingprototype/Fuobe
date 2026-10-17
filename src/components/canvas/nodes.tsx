"use client";

import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import {
  AlertCircle,
  AudioLines,
  Box,
  Check,
  Cloud,
  Copy,
  Cpu,
  ImagePlus,
  Library,
  Loader2,
  MoreHorizontal,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LanguageChip, SlidersChip } from "@/components/studio/audio-controls";
import { fileToSlot, type SlotValue } from "@/components/studio/media-slot";
import { ControlsChip } from "@/components/studio/model-controls";
import { ModelPicker } from "@/components/studio/model-picker";
import { useAssets, useElements } from "@/lib/api";
import { getModel } from "@/lib/catalog";
import {
  defaultModelFor,
  effectiveOp,
  inputPorts,
  isGenerator,
  modelChoices,
  NODE_SPECS,
  nodeLabel,
  nodeOps,
  OUT,
  outputType,
  PORT_TYPE_LABEL,
  PREVIEW_IN,
  sanitizeParams,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
  type PortDef,
  type PortType,
} from "@/lib/catalog/canvas";
import { OPERATION_LABELS, type Engine, type MediaKind, type ModelDef, type OutputFile } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NodeIcon, PORT_COLOR, useEditor, type NodeResults } from "./canvas-context";

export type FlowNode = Node<CanvasNodeData, CanvasNodeType>;

/** Interactive controls inside a node must not drag the node or zoom the board. */
const NO_DRAG = "nodrag nopan nowheel";
const chip = cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 text-[12px] font-medium text-secondary-foreground transition-colors hover:bg-accent", NO_DRAG);

function asNode(id: string, type: CanvasNodeType, data: CanvasNodeData): CanvasNode {
  return { id, type, data, position: { x: 0, y: 0 } };
}

// ---------------------------------------------------------------------------
// Handles

function InPort({ port, count }: { port: PortDef; count: number }) {
  return (
    <div className="relative flex h-6 items-center gap-1.5 pr-3 pl-3.5 text-[11px] text-muted-foreground">
      <Handle
        type="target"
        position={Position.Left}
        id={port.id}
        className="canvas-handle"
        style={{ "--port": PORT_COLOR[port.type] } as React.CSSProperties}
        aria-label={`${port.label} input (${PORT_TYPE_LABEL[port.type]})`}
      />
      <span className={cn("font-medium", count > 0 && "text-foreground")}>{port.label}</span>
      {count > 0 && port.multiple && <span className="font-mono text-subtle-foreground">{count}</span>}
    </div>
  );
}

function OutPort({ type }: { type: PortType }) {
  return (
    <Handle
      type="source"
      position={Position.Right}
      id={OUT}
      className="canvas-handle canvas-handle-out"
      style={{ "--port": PORT_COLOR[type] } as React.CSSProperties}
      aria-label={`${PORT_TYPE_LABEL[type]} output`}
      title={`${PORT_TYPE_LABEL[type]} out — drag to connect`}
    />
  );
}

// ---------------------------------------------------------------------------
// Shell: header (icon, title, badges, menu), body, footer

interface MenuItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  shortcut?: string;
  destructive?: boolean;
  separatorBefore?: boolean;
}

function EditableTitle({ value, placeholder, onChange, readOnly }: { value?: string; placeholder: string; onChange: (v: string | undefined) => void; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onChange(draft.trim() || undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
        aria-label="Node name"
        className={cn("h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-[13px] font-semibold outline-none focus:border-primary", NO_DRAG)}
      />
    );
  }
  return (
    <span
      className="min-w-0 flex-1 truncate text-[13px] font-semibold"
      onDoubleClick={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        setDraft(value ?? placeholder);
        setEditing(true);
      }}
      title={readOnly ? undefined : "Double-click to rename"}
    >
      {value || placeholder}
    </span>
  );
}

function NodeShell({
  id,
  type,
  data,
  selected,
  out,
  badge,
  menu,
  footer,
  children,
  width = 300,
  tone,
}: {
  id: string;
  type: CanvasNodeType;
  data: CanvasNodeData;
  selected: boolean;
  out?: PortType | null;
  badge?: React.ReactNode;
  menu: MenuItem[];
  footer?: React.ReactNode;
  children?: React.ReactNode;
  width?: number;
  tone?: "running" | "failed" | "note";
}) {
  const ed = useEditor();
  const items =(Item: typeof DropdownMenuItem | typeof ContextMenuItem, Sep: typeof DropdownMenuSeparator, Short: typeof DropdownMenuShortcut) =>
    menu.map((m) => (
      <div key={m.label}>
        {m.separatorBefore && <Sep />}
        <Item onSelect={m.onSelect} variant={m.destructive ? "destructive" : "default"}>
          <m.icon className="size-4" />
          {m.label}
          {m.shortcut && <Short>{m.shortcut}</Short>}
        </Item>
      </div>
    ));
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={ed.readOnly}>
        <div
          className={cn(
            "group/node rounded-xl border bg-card text-card-foreground shadow-soft transition-[box-shadow,border-color]",
            selected && "border-primary ring-4 ring-brand-faint",
            tone === "running" && !selected && "border-primary/50",
            tone === "failed" && !selected && "border-destructive/50",
            tone === "note" && "border-highlight/70 bg-highlight/15",
          )}
          style={{ width }}
          data-testid={`canvas-node-${id}`}
        >
          <div className="relative flex h-10 items-center gap-2 border-b px-3">
            <NodeIcon name={NODE_SPECS[type].icon} className="size-4 shrink-0 text-muted-foreground" />
            <EditableTitle value={data.label} placeholder={nodeLabel({ type, data: { ...data, label: undefined } })} onChange={(label) => ed.update(id, { label })} readOnly={ed.readOnly} />
            {badge}
            {!ed.readOnly && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={cn("-mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", NO_DRAG)} aria-label="Node actions">
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {items(DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {out && <OutPort type={out} />}
          </div>
          {children}
          {footer}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">{items(ContextMenuItem, ContextMenuSeparator as typeof DropdownMenuSeparator, ContextMenuShortcut as typeof DropdownMenuShortcut)}</ContextMenuContent>
    </ContextMenu>
  );
}

function baseMenu(ed: ReturnType<typeof useEditor>, id: string): MenuItem[] {
  return [
    { label: "Duplicate", icon: Copy, onSelect: () => ed.duplicate(id), shortcut: "⌘D", separatorBefore: true },
    { label: "Delete", icon: Trash2, onSelect: () => ed.remove(id), shortcut: "⌫", destructive: true },
  ];
}

// ---------------------------------------------------------------------------
// Results

function OutputThumb({ o, onOpen, className, large }: { o: OutputFile; onOpen: () => void; className?: string; large?: boolean }) {
  const media = cn("w-full object-cover", large ? "max-h-80" : "max-h-44");
  if (o.kind === "text") {
    return (
      <button onClick={onOpen} className={cn("block w-full rounded-lg bg-muted p-2.5 text-left text-[12px] leading-snug whitespace-pre-line", NO_DRAG, className)}>
        <span className="line-clamp-6">{o.text ?? "Text result"}</span>
      </button>
    );
  }
  if (o.kind === "model3d") {
    return (
      <button onClick={onOpen} className={cn("flex h-20 w-full items-center justify-center gap-2 rounded-lg bg-muted text-[12px] font-medium text-muted-foreground hover:text-foreground", NO_DRAG, className)}>
        <Box className="size-4" /> 3D model
      </button>
    );
  }
  if (o.kind === "audio") {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg bg-brand-faint p-2 text-brand-text", NO_DRAG, className)}>
        <AudioLines className="size-4 shrink-0" />
        <audio src={o.url} controls preload="none" className="h-8 min-w-0 flex-1" />
      </div>
    );
  }
  return (
    <button onClick={onOpen} className={cn("block w-full overflow-hidden rounded-lg bg-muted", NO_DRAG, className)} aria-label="Open result">
      {o.kind === "video" ? (
        <video
          src={`${o.url}#t=0.1`}
          muted
          loop
          playsInline
          preload="metadata"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()}
          className={media}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.url} alt="" loading="lazy" className={media} />
      )}
    </button>
  );
}

function Results({ id, r, compact }: { id: string; r: NodeResults; compact?: boolean }) {
  const ed = useEditor();
  if (r.state === "queued" || r.state === "running") {
    const pct = r.progress != null ? Math.round(r.progress * 100) : null;
    return (
      <div className="relative overflow-hidden rounded-lg bg-muted" style={{ height: compact ? 56 : 96 }}>
        <div className="skeleton-sweep absolute inset-0 animate-skeleton" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
          <p className="shimmer-text animate-shimmer-text truncate text-[12px] font-medium">{r.message ?? (r.state === "queued" ? "Queued" : "Generating…")}</p>
          {pct != null && <span className="font-mono text-[11px] text-muted-foreground">{pct}%</span>}
        </div>
        {pct != null && <div className="absolute inset-x-0 top-0 h-0.5 bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />}
      </div>
    );
  }
  if (r.state === "failed" || r.state === "canceled") {
    return (
      <div className="rounded-lg border border-dashed p-2.5">
        <p className="text-[12px] font-medium">{r.state === "canceled" ? "Canceled" : "Couldn't generate this"}</p>
        {r.error && <p className="mt-0.5 line-clamp-4 text-[12px] leading-snug break-words text-muted-foreground">{r.error}</p>}
        {!ed.readOnly && (
          <button onClick={() => ed.run([id], true)} className={cn(chip, "mt-2")}>
            <RotateCcw className="size-3" /> Retry
          </button>
        )}
      </div>
    );
  }
  if (!r.outputs.length) return null;
  const shown = r.outputs.slice(0, 4);
  return (
    <div className={cn("grid gap-1.5", shown.length > 1 && "grid-cols-2")}>
      {shown.map((x, k) => (
        <OutputThumb key={`${x.g.id}-${x.i}`} o={x.o} onOpen={() => ed.open(id, k)} />
      ))}
      {r.outputs.length > 4 && <p className="col-span-2 text-[11px] text-muted-foreground">+{r.outputs.length - 4} more — open to see them all</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generator nodes (any model, and the utilities)

function OptionSelect<T extends string | number>({ value, options, onChange, label, format }: { value: T | undefined; options: T[]; onChange: (v: T) => void; label: string; format?: (v: T) => string }) {
  return (
    <Select value={value === undefined ? undefined : String(value)} onValueChange={(v) => onChange((typeof options[0] === "number" ? Number(v) : v) as T)}>
      <SelectTrigger size="sm" aria-label={label} className={cn("h-7 gap-1 rounded-full border-0 bg-secondary px-2.5 text-[12px] font-medium shadow-none hover:bg-accent dark:bg-secondary", NO_DRAG)}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((o) => (
          <SelectItem key={String(o)} value={String(o)} className="text-[13px]">
            {format ? format(o) : String(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModelOptions({ id, model, data }: { id: string; model: ModelDef; data: CanvasNodeData }) {
  const ed = useEditor();
  const p = data.params ?? {};
  const o = model.options;
  const d = model.defaults ?? {};
  const set = (patch: Partial<NonNullable<CanvasNodeData["params"]>>) => ed.update(id, { params: { ...p, ...patch } });
  const extra = (p.extra ?? {}) as Record<string, unknown>;
  const setExtra = (param: string, v?: string | number) => {
    const next = { ...extra };
    if (v === undefined) delete next[param];
    else next[param] = v;
    set({ extra: Object.keys(next).length ? (next as Record<string, string | number>) : undefined });
  };
  const items: React.ReactNode[] = [];
  if (o.aspectRatios?.length) items.push(<OptionSelect key="ar" label="Aspect ratio" value={p.aspectRatio ?? d.aspectRatio} options={o.aspectRatios} onChange={(v) => set({ aspectRatio: v })} />);
  if (o.durations?.length && o.durations.length > 1) items.push(<OptionSelect key="dur" label="Duration" value={p.duration ?? d.duration} options={o.durations} onChange={(v) => set({ duration: v })} format={(v) => `${v}s`} />);
  if (o.resolutions?.length && o.resolutions.length > 1) items.push(<OptionSelect key="res" label="Quality" value={p.resolution ?? d.resolution} options={o.resolutions} onChange={(v) => set({ resolution: v })} />);
  if ((o.maxOutputs ?? 1) > 1) items.push(<OptionSelect key="n" label="Count" value={p.numOutputs ?? 1} options={Array.from({ length: Math.min(4, o.maxOutputs!) }, (_, i) => i + 1)} onChange={(v) => set({ numOutputs: v })} format={(v) => `×${v}`} />);
  if (o.voices?.length) items.push(<OptionSelect key="voice" label="Voice" value={p.voice ?? d.voice ?? o.voices[0].id} options={o.voices.map((v) => v.id)} onChange={(v) => set({ voice: v })} format={(v) => o.voices!.find((x) => x.id === v)?.name ?? v} />);
  if (o.languages?.length) items.push(<LanguageChip key="lang" languages={o.languages} value={p.targetLanguage} onChange={(v) => set({ targetLanguage: v })} label="Language" />);
  if (o.audio === true)
    items.push(
      <button key="audio" onClick={() => set({ generateAudio: !(p.generateAudio ?? d.generateAudio ?? false) })} className={cn(chip, (p.generateAudio ?? d.generateAudio) && "bg-brand-faint text-brand-text hover:bg-brand-faint-hover")} aria-pressed={!!(p.generateAudio ?? d.generateAudio)}>
        <AudioLines className="size-3" /> Sound
      </button>,
    );
  if (o.sliders?.length) items.push(<div key="sliders" className={NO_DRAG}><SlidersChip model={model} values={extra} onChange={setExtra} /></div>);
  if (o.controls?.length) items.push(<div key="controls" className={NO_DRAG}><ControlsChip controls={o.controls} values={extra} onChange={setExtra} /></div>);
  if (!items.length) return null;
  return <div className="flex flex-wrap gap-1 [&_button]:h-7 [&_button]:text-[12px]">{items}</div>;
}

function EngineBadge({ model }: { model?: ModelDef }) {
  if (!model) return null;
  const open = model.engine === "open";
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold", open ? "bg-success/15 text-success" : "bg-brand-faint text-brand-text")}>
      {open ? <Cpu className="size-3" /> : <Cloud className="size-3" />}
      {open ? "Open" : "Cloud"}
    </span>
  );
}

function costLabel(ed: ReturnType<typeof useEditor>, model: ModelDef | undefined, cost: number | null): string {
  if (!model) return "";
  if (ed.isDemo(model)) return "Demo · free";
  if (model.engine === "open") return "Free · your GPU";
  return cost == null ? "Price unknown" : cost === 0 ? "Free" : `≈ ${formatCost(cost)}`;
}

const GeneratorNode = memo(function GeneratorNode({ id, type, data, selected }: NodeProps<FlowNode>) {
  const ed = useEditor();
  const node = useMemo(() => asNode(id, type, data), [id, type, data]);
  const model = data.modelId ? getModel(data.modelId) : undefined;
  const ports = inputPorts(node);
  const out = outputType(ed.graph, node);
  const desc = ed.describe(id);
  const r = ed.results(id);
  const ops = nodeOps(node, model);
  const auto = type === "model" && ops.length > 1;
  const inferred = auto ? effectiveOp(ed.graph, ed.graph.nodes.find((n) => n.id === id) ?? node) : undefined;
  const [pickerEngine, setPickerEngine] = useState<Engine>(model?.engine ?? ed.engine);
  const choices = useMemo(() => modelChoices(node), [node]);
  const step = ed.plan.steps.find((s) => s.nodeId === id);
  const reused = ed.plan.reused.find((s) => s.nodeId === id);
  const error = ed.runErrors[id] ?? desc?.error;

  // Handles change with the model and op: tell React Flow to re-measure them.
  const updateInternals = useUpdateNodeInternals();
  const portKey = `${ports.map((p) => p.id).join(",")}|${out}`;
  useEffect(() => updateInternals(id), [id, portKey, updateInternals]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of ed.graph.edges) if (e.target === id && e.targetHandle) m.set(e.targetHandle, (m.get(e.targetHandle) ?? 0) + 1);
    return m;
  }, [ed.graph.edges, id]);

  const pickModel = (m: ModelDef) => {
    const keepOp = data.op && m.routes.some((x) => x.op === data.op) ? data.op : undefined;
    ed.update(id, { modelId: m.id, op: keepOp, params: sanitizeParams(m, data.params) });
  };

  // Upscale / Remove background: image or video.
  const variants = NODE_SPECS[type].ops && NODE_SPECS[type].ops!.length === 2 ? NODE_SPECS[type].ops! : null;
  const setVariant = (kind: MediaKind) => {
    const op = variants![kind === "video" ? 1 : 0];
    const m = defaultModelFor(op, model?.engine ?? ed.engine, { hidden: true }) ?? defaultModelFor(op, model?.engine === "open" ? "cloud" : "open", { hidden: true });
    ed.update(id, { mediaKind: kind, modelId: m?.id, op: undefined, params: undefined });
  };

  const running = r.state === "running" || r.state === "queued";
  // A pinned node never runs: its menu offers the unpin instead of Run.
  const menu: MenuItem[] = [
    ...(data.pinned
      ? []
      : [
          { label: "Run node", icon: Play, onSelect: () => ed.run([id]) },
          { label: "Re-run", icon: RotateCcw, onSelect: () => ed.run([id], true) },
        ]),
    ...(running ? [{ label: "Cancel", icon: Square, onSelect: () => ed.cancel(id) }] : []),
    { label: data.pinned ? "Unpin result" : "Pin result", icon: data.pinned ? PinOff : Pin, onSelect: () => ed.update(id, { pinned: !data.pinned }), separatorBefore: !data.pinned },
    ...(r.outputs.some((x) => ["image", "video", "audio"].includes(x.o.kind)) ? [{ label: "Use result as an input", icon: ImagePlus, onSelect: () => ed.toInput(id) }] : []),
    ...baseMenu(ed, id),
  ];
  const promptPort = ports.find((p) => p.id === "prompt");
  // With text wired in, the node's own words are optional: keep the box folded until wanted.
  const [addWords, setAddWords] = useState(false);
  const showPrompt = !!promptPort && (!counts.get("prompt") || !!data.prompt || addWords);
  const stateHint = data.pinned ? "Pinned" : running ? "Running" : step ? (r.state === "idle" ? "Not run yet" : "Changed") : reused ? "Up to date" : "";

  return (
    <NodeShell
      id={id}
      type={type}
      data={data}
      selected={!!selected}
      out={out}
      menu={menu}
      tone={running ? "running" : r.state === "failed" ? "failed" : undefined}
      badge={
        <>
          {data.pinned && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Pin className="size-3.5 shrink-0 text-brand-text" aria-label="Pinned" />
              </TooltipTrigger>
              <TooltipContent>Pinned: runs reuse this result</TooltipContent>
            </Tooltip>
          )}
          <EngineBadge model={model} />
        </>
      }
      footer={
        <div className="flex h-10 items-center gap-2 border-t px-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {[stateHint, step || r.state === "idle" ? costLabel(ed, model, desc?.costUsd ?? null) : ""].filter(Boolean).join(" · ")}
          </span>
          {!ed.readOnly && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => (running ? ed.cancel(id) : data.pinned ? ed.update(id, { pinned: false }) : ed.run([id], !step && !!reused))}
                  disabled={ed.running && !running}
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50",
                    running || data.pinned ? "bg-muted text-foreground hover:bg-accent" : "bg-primary text-primary-foreground hover:bg-primary/90",
                    NO_DRAG,
                  )}
                  aria-label={running ? "Cancel" : data.pinned ? "Unpin result" : step ? "Run node" : "Run node again"}
                >
                  {running ? <Square className="size-3" /> : data.pinned ? <PinOff className="size-3.5" /> : step ? <Play className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{running ? "Cancel" : data.pinned ? "Unpin to run it again" : step ? "Run this node (and what it needs)" : "Run it again"}</TooltipContent>
            </Tooltip>
          )}
        </div>
      }
    >
      {ports.length > 0 && <div className="border-b py-1">{ports.map((p) => <InPort key={p.id} port={p} count={counts.get(p.id) ?? 0} />)}</div>}
      <div className="space-y-2 p-3">
        {variants && (
          <div className={cn("inline-grid h-7 grid-cols-2 rounded-full bg-muted p-0.5 text-[12px] font-medium", NO_DRAG)} role="radiogroup" aria-label="Image or video">
            {(["image", "video"] as const).map((k) => (
              <button key={k} role="radio" aria-checked={(data.mediaKind ?? "image") === k} disabled={ed.readOnly} onClick={() => setVariant(k)} className={cn("rounded-full px-2.5 capitalize", (data.mediaKind ?? "image") === k ? "bg-background shadow-soft" : "text-muted-foreground")}>
                {k}
              </button>
            ))}
          </div>
        )}
        <div className={cn("flex flex-wrap items-center gap-1.5 [&>button]:h-7 [&>button]:text-[12px]", ed.readOnly && "pointer-events-none")}>
          {choices.length ? (
            <div className={NO_DRAG}>
              <ModelPicker models={choices} value={model} onChange={pickModel} engine={pickerEngine} onEngineChange={setPickerEngine} />
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">No model for this yet.</p>
          )}
          {auto && model && (
            <OptionSelect
              label="Operation"
              value={data.op ?? "__auto"}
              options={["__auto", ...ops]}
              onChange={(v) => ed.update(id, { op: v === "__auto" ? undefined : (v as typeof ops[number]) })}
              format={(v) => (v === "__auto" ? `Auto${inferred ? ` · ${OPERATION_LABELS[inferred]}` : ""}` : OPERATION_LABELS[v as keyof typeof OPERATION_LABELS])}
            />
          )}
        </div>
        {promptPort && !showPrompt && !ed.readOnly && (
          <button className={chip} onClick={() => setAddWords(true)}>
            <Plus className="size-3" /> Add your own words
          </button>
        )}
        {showPrompt && (
          <textarea
            value={data.prompt ?? ""}
            onChange={(e) => ed.update(id, { prompt: e.target.value })}
            onBlur={() => !data.prompt && setAddWords(false)}
            autoFocus={addWords && !data.prompt}
            readOnly={ed.readOnly}
            rows={2}
            placeholder={promptPort.label === "Text" ? "Text to speak, or connect a text" : "Describe it — connected text joins in, or use {text}"}
            aria-label={promptPort.label}
            className={cn("field-sizing-content max-h-36 min-h-14 w-full resize-none rounded-lg bg-muted px-2.5 py-2 text-[13px] leading-snug outline-none placeholder:text-subtle-foreground focus:ring-2 focus:ring-brand-faint", NO_DRAG)}
          />
        )}
        {model && !ed.readOnly && <ModelOptions id={id} model={model} data={data} />}
        <Results id={id} r={r} />
        {error && r.state !== "failed" && (
          <p className={cn("flex items-start gap-1.5 text-[12px] leading-snug", ed.runErrors[id] ? "text-destructive" : "text-warning")}>
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// Inputs

const PromptNode = memo(function PromptNode({ id, type, data, selected }: NodeProps<FlowNode>) {
  const ed = useEditor();
  return (
    <NodeShell id={id} type={type} data={data} selected={!!selected} out="text" menu={baseMenu(ed, id)} width={280}>
      <div className="p-3">
        <textarea
          value={data.text ?? ""}
          onChange={(e) => ed.update(id, { text: e.target.value })}
          readOnly={ed.readOnly}
          rows={3}
          placeholder="e.g. “a lighthouse on a cliff at golden hour, cinematic”"
          aria-label="Text"
          className={cn("field-sizing-content max-h-60 min-h-20 w-full resize-none rounded-lg bg-muted px-2.5 py-2 text-[13px] leading-snug outline-none placeholder:text-subtle-foreground focus:ring-2 focus:ring-brand-faint", NO_DRAG)}
        />
      </div>
    </NodeShell>
  );
});

const KIND_OF: Partial<Record<CanvasNodeType, "image" | "video" | "audio">> = { "image-input": "image", "video-input": "video", "audio-input": "audio" };

function LibraryButton({ kind, onPick }: { kind: MediaKind; onPick: (url: string, name?: string) => void }) {
  const [open, setOpen] = useState(false);
  const assets = useAssets(undefined, kind);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={chip}>
          <Library className="size-3" /> Library
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start" collisionPadding={12}>
        <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
        {assets.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : assets.data?.length ? (
          <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto">
            {assets.data.map((a) => (
              <button
                key={a.id}
                className="aspect-square overflow-hidden rounded-md bg-muted ring-primary transition hover:ring-2"
                onClick={() => {
                  onPick(a.url, a.name ?? undefined);
                  setOpen(false);
                }}
                aria-label={a.name ?? "Library item"}
              >
                {a.kind === "video" ? (
                  <video src={`${a.url}#t=0.1`} muted preload="metadata" className="size-full object-cover" />
                ) : a.kind === "audio" ? (
                  <span className="grid size-full place-items-center bg-brand-faint text-brand-text">
                    <AudioLines className="size-4" />
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt="" loading="lazy" className="size-full object-cover" />
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MediaPreview({ kind, url }: { kind: MediaKind; url: string }) {
  if (kind === "video") return <video src={url} muted playsInline loop controls preload="metadata" className={cn("max-h-52 w-full rounded-lg bg-media object-contain", NO_DRAG)} />;
  if (kind === "audio")
    return (
      <div className={cn("flex items-center gap-2 rounded-lg bg-brand-faint p-2 text-brand-text", NO_DRAG)}>
        <AudioLines className="size-4 shrink-0" />
        <audio src={url} controls preload="metadata" className="h-8 min-w-0 flex-1" />
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="max-h-52 w-full rounded-lg bg-muted object-contain" />;
}

const MediaInputNode = memo(function MediaInputNode({ id, type, data, selected }: NodeProps<FlowNode>) {
  const ed = useEditor();
  const kind = KIND_OF[type]!;
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<SlotValue | null>(null);
  const [over, setOver] = useState(false);
  const take = (f: File) =>
    void fileToSlot(
      f,
      (v) => {
        if (!v) return setPending(null);
        if (v.uploading) return setPending(v);
        setPending(null);
        ed.update(id, { url: v.ref, name: v.name });
      },
      kind,
    );
  const accept = kind === "image" ? "image/png,image/jpeg,image/webp,image/gif" : kind === "video" ? "video/mp4,video/webm,video/quicktime" : "audio/*";
  return (
    <NodeShell id={id} type={type} data={data} selected={!!selected} out={kind} menu={baseMenu(ed, id)} width={260}>
      <div
        className="space-y-2 p-3"
        onDragOver={(e) => {
          if (ed.readOnly || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const f = e.dataTransfer.files?.[0];
          if (!f || ed.readOnly) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          take(f);
        }}
      >
        {pending ? (
          <div className="relative">
            <MediaPreview kind={kind} url={pending.preview} />
            <div className="absolute inset-0 grid place-items-center rounded-lg bg-background/60">
              <Loader2 className="size-5 animate-spin" />
            </div>
          </div>
        ) : data.url ? (
          <MediaPreview kind={kind} url={data.url} />
        ) : (
          <button
            onClick={() => input.current?.click()}
            disabled={ed.readOnly}
            className={cn(
              "flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong text-muted-foreground transition-colors hover:border-primary hover:bg-brand-faint hover:text-brand-text",
              over && "border-primary bg-brand-faint text-brand-text",
              NO_DRAG,
            )}
          >
            <Upload className="size-4" />
            <span className="text-[12px] font-medium">Drop {kind === "audio" ? "an audio file" : `a${kind === "image" ? "n" : ""} ${kind}`} or click to upload</span>
          </button>
        )}
        {!ed.readOnly && (
          <div className="flex flex-wrap gap-1">
            {data.url && (
              <button className={chip} onClick={() => input.current?.click()}>
                <Upload className="size-3" /> Replace
              </button>
            )}
            <LibraryButton kind={kind} onPick={(url, name) => ed.update(id, { url, name })} />
            {data.url && (
              <button className={chip} onClick={() => ed.update(id, { url: undefined, name: undefined })} aria-label="Remove file">
                <X className="size-3" /> Remove
              </button>
            )}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) take(f);
            e.target.value = "";
          }}
        />
      </div>
    </NodeShell>
  );
});

const ElementNode = memo(function ElementNode({ id, type, data, selected }: NodeProps<FlowNode>) {
  const ed = useEditor();
  const elements = useElements();
  const [open, setOpen] = useState(false);
  const visual = (elements.data ?? []).filter((e) => e.kind !== "voice");
  const el = visual.find((e) => e.id === data.elementId);
  const preview = el?.references[0] ?? data.preview;
  return (
    <NodeShell id={id} type={type} data={data} selected={!!selected} out="element" menu={baseMenu(ed, id)} width={240}>
      <div className="space-y-2 p-3">
        {data.handle ? (
          <div className="flex items-center gap-2.5">
            <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview && <img src={preview} alt="" className="size-full object-cover" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{el?.name ?? data.name ?? data.handle}</span>
              <span className="block truncate font-mono text-[12px] text-brand-text">@{data.handle}</span>
            </span>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">Adds an @character, location, prop or style to the models it connects to.</p>
        )}
        {!ed.readOnly && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button className={chip}>{data.handle ? "Change" : "Pick an element"}</button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-1.5" align="start" collisionPadding={12}>
              {visual.length ? (
                <div className="max-h-72 overflow-y-auto">
                  {visual.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        ed.update(id, { elementId: e.id, handle: e.handle, name: e.name, preview: e.references[0], label: data.label });
                        setOpen(false);
                      }}
                      className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent", e.id === data.elementId && "bg-brand-faint")}
                    >
                      <span className="size-8 shrink-0 overflow-hidden rounded-md bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {e.references[0] && <img src={e.references[0]} alt="" className="size-full object-cover" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{e.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          @{e.handle} · {e.kind}
                        </span>
                      </span>
                      {e.id === data.elementId && <Check className="size-3.5 text-brand-text" />}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="p-3 text-[13px] text-muted-foreground">
                  No elements yet.{" "}
                  <Link href="/elements" className="text-brand-text underline-offset-4 hover:underline">
                    Create one
                  </Link>
                </p>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// Output preview and notes

const OutputNode = memo(function OutputNode({ id, type, data, selected }: NodeProps<FlowNode>) {
  const ed = useEditor();
  const nodes = useMemo(() => new Map(ed.graph.nodes.map((n) => [n.id, n])), [ed.graph.nodes]);
  // The saved width (templates set one), not React Flow's measured width (that would feed back).
  const width = nodes.get(id)?.width;
  const sources = ed.graph.edges
    .filter((e) => e.target === id)
    .map((e) => nodes.get(e.source))
    .filter((n): n is CanvasNode => !!n)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const w = width ?? (sources.length > 1 ? 560 : 320);
  const menu: MenuItem[] = [{ label: "Run what feeds this", icon: Play, onSelect: () => ed.run([id]) }, ...baseMenu(ed, id)];
  return (
    <NodeShell id={id} type={type} data={data} selected={!!selected} menu={menu} width={w}>
      <div className="relative p-3">
        <Handle type="target" position={Position.Left} id={PREVIEW_IN} className="canvas-handle canvas-handle-any" aria-label="Preview input (any type)" />
        {sources.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-muted-foreground">Connect results here to preview them side by side.</p>
        ) : (
          <div className={cn("grid gap-2", sources.length > 1 && "grid-cols-2", sources.length > 2 && w >= 540 && "grid-cols-3")}>
            {sources.map((s) => (
              <figure key={s.id} className="min-w-0 space-y-1">
                <SourcePreview node={s} />
                <figcaption className="truncate text-[11px] text-muted-foreground">{nodeLabel(s)}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </NodeShell>
  );
});

function SourcePreview({ node }: { node: CanvasNode }) {
  const ed = useEditor();
  if (isGenerator(node)) {
    const r = ed.results(node.id);
    if (r.outputs.length) return <OutputThumb o={r.outputs[0].o} onOpen={() => ed.open(node.id, 0)} large />;
    if (r.state !== "idle") return <Results id={node.id} r={r} compact />;
    return <div className="grid h-20 place-items-center rounded-lg bg-muted text-[11px] text-subtle-foreground">Not run yet</div>;
  }
  const kind = KIND_OF[node.type];
  if (kind && node.data.url) return <MediaPreview kind={kind} url={node.data.url} />;
  if (node.type === "prompt") return <p className="line-clamp-6 rounded-lg bg-muted p-2.5 text-[12px] leading-snug">{node.data.text || "Empty text"}</p>;
  return <div className="grid h-20 place-items-center rounded-lg bg-muted text-[11px] text-subtle-foreground">Nothing yet</div>;
}

const NoteNode = memo(function NoteNode({ id, type, data, selected }: NodeProps<FlowNode>) {
  const ed = useEditor();
  return (
    <NodeShell id={id} type={type} data={data} selected={!!selected} menu={baseMenu(ed, id)} width={240} tone="note">
      <div className="p-3">
        <textarea
          value={data.text ?? ""}
          onChange={(e) => ed.update(id, { text: e.target.value })}
          readOnly={ed.readOnly}
          rows={3}
          placeholder="A note for this board"
          aria-label="Note"
          className={cn("field-sizing-content max-h-72 min-h-16 w-full resize-none bg-transparent text-[13px] leading-snug outline-none placeholder:text-muted-foreground", NO_DRAG)}
        />
      </div>
    </NodeShell>
  );
});

export const NODE_TYPES = {
  prompt: PromptNode,
  "image-input": MediaInputNode,
  "video-input": MediaInputNode,
  "audio-input": MediaInputNode,
  element: ElementNode,
  model: GeneratorNode,
  join: GeneratorNode,
  frame: GeneratorNode,
  upscale: GeneratorNode,
  "bg-remove": GeneratorNode,
  tts: GeneratorNode,
  output: OutputNode,
  note: NoteNode,
} satisfies Record<CanvasNodeType, React.ComponentType<NodeProps<FlowNode>>>;

export { MediaPreview, OutputThumb, Results, EngineBadge, costLabel };
