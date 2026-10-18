"use client";

import {
  AtSign,
  AudioLines,
  Clapperboard,
  Columns3,
  Combine,
  Eraser,
  Film,
  Frame,
  GalleryHorizontal,
  ImageIcon,
  MessageSquareText,
  Mic2,
  MonitorPlay,
  Package,
  Sparkles,
  StickyNote,
  Type,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext } from "react";
import type { CanvasGraph, CanvasNodeData, CanvasPlan, NodeDescription, PortType } from "@/lib/catalog/canvas";
import type { Engine, Generation, GenerationStatus, ModelDef, OutputFile } from "@/lib/catalog/types";
import type { EngineMode } from "@/lib/api";

export const ICONS: Record<string, LucideIcon> = {
  Type,
  ImageIcon,
  Film,
  AudioLines,
  AtSign,
  Sparkles,
  Combine,
  Frame,
  ZoomIn,
  Eraser,
  Mic2,
  MonitorPlay,
  StickyNote,
  Clapperboard,
  MessageSquareText,
  Package,
  GalleryHorizontal,
  Columns3,
};

/** A node type's or template's icon, by lucide name. */
export function NodeIcon({ name, className }: { name: string; className?: string }) {
  const Icon: LucideIcon = ICONS[name] ?? Sparkles;
  return <Icon className={className} />;
}

/** Edge and handle colours per port type (the app's chart tokens, so both themes work). */
export const PORT_COLOR: Record<PortType, string> = {
  text: "var(--chart-2)",
  image: "var(--chart-5)",
  video: "var(--chart-4)",
  audio: "var(--chart-3)",
  element: "var(--chart-1)",
};

export type NodeState = GenerationStatus | "idle";

/** What a generator node has made: its latest run's generations, folded into one status. */
export interface NodeResults {
  gens: Generation[];
  state: NodeState;
  /** 0–1 while running. */
  progress: number | null;
  message: string | null;
  error: string | null;
  /** Every output of the latest run, in order. */
  outputs: { g: Generation; o: OutputFile; i: number }[];
}

export const EMPTY_RESULTS: NodeResults = { gens: [], state: "idle", progress: null, message: null, error: null, outputs: [] };

export function foldResults(gens: Generation[]): NodeResults {
  if (!gens.length) return EMPTY_RESULTS;
  const has = (s: GenerationStatus) => gens.some((g) => g.status === s);
  const state: NodeState = has("running") ? "running" : has("queued") ? "queued" : has("failed") ? "failed" : has("canceled") ? "canceled" : "succeeded";
  const live = gens.filter((g) => g.status === "running" || g.status === "queued");
  const progress = live.length ? live.reduce((n, g) => n + (g.progress ?? 0), 0) / live.length : null;
  return {
    gens,
    state,
    progress: progress && progress > 0 ? progress : null,
    message: live[0]?.message ?? null,
    error: gens.find((g) => g.status === "failed")?.error ?? null,
    outputs: gens.flatMap((g) => (g.status === "succeeded" ? g.outputs.map((o, i) => ({ g, o, i })) : [])),
  };
}

export interface EditorApi {
  canvasId: string;
  graph: CanvasGraph;
  plan: CanvasPlan;
  describe: (id: string) => NodeDescription | undefined;
  results: (id: string) => NodeResults;
  /** Errors the server gave the last run, per node. */
  runErrors: Record<string, string>;
  engine: Engine;
  mode: EngineMode;
  /** Phone: pan, zoom and tap only. */
  readOnly: boolean;
  running: boolean;
  /** True when this model would run on the demo provider (no key / no ComfyUI). */
  isDemo: (m: ModelDef) => boolean;
  update: (id: string, patch: Partial<CanvasNodeData>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  run: (targets?: string[], force?: boolean) => void;
  cancel: (id: string) => void;
  open: (id: string, index?: number) => void;
  /** Add an input node holding this node's first output, wired nowhere yet. */
  toInput: (id: string) => void;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const v = useContext(EditorContext);
  if (!v) throw new Error("useEditor outside the canvas editor");
  return v;
}
