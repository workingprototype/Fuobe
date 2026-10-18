"use client";

import "@xyflow/react/dist/style.css";
import "./canvas.css";

import { useQueryClient } from "@tanstack/react-query";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type FitViewOptions,
  type NodeChange,
  type OnConnectEnd,
  type Viewport,
} from "@xyflow/react";
import { ChevronDown, ChevronLeft, Check, Cloud, Cpu, LayoutGrid, List, Loader2, Play, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { fileToSlot } from "@/components/studio/media-slot";
import { Viewer } from "@/components/studio/viewer";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEngine, useStatus } from "@/lib/api";
import { getModel } from "@/lib/catalog";
import {
  acceptsType,
  cleanGraph,
  connectionError,
  convertEngine,
  defaultModelForNode,
  describeNode,
  graphEngine,
  inputPorts,
  isGenerator,
  newId,
  nodeLabel,
  OUT,
  outputType,
  paletteItems,
  planCanvas,
  PREVIEW_IN,
  singleInput,
  type Canvas,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasNode,
  type CanvasNodeData,
  type NodeDescription,
  type PaletteItem,
  type PortType,
} from "@/lib/catalog/canvas";
import type { Engine, MediaKind, ModelDef } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EditorContext, EMPTY_RESULTS, foldResults, PORT_COLOR, type EditorApi, type NodeResults } from "./canvas-context";
import { NodeList } from "./node-list";
import { NODE_TYPES, type FlowNode } from "./nodes";
import { AddMenu, DRAG_TYPE, Palette, PaletteToggle } from "./palette";
import { saveCanvas, useCanvasView, useLiveGenerations, useRunCanvas, type CanvasView } from "./use-canvas";

const GRID: [number, number] = [16, 16];
const snap = (p: { x: number; y: number }) => ({ x: Math.round(p.x / GRID[0]) * GRID[0], y: Math.round(p.y / GRID[1]) * GRID[1] });

const toFlowNode = (n: CanvasNode): FlowNode => ({ id: n.id, type: n.type, position: n.position, data: n.data, ...(n.type === "output" && n.width ? { width: n.width } : {}) });
const toFlowEdge = (e: CanvasEdge): Edge => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? OUT, targetHandle: e.targetHandle ?? null });

function toGraph(nodes: FlowNode[], edges: Edge[], viewport?: Viewport): CanvasGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as CanvasNode["type"],
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: n.data,
      ...(n.type === "output" && n.width ? { width: n.width } : {}),
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? OUT, targetHandle: e.targetHandle ?? null })),
    ...(viewport && { viewport: { x: Math.round(viewport.x), y: Math.round(viewport.y), zoom: Math.round(viewport.zoom * 1000) / 1000 } }),
  };
}

/** Edges whose handles still exist after a model / op change. */
function pruneEdges(nodes: FlowNode[], edges: Edge[]): Edge[] {
  const keep = new Set(cleanGraph(toGraph(nodes, edges)).edges.map((e) => e.id));
  return edges.filter((e) => keep.has(e.id));
}

const KIND_INPUT: Record<string, CanvasNode["type"]> = { image: "image-input", video: "video-input", audio: "audio-input" };

// ---------------------------------------------------------------------------

export function CanvasEditor({ id }: { id: string }) {
  const live = useLiveGenerations(id);
  const view = useCanvasView(id, live);
  if (view.isLoading) return <EditorSkeleton />;
  if (!view.data) {
    return (
      <div className="flex min-h-svh flex-col">
        <div className="flex h-14 items-center px-3 md:hidden">
          <SidebarTrigger />
        </div>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle className="text-[22px]">This canvas isn&apos;t here</EmptyTitle>
            <EmptyDescription>It may have been deleted. Your results are still in the library.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="secondary">
              <Link href="/canvas">All canvases</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Editor id={id} initial={view.data.canvas} view={view.data} />
    </ReactFlowProvider>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex h-svh flex-col md:h-[calc(100svh-0.5rem)]">
      <div className="flex h-14 items-center gap-3 border-b px-3 sm:px-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="ml-auto h-8 w-24 rounded-full" />
      </div>
      <div className="relative flex-1">
        <Skeleton className="absolute top-[20%] left-[15%] h-40 w-64 rounded-xl" />
        <Skeleton className="absolute top-[30%] left-[45%] h-56 w-72 rounded-xl" />
      </div>
    </div>
  );
}

type SaveState = "saved" | "saving" | "error";

interface MenuState {
  x: number;
  y: number;
  flow: { x: number; y: number };
  connect?: { nodeId: string; handleId: string | null; from: "source" | "target"; type: PortType };
}

function Editor({ id, initial, view }: { id: string; initial: Canvas; view: CanvasView }) {
  const qc = useQueryClient();
  const rf = useReactFlow<FlowNode, Edge>();
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();
  const [engine, setEngine, mode] = useEngine();
  const status = useStatus().data;
  const runM = useRunCanvas(id);

  const [nodes, setNodes] = useState<FlowNode[]>(() => initial.graph.nodes.map(toFlowNode));
  const [edges, setEdges] = useState<Edge[]>(() => initial.graph.edges.map(toFlowEdge));
  const [name, setName] = useState(initial.name);
  const [tab, setTab] = useState<"board" | "list">("board");
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [viewer, setViewer] = useState<{ nodeId: string; index: number } | null>(null);
  const [runErrors, setRunErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [rev, setRev] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | undefined>(initial.graph.viewport);
  const savedRev = useRef(0);

  // Latest state for event handlers (synced right after each commit).
  const latest = useRef({ nodes, edges });
  useLayoutEffect(() => {
    latest.current = { nodes, edges };
  }, [nodes, edges]);

  const touch = useCallback(() => setRev((r) => r + 1), []);

  // ---- derived: graph, plan, results
  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const planned = useDeferredValue(graph);
  const runs = view.canvas.runs;
  const gens = useMemo(() => new Map(view.generations.map((g) => [g.id, g])), [view.generations]);
  const statusOf = useCallback((gid: string) => gens.get(gid)?.status, [gens]);
  const plan = useMemo(() => planCanvas(planned, { runs, status: statusOf, engineMode: mode }), [planned, runs, statusOf, mode]);
  const descriptions = useMemo(() => {
    const m = new Map<string, NodeDescription>();
    for (const n of planned.nodes) if (isGenerator(n)) m.set(n.id, describeNode(planned, n, { engineMode: mode }));
    return m;
  }, [planned, mode]);
  const results = useMemo(() => {
    const m = new Map<string, NodeResults>();
    for (const [nodeId, r] of Object.entries(runs)) m.set(nodeId, foldResults(r.ids.map((g) => gens.get(g)).filter((g): g is NonNullable<typeof g> => !!g)));
    return m;
  }, [runs, gens]);
  const selected = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const busy = [...results.values()].filter((r) => r.state === "running" || r.state === "queued").length;
  const generators = graph.nodes.filter(isGenerator);

  // Fit around the nodes, leaving the palette's side free.
  const fitOptions = useMemo<FitViewOptions<FlowNode>>(
    () => ({ padding: { top: "56px", right: "56px", bottom: "56px", left: paletteOpen && !isMobile ? "292px" : isMobile ? "16px" : "56px" }, maxZoom: 1, minZoom: isMobile ? 0.3 : 0.5 }),
    [paletteOpen, isMobile],
  );
  // Phones always start fitted (a viewport saved on a big screen would show an empty board).
  const savedViewport = isMobile ? undefined : initial.graph.viewport;
  // Fit once every node has its size (React Flow's own fitView can run after the first few only).
  const initialized = useNodesInitialized();
  const fitted = useRef(false);
  useEffect(() => {
    if (!initialized || fitted.current) return;
    fitted.current = true;
    if (!savedViewport && latest.current.nodes.length) void rf.fitView(fitOptions);
  }, [initialized, savedViewport, rf, fitOptions]);

  const isDemo = useCallback(
    (m: ModelDef) => {
      if (!status) return false;
      if (status.demoMode === "on") return true;
      if (status.demoMode === "off") return false;
      return !m.routes.some((r) => status.providers[r.provider]?.configured);
    },
    [status],
  );

  // ---- autosave
  const save = useCallback(
    async (keepalive = false) => {
      const at = rev;
      if (at === savedRev.current) return;
      setSaveState("saving");
      try {
        await saveCanvas(id, { graph: toGraph(latest.current.nodes, latest.current.edges, viewport.current) }, keepalive);
        savedRev.current = Math.max(savedRev.current, at);
        setSaveState("saved");
        void qc.invalidateQueries({ queryKey: ["canvases"], exact: true });
      } catch {
        setSaveState("error");
      }
    },
    [id, rev, qc],
  );
  useEffect(() => {
    if (rev === 0) return;
    const t = setTimeout(() => void save(), 700);
    return () => clearTimeout(t);
  }, [rev, save]);
  // Retry a failed save, and flush when the tab is hidden or closed.
  useEffect(() => {
    if (saveState !== "error") return;
    const t = setTimeout(() => void save(), 4000);
    return () => clearTimeout(t);
  }, [saveState, save]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void save(true);
    };
    // Leaving with unsaved edits: send them with keepalive (no "leave site?" prompt).
    const leave = () => {
      if (rev !== savedRev.current) void save(true);
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("beforeunload", leave);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("beforeunload", leave);
    };
  }, [save, rev]);

  const rename = async (next: string) => {
    const v = next.trim();
    if (!v || v === initial.name) return setName(v || initial.name);
    try {
      await saveCanvas(id, { name: v });
      void qc.invalidateQueries({ queryKey: ["canvases"], exact: true });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // ---- editing
  const update = useCallback(
    (nodeId: string, patch: Partial<CanvasNodeData>) => {
      const apply = (ns: FlowNode[]) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
      setNodes(apply);
      if ("modelId" in patch || "op" in patch || "mediaKind" in patch) setEdges((es) => pruneEdges(apply(latest.current.nodes), es));
      setRunErrors((r) => {
        if (!(nodeId in r)) return r;
        const next = { ...r };
        delete next[nodeId];
        return next;
      });
      touch();
    },
    [touch],
  );

  /** Deleted nodes come back with their edges from the toast's Undo. */
  const offerUndo = useCallback(
    (count: number, before: { nodes: FlowNode[]; edges: Edge[] }) =>
      toast(count === 1 ? "Node deleted" : `${count} nodes deleted`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            setNodes(before.nodes);
            setEdges(before.edges);
            touch();
          },
        },
      }),
    [touch],
  );

  const remove = useCallback(
    (nodeId: string) => {
      const before = latest.current;
      setNodes((ns) => ns.filter((n) => n.id !== nodeId));
      setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
      touch();
      offerUndo(1, before);
    },
    [touch, offerUndo],
  );

  const duplicate = useCallback(
    (ids: string | string[]) => {
      const list = new Set(Array.isArray(ids) ? ids : [ids]);
      const copies = latest.current.nodes
        .filter((n) => list.has(n.id))
        .map((n) => ({ ...n, id: newId(n.type ?? "node"), position: { x: n.position.x + 48, y: n.position.y + 48 }, data: { ...n.data, pinned: undefined }, selected: true }));
      if (!copies.length) return;
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...copies]);
      touch();
    },
    [touch],
  );

  const addNode = useCallback(
    (item: PaletteItem, at: { x: number; y: number }, connect?: MenuState["connect"]) => {
      const data: CanvasNodeData = { ...item.data };
      if (isGenerator({ type: item.type })) {
        const m = defaultModelForNode({ type: item.type, data }, engine) ?? defaultModelForNode({ type: item.type, data }, engine === "open" ? "cloud" : "open");
        if (m) data.modelId = m.id;
      }
      const node: FlowNode = { id: newId(item.type), type: item.type, position: snap(at), data, selected: true };
      setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), node]);
      if (connect) {
        const g = toGraph([...latest.current.nodes, node], latest.current.edges);
        const c: Connection =
          connect.from === "source"
            ? { source: connect.nodeId, sourceHandle: OUT, target: node.id, targetHandle: item.type === "output" ? PREVIEW_IN : (inputPorts(toGraph([node], []).nodes[0]).find((p) => acceptsType(p, connect.type))?.id ?? null) }
            : { source: node.id, sourceHandle: OUT, target: connect.nodeId, targetHandle: connect.handleId };
        if (c.targetHandle && !connectionError(g, c)) {
          setEdges((es) => [...(singleInput(g, c.target, c.targetHandle) ? es.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle)) : es), { id: newId("e"), ...c }]);
        }
      }
      touch();
      return node.id;
    },
    [engine, touch],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const removed = changes.filter((c) => c.type === "remove").length;
      const before = latest.current;
      setNodes((ns) => applyNodeChanges(changes, ns));
      if (changes.some((c) => c.type === "remove" || c.type === "add" || c.type === "replace" || (c.type === "position" && !c.dragging))) touch();
      if (removed) offerUndo(removed, before);
    },
    [touch, offerUndo],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type !== "select")) touch();
    },
    [touch],
  );
  const isValidConnection = useCallback((c: Connection | Edge) => !connectionError(toGraph(latest.current.nodes, latest.current.edges), c), []);
  const onConnect = useCallback(
    (c: Connection) => {
      const g = toGraph(latest.current.nodes, latest.current.edges);
      const err = connectionError(g, c);
      if (err) return void toast.error(err);
      // A single input (start frame, video, audio…) takes the new edge instead of the old one.
      setEdges((es) => [...(singleInput(g, c.target, c.targetHandle) ? es.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle)) : es), { id: newId("e"), ...c }]);
      touch();
    },
    [touch],
  );

  const openMenuAt = useCallback(
    (clientX: number, clientY: number, connect?: MenuState["connect"]) => {
      const rect = wrapper.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.min(Math.max(8, clientX - rect.left), rect.width - 264);
      const y = Math.min(Math.max(8, clientY - rect.top), rect.height - 340);
      setMenu({ x, y, flow: rf.screenToFlowPosition({ x: clientX, y: clientY }), connect });
    },
    [rf],
  );

  // A connection dropped on empty board: offer the nodes that fit, and wire the new one up.
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || state.toNode) return;
      const pt = "changedTouches" in event ? event.changedTouches[0] : event;
      const g = toGraph(latest.current.nodes, latest.current.edges);
      const from = g.nodes.find((n) => n.id === state.fromNode!.id);
      if (!from) return;
      const fromSource = state.fromHandle?.type === "source";
      const type = fromSource ? outputType(g, from) : inputPorts(from).find((p) => p.id === state.fromHandle?.id)?.type;
      if (!type) return;
      openMenuAt(pt.clientX, pt.clientY, { nodeId: from.id, handleId: state.fromHandle?.id ?? null, from: fromSource ? "source" : "target", type });
    },
    [openMenuAt],
  );

  const menuItems = useMemo(() => {
    const all = paletteItems();
    const c = menu?.connect;
    if (!c) return all;
    return all.filter((p) => {
      const data: CanvasNodeData = { ...p.data };
      const m = isGenerator({ type: p.type }) ? defaultModelForNode({ type: p.type, data }, engine) : undefined;
      if (m) data.modelId = m.id;
      const n: CanvasNode = { id: "probe", type: p.type, position: { x: 0, y: 0 }, data };
      if (c.from === "source") return p.type === "output" ? c.type !== "element" : inputPorts(n).some((port) => acceptsType(port, c.type));
      return outputType({ nodes: [n], edges: [] }, n) === c.type;
    });
  }, [menu, engine]);

  // ---- running
  const run = useCallback(
    (targets?: string[], force?: boolean) => {
      const go = (t?: string[], f?: boolean) =>
        runM.mutate(
          { targets: t, force: f, graph: toGraph(latest.current.nodes, latest.current.edges, viewport.current) },
          {
            onSuccess: (r) => {
              // The run saved the board too.
              savedRev.current = rev;
              setSaveState("saved");
              setRunErrors(Object.fromEntries((r.errors ?? []).map((e) => [e.nodeId, e.message])));
              if (!r.ok) return void toast.error(r.error ?? "Couldn't run this");
              const issues = r.errors?.length ? `${r.errors.length} node${r.errors.length > 1 ? "s" : ""} need${r.errors.length > 1 ? "" : "s"} attention` : undefined;
              if (!r.ran.length) toast("Everything's up to date", { description: issues, action: { label: "Run again", onClick: () => go(t, true) } });
              else toast.success(r.ran.length === 1 ? "Running 1 node" : `Running ${r.ran.length} nodes`, { description: issues, duration: 1800 });
            },
            onError: (e) => toast.error((e as Error).message),
          },
        );
      go(targets, force);
    },
    [runM, rev],
  );

  const cancel = useCallback(
    async (nodeId: string) => {
      const ids = (runs[nodeId]?.ids ?? []).filter((g) => {
        const s = gens.get(g)?.status;
        return s === "queued" || s === "running";
      });
      await Promise.all(ids.map((g) => fetch(`/api/generations/${g}/cancel`, { method: "POST" })));
      void qc.invalidateQueries({ queryKey: ["canvases", id] });
    },
    [runs, gens, qc, id],
  );

  const toInput = useCallback(
    (nodeId: string) => {
      const src = latest.current.nodes.find((n) => n.id === nodeId);
      const out = results.get(nodeId)?.outputs.find((x) => KIND_INPUT[x.o.kind]);
      if (!src || !out) return;
      const nid = newId("input");
      setNodes((ns) => [
        ...ns.map((n) => ({ ...n, selected: false })),
        { id: nid, type: KIND_INPUT[out.o.kind], position: snap({ x: src.position.x, y: src.position.y + (src.measured?.height ?? 360) + 48 }), data: { url: out.o.url, label: `From ${nodeLabel(toGraph([src], []).nodes[0])}` }, selected: true },
      ]);
      touch();
      toast("Added as an input — connect it anywhere");
    },
    [results, touch],
  );

  // ---- engine
  const boardEngine = graphEngine(graph) ?? engine;
  const switchEngine = (e: Engine) => {
    setEngine(e);
    const before = latest.current.nodes;
    const { graph: next, changed, missing } = convertEngine(toGraph(before, latest.current.edges), e);
    if (changed) {
      const byId = new Map(next.nodes.map((n) => [n.id, n]));
      const after = before.map((n) => ({ ...n, data: byId.get(n.id)?.data ?? n.data }));
      setNodes(after);
      setEdges((es) => pruneEdges(after, es));
      touch();
      toast.success(`Switched ${changed} node${changed > 1 ? "s" : ""} to ${e === "open" ? "open-source" : "cloud"} models`, {
        action: {
          label: "Undo",
          onClick: () => {
            setNodes(before);
            touch();
          },
        },
      });
    }
    if (missing.length) toast(`${missing.length} node${missing.length > 1 ? "s have" : " has"} no ${e === "open" ? "open-source" : "cloud"} version yet`);
  };
  const offEngine = mode === "both" ? [] : generators.filter((n) => {
    const m = n.data.modelId ? getModel(n.data.modelId) : undefined;
    return m && m.engine !== mode;
  });

  // ---- keyboard: ⌘↵ runs (the selection, else everything), ⌘D duplicates
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const sel = latest.current.nodes.filter((n) => n.selected).map((n) => n.id);
        run(sel.length ? sel : undefined, e.shiftKey);
      } else if (e.key.toLowerCase() === "d" && !(e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) {
        const sel = latest.current.nodes.filter((n) => n.selected).map((n) => n.id);
        if (!sel.length) return;
        e.preventDefault();
        duplicate(sel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, duplicate]);

  // ---- drop from the palette, or files from the desktop
  const onDragOver = (e: React.DragEvent) => {
    if (isMobile) return;
    if (e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const itemId = e.dataTransfer.getData(DRAG_TYPE);
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (itemId) {
      e.preventDefault();
      const item = paletteItems().find((p) => p.id === itemId);
      if (item) addNode(item, at);
      return;
    }
    const files = [...(e.dataTransfer.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    files.slice(0, 8).forEach((f, i) => {
      const kind: MediaKind | null = f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : null;
      if (!kind) return void toast.error(`${f.name} isn't an image, video or audio file`);
      const item = paletteItems().find((p) => p.type === KIND_INPUT[kind])!;
      const nid = addNode(item, { x: at.x + i * 32, y: at.y + i * 32 });
      void fileToSlot(f, (v) => v && !v.uploading && update(nid, { url: v.ref, name: v.name }), kind);
    });
  };

  const addAtCenter = (item: PaletteItem) => {
    const rect = wrapper.current?.getBoundingClientRect();
    const at = rf.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 140, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 100 });
    addNode(item, at);
  };

  const quickStart = () => {
    const rect = wrapper.current?.getBoundingClientRect();
    // Right of the palette, a little below the top.
    const at = rf.screenToFlowPosition({ x: (rect?.left ?? 0) + (paletteOpen ? 300 : 80), y: (rect?.top ?? 0) + 160 });
    const items = paletteItems();
    const p = addNode(items.find((i) => i.id === "prompt")!, at);
    const m = addNode(items.find((i) => i.id === "model-image")!, { x: at.x + 360, y: at.y - 40 });
    const o = addNode(items.find((i) => i.id === "output")!, { x: at.x + 720, y: at.y });
    setEdges((es) => [...es, { id: newId("e"), source: p, sourceHandle: OUT, target: m, targetHandle: "prompt" }, { id: newId("e"), source: m, sourceHandle: OUT, target: o, targetHandle: PREVIEW_IN }]);
    setTimeout(() => void rf.fitView({ ...fitOptions, duration: 300 }), 60);
  };

  // ---- edges: coloured by what they carry, animated into running nodes
  const flowEdges = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return edges.map((e) => {
      const src = byId.get(e.source);
      const t = src ? outputType(graph, src) : null;
      const r = results.get(e.target);
      const live = r?.state === "running" || r?.state === "queued";
      return { ...e, animated: live, style: { stroke: t ? PORT_COLOR[t] : undefined, strokeWidth: e.selected ? 3 : 2 } };
    });
  }, [edges, graph, results]);

  const api: EditorApi = {
    canvasId: id,
    graph,
    plan,
    describe: (nid) => descriptions.get(nid),
    results: (nid) => results.get(nid) ?? EMPTY_RESULTS,
    runErrors,
    engine,
    mode,
    readOnly: isMobile,
    running: runM.isPending,
    isDemo,
    update,
    remove,
    duplicate,
    run,
    cancel: (nid) => void cancel(nid),
    open: (nid, index = 0) => setViewer({ nodeId: nid, index }),
    toInput,
  };

  const viewerEntries = viewer ? (results.get(viewer.nodeId)?.outputs ?? []) : [];
  const entry = viewer ? viewerEntries[viewer.index] : undefined;
  const planDemo = plan.steps.some((s) => {
    const m = getModel(s.request.modelId);
    return m && isDemo(m);
  });
  const attention = new Set(plan.errors.map((e) => e.nodeId)).size;
  const summary = [
    plan.steps.length
      ? `${plan.steps.length} to run · ${planDemo ? "Demo · free" : plan.costUnknown ? "price unknown" : plan.costUsd === 0 ? "Free" : `≈ ${formatCost(plan.costUsd)}`}`
      : generators.length && !attention
        ? "Up to date"
        : "",
    attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <EditorContext.Provider value={api}>
      <div className="fuobe-canvas flex h-svh min-w-0 flex-col md:h-[calc(100svh-0.5rem)]">
        <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-4">
          <SidebarTrigger className="md:hidden" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/canvas" className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="All canvases">
                <ChevronLeft className="size-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>All canvases</TooltipContent>
          </Tooltip>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            maxLength={80}
            aria-label="Canvas name"
            className="h-9 w-0 min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 font-heading text-[20px] leading-none outline-none hover:bg-accent focus:bg-muted sm:max-w-[320px] sm:flex-none sm:w-[min(320px,30vw)]"
          />
          <span className="hidden shrink-0 items-center gap-1 text-[12px] text-muted-foreground sm:inline-flex" aria-live="polite">
            {saveState === "saving" ? <Loader2 className="size-3 animate-spin" /> : saveState === "error" ? <TriangleAlert className="size-3 text-warning" /> : <Check className="size-3" />}
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved — retrying" : "Saved"}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {busy > 0 && (
              <span className="hidden items-center gap-1.5 text-[12px] font-medium text-brand-text lg:inline-flex">
                <Loader2 className="size-3.5 animate-spin" /> {busy} running
              </span>
            )}
            {summary && <span className="hidden font-mono text-[12px] text-muted-foreground lg:inline">{summary}</span>}
            <div className="hidden md:block">
              <EngineSwitch value={boardEngine} onChange={switchEngine} size="sm" />
            </div>
            {selected.length > 0 && !isMobile && (
              <Button variant="secondary" size="sm" className="h-8 rounded-full px-3" onClick={() => run(selected)} disabled={runM.isPending}>
                <Play /> Run selected <span className="font-mono text-muted-foreground">{selected.length}</span>
              </Button>
            )}
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" className="h-8 rounded-l-full rounded-r-none pr-2.5 pl-3.5" onClick={() => run()} disabled={runM.isPending || !generators.length}>
                    {runM.isPending ? <Loader2 className="animate-spin" /> : <Play />} Run all
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Run every node that changed <Kbd>⌘</Kbd>
                  <Kbd>↵</Kbd>
                </TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="h-8 rounded-l-none rounded-r-full border-l border-primary-foreground/20 px-2" aria-label="More run options" disabled={!generators.length}>
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem onSelect={() => run()}>
                    <Play /> Run all <span className="ml-auto text-[11px] text-muted-foreground">changed nodes</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => run(undefined, true)}>
                    <RotateCcw /> Re-run everything
                  </DropdownMenuItem>
                  {selected.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => run(selected)}>
                        <Play /> Run selected ({selected.length})
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => run(selected, true)}>
                        <RotateCcw /> Re-run selected
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={mode === "cloud"} onSelect={() => switchEngine("open")}>
                    <Cpu /> Switch all to open source
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={mode === "open"} onSelect={() => switchEngine("cloud")}>
                    <Cloud /> Switch all to cloud
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {isMobile && (
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
            <div className="inline-grid h-9 grid-cols-2 rounded-full bg-muted p-0.5 text-[13px] font-medium" role="tablist" aria-label="View">
              {(["board", "list"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5", tab === t ? "bg-background shadow-soft" : "text-muted-foreground")}>
                  {t === "board" ? <LayoutGrid className="size-3.5" /> : <List className="size-3.5" />}
                  {t === "board" ? "Board" : "Nodes"}
                </button>
              ))}
            </div>
            <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{busy ? `${busy} running` : summary}</span>
          </div>
        )}

        {offEngine.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-highlight/20 px-4 py-2 text-[13px]">
            <TriangleAlert className="size-4 shrink-0 text-warning" />
            <span className="min-w-0 flex-1">
              {offEngine.length} node{offEngine.length > 1 ? "s use" : " uses"} {mode === "open" ? "cloud" : "open-source"} models, but this install is set to {mode === "open" ? "open source only" : "cloud only"}.
            </span>
            <Button size="sm" variant="secondary" className="h-7 rounded-full" onClick={() => switchEngine(mode as Engine)}>
              Switch {offEngine.length > 1 ? "them" : "it"}
            </Button>
          </div>
        )}

        {isMobile && tab === "list" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NodeList />
          </div>
        ) : (
          <div
            ref={wrapper}
            className="relative min-h-0 flex-1"
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDoubleClick={(e) => {
              if (isMobile || !(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
              openMenuAt(e.clientX, e.clientY);
            }}
          >
            <ReactFlow<FlowNode, Edge>
              nodes={nodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              onPaneContextMenu={(e) => {
                e.preventDefault();
                if (!isMobile) openMenuAt(e.clientX, e.clientY);
              }}
              onPaneClick={() => setMenu(null)}
              onMoveEnd={(_, vp) => {
                // The phone's fitted view isn't saved over the desktop one.
                if (isMobile) return;
                viewport.current = vp;
                touch();
              }}
              defaultViewport={savedViewport}
              fitViewOptions={fitOptions}
              minZoom={0.15}
              maxZoom={2}
              snapToGrid
              snapGrid={GRID}
              zoomOnDoubleClick={false}
              deleteKeyCode={isMobile ? null : ["Backspace", "Delete"]}
              multiSelectionKeyCode={["Meta", "Shift", "Control"]}
              nodesDraggable={!isMobile}
              nodesConnectable={!isMobile}
              connectionRadius={28}
              colorMode={resolvedTheme === "dark" ? "dark" : "light"}
              attributionPosition="top-right"
              aria-label="Canvas board"
            >
              <Background variant={BackgroundVariant.Dots} gap={GRID[0] * 1.5} size={1.4} />
              <Controls position="bottom-left" showInteractive={false} className="canvas-controls" />
              {!isMobile && (
                <MiniMap
                  position="bottom-right"
                  pannable
                  zoomable
                  ariaLabel="Mini map"
                  nodeBorderRadius={6}
                  nodeColor={(n) => {
                    const g = graph.nodes.find((x) => x.id === n.id);
                    const t = g ? outputType(graph, g) : null;
                    return t ? PORT_COLOR[t] : "var(--muted-foreground)";
                  }}
                />
              )}
              {!isMobile && (
                <Panel position="top-left" className="m-3! flex max-h-[calc(100%-7rem)] flex-col">
                  {paletteOpen ? <Palette items={paletteItems()} onAdd={addAtCenter} onClose={() => setPaletteOpen(false)} /> : <PaletteToggle onOpen={() => setPaletteOpen(true)} />}
                </Panel>
              )}
            </ReactFlow>

            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
                <div className="pointer-events-auto max-w-md text-center">
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Build freely. Automate visually.</p>
                  <h2 className="mt-2 font-heading text-[28px] leading-tight text-balance">Wire models together, run them in order</h2>
                  <p className="mt-2 text-[14px] text-muted-foreground">
                    {isMobile ? "Open this canvas on a larger screen to add nodes, or start from a template." : "Double-click or right-click anywhere to add a node, or drag one in from the palette."}
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {!isMobile && (
                      <Button className="rounded-full" onClick={quickStart}>
                        <Sparkles /> Start with Text → Image
                      </Button>
                    )}
                    <Button variant="secondary" className="rounded-full" asChild>
                      <Link href="/canvas?tab=templates">Browse templates</Link>
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {menu && (
              <AddMenu
                x={menu.x}
                y={menu.y}
                items={menuItems}
                title={menu.connect ? (menu.connect.from === "source" ? `Send this ${menu.connect.type} to…` : `Make the ${menu.connect.type} with…`) : undefined}
                onPick={(p) => {
                  addNode(p, menu.flow, menu.connect);
                  setMenu(null);
                }}
                onClose={() => setMenu(null)}
              />
            )}
          </div>
        )}
      </div>
      {entry && (
        <Viewer
          generation={entry.g}
          index={entry.i}
          onClose={() => setViewer(null)}
          onPrev={viewer!.index > 0 ? () => setViewer({ ...viewer!, index: viewer!.index - 1 }) : undefined}
          onNext={viewer!.index < viewerEntries.length - 1 ? () => setViewer({ ...viewer!, index: viewer!.index + 1 }) : undefined}
        />
      )}
    </EditorContext.Provider>
  );
}
