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
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorState, NotFoundState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { fileToSlot } from "@/components/studio/media-slot";
import { Viewer } from "@/components/studio/viewer";
import { useIsMobile } from "@/hooks/use-mobile";
import { useElements, useEngine, useStatus, type EngineMode } from "@/lib/api";
import { getModel } from "@/lib/catalog";
import {
  acceptsType,
  cleanGraph,
  connectionError,
  convertEngine,
  counterpart,
  defaultModelForNode,
  describeNode,
  elementUpdates,
  EMPTY_GRAPH,
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
  type PaletteItem,
  type PortType,
} from "@/lib/catalog/canvas";
import type { Engine, MediaKind, ModelDef } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { useModKey } from "@/lib/keys";
import { cn } from "@/lib/utils";
import {
  buildViews,
  DescribeCache,
  EditorActionsContext,
  EditorStore,
  EditorStoreContext,
  foldResultsKeep,
  PORT_COLOR,
  type EditorActions,
  type EditorGlobals,
  type EditorSnapshot,
  type NodeResults,
} from "./canvas-context";
import { NodeList } from "./node-list";
import { NODE_TYPES, type FlowNode } from "./nodes";
import { AddMenu, DRAG_TYPE, Palette, PaletteToggle } from "./palette";
import { saveCanvas, useCanvasView, useRunCanvas, type CanvasView } from "./use-canvas";

const GRID: [number, number] = [16, 16];
const snap = (p: { x: number; y: number }) => ({ x: Math.round(p.x / GRID[0]) * GRID[0], y: Math.round(p.y / GRID[1]) * GRID[1] });

/** Palette width plus its margin: the board's fit leaves this side free while the palette is open. */
const PALETTE_SPACE = 292;
/** Below this zoom a board's text is too small to read with the palette open: the first fit hides the palette instead. */
const READABLE_ZOOM = 0.5;

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

/** What a node's output handle carries (no graph walk: the node alone decides). */
const typeOfNode = (n: Pick<FlowNode, "id" | "type" | "data">): PortType | null => outputType(EMPTY_GRAPH, { id: n.id, type: n.type as CanvasNode["type"], data: n.data, position: { x: 0, y: 0 } });

const KIND_INPUT: Record<string, CanvasNode["type"]> = { image: "image-input", video: "video-input", audio: "audio-input" };

// ---------------------------------------------------------------------------

export function CanvasEditor({ id }: { id: string }) {
  const view = useCanvasView(id);
  if (view.isLoading) return <EditorSkeleton />;
  if (!view.data) {
    // A canvas that isn't there gets the shared 404 state; a request that failed otherwise can be retried.
    if (view.error && (view.error as { status?: number }).status !== 404) return <ErrorState error={view.error} retry={() => void view.refetch()} />;
    return <NotFoundState title="This canvas isn’t here">It may have been deleted. Its results are still in your library.</NotFoundState>;
  }
  return (
    <ReactFlowProvider>
      <Editor key={id} id={id} initial={view.data.canvas} view={view.data} />
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
  const runMutate = runM.mutate;

  const [nodes, setNodes] = useState<FlowNode[]>(() => initial.graph.nodes.map(toFlowNode));
  const [edges, setEdges] = useState<Edge[]>(() => initial.graph.edges.map(toFlowEdge));
  const [name, setName] = useState(initial.name);
  const [tab, setTab] = useState<"board" | "list">("board");
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [viewer, setViewer] = useState<{ nodeId: string; index: number } | null>(null);
  const [runErrors, setRunErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>("saved");
  /** A save the server refused (a 4xx): retrying won't help, the next edit tries again. */
  const [saveRefused, setSaveRefused] = useState(false);
  const [rev, setRev] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | undefined>(initial.graph.viewport);
  const savedRev = useRef(0);
  const savedName = useRef(initial.name);

  // Latest state for event handlers and the save on leave (synced right after each commit).
  const latest = useRef({ nodes, edges, rev });
  useLayoutEffect(() => {
    latest.current = { nodes, edges, rev };
  }, [nodes, edges, rev]);

  const touch = useCallback(() => setRev((r) => r + 1), []);

  // ---- derived: graph, plan, results, and the per-node views the nodes subscribe to
  const [store] = useState(() => new EditorStore());
  const prev = store.peek();
  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const planned = useDeferredValue(graph);
  const runs = view.canvas.runs;
  const gens = useMemo(() => new Map(view.generations.map((g) => [g.id, g])), [view.generations]);
  const statusOf = useCallback((gid: string) => gens.get(gid)?.status, [gens]);
  // Described again only where a node or its inputs changed (one keystroke touches one prompt's consumers).
  const [describer] = useState(() => new DescribeCache());
  const described = useMemo(() => describer.run(planned, mode), [describer, planned, mode]);
  const plan = useMemo(
    () => planCanvas(planned, { runs, status: statusOf, engineMode: mode, describe: (n) => described.get(n.id)?.d ?? describeNode(planned, n, { engineMode: mode }) }),
    [planned, runs, statusOf, mode, described],
  );
  const results = useMemo(() => {
    const m = new Map<string, NodeResults>();
    for (const [nodeId, r] of Object.entries(runs)) {
      const list = r.ids.map((g) => gens.get(g)).filter((g): g is NonNullable<typeof g> => !!g);
      m.set(nodeId, foldResultsKeep(prev?.views.get(nodeId)?.results, list));
    }
    return m;
    // `prev` only lends unchanged objects (identity), it isn't an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, gens]);
  const views = useMemo(
    () =>
      buildViews(
        prev?.views ?? null,
        planned,
        plan,
        (nid) => described.get(nid)?.d,
        results,
        runErrors,
        (n) => described.get(n.id)?.op,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planned, plan, described, results, runErrors],
  );
  const selected = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const busy = [...results.values()].filter((r) => r.state === "running" || r.state === "queued").length;
  const generators = graph.nodes.filter(isGenerator);

  const isDemo = useCallback(
    (m: ModelDef) => {
      if (!status) return false;
      if (status.demoMode === "on") return true;
      if (status.demoMode === "off") return false;
      return !m.routes.some((r) => status.providers[r.provider]?.configured);
    },
    [status],
  );
  const globals = useMemo<EditorGlobals>(() => ({ canvasId: id, engine, mode, readOnly: isMobile, running: runM.isPending, isDemo }), [id, engine, mode, isMobile, runM.isPending, isDemo]);
  const snapshot = useMemo<EditorSnapshot>(() => ({ graph, byId, plan, views, globals }), [graph, byId, plan, views, globals]);
  store.prime(snapshot);
  useLayoutEffect(() => store.set(snapshot), [store, snapshot]);

  // Fit around the nodes, leaving the palette's side free.
  const fitFor = useCallback(
    (withPalette: boolean): FitViewOptions<FlowNode> => ({
      padding: { top: "56px", right: "56px", bottom: "56px", left: withPalette && !isMobile ? `${PALETTE_SPACE}px` : isMobile ? "16px" : "56px" },
      maxZoom: 1,
      minZoom: isMobile ? 0.3 : 0.5,
    }),
    [isMobile],
  );
  const fitOptions = useMemo(() => fitFor(paletteOpen), [fitFor, paletteOpen]);
  // Phones always start fitted (a viewport saved on a big screen would show an empty board).
  const savedViewport = isMobile ? undefined : initial.graph.viewport;
  // The first fit, once every node has its size: a big board may zoom further out than later fits,
  // and when it would be too small to read beside the palette, the palette folds away instead.
  const initialized = useNodesInitialized();
  const fitted = useRef(false);
  useEffect(() => {
    if (!initialized || fitted.current) return;
    fitted.current = true;
    if (savedViewport || !latest.current.nodes.length) return;
    const frame = requestAnimationFrame(() => {
      const rect = wrapper.current?.getBoundingClientRect();
      let withPalette = paletteOpen && !isMobile;
      if (withPalette && rect) {
        const b = rf.getNodesBounds(latest.current.nodes);
        const zoom = Math.min((rect.width - PALETTE_SPACE - 56) / Math.max(1, b.width), (rect.height - 112) / Math.max(1, b.height));
        if (zoom < READABLE_ZOOM) {
          withPalette = false;
          setPaletteOpen(false);
        }
      }
      void rf.fitView({ ...fitFor(withPalette), minZoom: isMobile ? 0.15 : 0.3 });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialized, savedViewport, rf, fitFor, paletteOpen, isMobile]);

  // ---- autosave
  const save = useCallback(
    async (keepalive = false) => {
      const at = latest.current.rev;
      if (at === savedRev.current) return;
      setSaveState("saving");
      try {
        await saveCanvas(id, { graph: toGraph(latest.current.nodes, latest.current.edges, viewport.current) }, keepalive);
        savedRev.current = Math.max(savedRev.current, at);
        setSaveState("saved");
        setSaveRefused(false);
        void qc.invalidateQueries({ queryKey: ["canvases"], exact: true });
      } catch (e) {
        setSaveState("error");
        const code = (e as { status?: number }).status;
        if (code && code >= 400 && code < 500) {
          // Retrying the same board won't help: say what's wrong (the server names the node).
          setSaveRefused(true);
          toast.error((e as Error).message, { id: `canvas-save-${id}` });
        }
      }
    },
    [id, qc],
  );
  useEffect(() => {
    if (rev === 0) return;
    const t = setTimeout(() => void save(), 700);
    return () => clearTimeout(t);
  }, [rev, save]);
  // Retry a failed save (a network blip, a restart), and flush when the tab is hidden or closed.
  useEffect(() => {
    if (saveState !== "error" || saveRefused) return;
    const t = setTimeout(() => void save(), 4000);
    return () => clearTimeout(t);
  }, [saveState, saveRefused, save]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void save(true);
    };
    // Leaving with unsaved edits: send them with keepalive (no "leave site?" prompt).
    const leave = () => void save(true);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("beforeunload", leave);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("beforeunload", leave);
    };
  }, [save]);
  // Leaving through an in-app link (the page unmounts, or Next hides it): send what the debounce still holds.
  const flushOnLeave = useCallback(() => {
    const at = latest.current.rev;
    if (at === savedRev.current) return;
    savedRev.current = at;
    void saveCanvas(id, { graph: toGraph(latest.current.nodes, latest.current.edges, viewport.current) }, true)
      .then(() => qc.invalidateQueries({ queryKey: ["canvases"], exact: true }))
      .catch(() => {
        // Not saved after all: the next edit (or the next visit) saves again.
        savedRev.current = -1;
      });
  }, [id, qc]);
  useEffect(() => flushOnLeave, [flushOnLeave]);

  const rename = async (next: string) => {
    const v = next.trim();
    if (!v) return setName(savedName.current);
    if (v === savedName.current) return;
    try {
      await saveCanvas(id, { name: v });
      savedName.current = v;
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

  // An element renamed (or given a new photo) while the board is open: its nodes follow, and the board saves.
  const elements = useElements().data;
  useEffect(() => {
    if (!elements) return;
    const updates = elementUpdates(toGraph(latest.current.nodes, latest.current.edges), elements);
    if (!updates.size) return;
    setNodes((ns) => ns.map((n) => (updates.has(n.id) ? { ...n, data: { ...n.data, ...updates.get(n.id) } } : n)));
    touch();
  }, [elements, touch]);

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

  /** Copies of the nodes, wired to each other the way the originals are. */
  const duplicate = useCallback(
    (ids: string | string[]) => {
      const list = new Set(Array.isArray(ids) ? ids : [ids]);
      const map = new Map<string, string>();
      const copies = latest.current.nodes
        .filter((n) => list.has(n.id))
        .map((n) => {
          const nid = newId(n.type ?? "node");
          map.set(n.id, nid);
          return { ...n, id: nid, position: { x: n.position.x + 48, y: n.position.y + 48 }, data: { ...n.data, pinned: undefined }, selected: true };
        });
      if (!copies.length) return;
      const wires = latest.current.edges
        .filter((e) => map.has(e.source) && map.has(e.target))
        .map((e) => ({ ...e, id: newId("e"), source: map.get(e.source)!, target: map.get(e.target)!, selected: false }));
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...copies]);
      if (wires.length) setEdges((es) => [...es, ...wires]);
      touch();
    },
    [touch],
  );

  const addNode = useCallback(
    (item: PaletteItem, at: { x: number; y: number }, connect?: MenuState["connect"]) => {
      if (item.disabled) return void toast(item.disabled);
      const data: CanvasNodeData = { ...item.data };
      if (isGenerator({ type: item.type })) {
        // An install locked to one engine never gets a node on the other.
        const m = defaultModelForNode({ type: item.type, data }, engine) ?? (mode === "both" ? defaultModelForNode({ type: item.type, data }, engine === "open" ? "cloud" : "open") : undefined);
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
    [engine, mode, touch],
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
  const disconnect = useCallback(
    (edgeId: string) => {
      setEdges((es) => es.filter((e) => e.id !== edgeId));
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

  const palette = useMemo(() => paletteItems(mode), [mode]);
  const menuItems = useMemo(() => {
    const c = menu?.connect;
    if (!c) return palette;
    return palette.filter((p) => {
      const data: CanvasNodeData = { ...p.data };
      const m = isGenerator({ type: p.type }) ? defaultModelForNode({ type: p.type, data }, engine) : undefined;
      if (m) data.modelId = m.id;
      const n: CanvasNode = { id: "probe", type: p.type, position: { x: 0, y: 0 }, data };
      if (c.from === "source") return p.type === "output" ? c.type !== "element" : inputPorts(n).some((port) => acceptsType(port, c.type));
      return outputType({ nodes: [n], edges: [] }, n) === c.type;
    });
  }, [menu, engine, palette]);

  // ---- running
  const run = useCallback(
    (targets?: string[], force?: boolean) => {
      const go = (t?: string[], f?: boolean) => {
        const at = latest.current.rev;
        runMutate(
          { targets: t, force: f, graph: toGraph(latest.current.nodes, latest.current.edges, viewport.current) },
          {
            onSuccess: (r) => {
              // The run saved the board too.
              savedRev.current = Math.max(savedRev.current, at);
              if (latest.current.rev === savedRev.current) setSaveState("saved");
              setRunErrors(Object.fromEntries((r.errors ?? []).map((e) => [e.nodeId, e.message])));
              if (!r.ok) return void toast.error(r.error ?? "Couldn't run this");
              const issues = r.errors?.length ? `${r.errors.length} node${r.errors.length > 1 ? "s" : ""} need${r.errors.length > 1 ? "" : "s"} attention` : undefined;
              if (!r.ran.length) toast("Everything's up to date", { description: issues, action: { label: "Run again", onClick: () => go(t, true) } });
              else toast.success(r.ran.length === 1 ? "Running 1 node" : `Running ${r.ran.length} nodes`, { description: issues, duration: 1800 });
            },
            onError: (e) => toast.error((e as Error).message),
          },
        );
      };
      go(targets, force);
    },
    [runMutate],
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

  const toInput = (nodeId: string) => {
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
  };

  // ---- engine
  const boardEngine = graphEngine(graph) ?? engine;
  const switchEngine = (e: Engine) => {
    setEngine(e);
    const before = latest.current;
    const { graph: next, changed, missing } = convertEngine(toGraph(before.nodes, before.edges), e);
    if (changed) {
      const byNode = new Map(next.nodes.map((n) => [n.id, n]));
      const after = before.nodes.map((n) => ({ ...n, data: byNode.get(n.id)?.data ?? n.data }));
      setNodes(after);
      setEdges((es) => pruneEdges(after, es));
      touch();
      toast.success(`Switched ${changed} node${changed > 1 ? "s" : ""} to ${e === "open" ? "open-source" : "cloud"} models`, {
        action: {
          label: "Undo",
          onClick: () => {
            // The switch may have dropped edges into inputs the new models don't have: they come back too.
            setNodes(before.nodes);
            setEdges(before.edges);
            touch();
          },
        },
      });
    }
    if (missing.length) toast(`${missing.length} node${missing.length > 1 ? "s have" : " has"} no ${e === "open" ? "open-source" : "cloud"} version yet`);
  };
  const offEngine =
    mode === "both"
      ? []
      : generators.filter((n) => {
          const m = n.data.modelId ? getModel(n.data.modelId) : undefined;
          return m && m.engine !== mode;
        });
  const stuck = offEngine.filter((n) => !counterpart(graph, n, mode as Engine));
  const switchable = offEngine.length - stuck.length;

  // ---- the actions nodes call: one object for the editor's lifetime, always reaching the latest handlers
  const handlers = useRef<EditorActions | null>(null);
  useLayoutEffect(() => {
    handlers.current = {
      update,
      remove,
      duplicate,
      run,
      cancel: (nid) => void cancel(nid),
      open: (nid, index = 0) => setViewer({ nodeId: nid, index }),
      toInput,
      connect: (c) => onConnect({ source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? OUT, targetHandle: c.targetHandle ?? null }),
      disconnect,
      getGraph: () => toGraph(latest.current.nodes, latest.current.edges),
    };
  });
  const actions = useMemo<EditorActions>(
    () => ({
      update: (...a) => handlers.current!.update(...a),
      remove: (...a) => handlers.current!.remove(...a),
      duplicate: (...a) => handlers.current!.duplicate(...a),
      run: (...a) => handlers.current!.run(...a),
      cancel: (...a) => handlers.current!.cancel(...a),
      open: (...a) => handlers.current!.open(...a),
      toInput: (...a) => handlers.current!.toInput(...a),
      connect: (...a) => handlers.current!.connect(...a),
      disconnect: (...a) => handlers.current!.disconnect(...a),
      getGraph: () => handlers.current!.getGraph(),
    }),
    [],
  );

  // ---- keyboard: ⌘↵ runs (the selection, else everything), ⌘D duplicates
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const sel = latest.current.nodes.filter((n) => n.selected).map((n) => n.id);
        actions.run(sel.length ? sel : undefined, e.shiftKey);
      } else if (e.key.toLowerCase() === "d" && !(e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) {
        const sel = latest.current.nodes.filter((n) => n.selected).map((n) => n.id);
        if (!sel.length) return;
        e.preventDefault();
        duplicate(sel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, duplicate]);

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
      const item = palette.find((p) => p.id === itemId);
      if (item) addNode(item, at);
      return;
    }
    const files = [...(e.dataTransfer.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    files.slice(0, 8).forEach((f, i) => {
      const kind: MediaKind | null = f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : null;
      if (!kind) return void toast.error(`${f.name} isn't an image, video or audio file`);
      const item = palette.find((p) => p.type === KIND_INPUT[kind])!;
      const nid = addNode(item, { x: at.x + i * 32, y: at.y + i * 32 });
      if (nid) void fileToSlot(f, (v) => v && !v.uploading && update(nid, { url: v.ref, name: v.name }), kind);
    });
  };

  const addAtCenter = (item: PaletteItem) => {
    const rect = wrapper.current?.getBoundingClientRect();
    const at = rf.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 140, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 100 });
    addNode(item, at);
  };

  /** Text prompt → image model → Output, wired (no dragging needed, so phones get it too). */
  const quickStart = () => {
    const rect = wrapper.current?.getBoundingClientRect();
    // Right of the palette, a little below the top.
    const at = rf.screenToFlowPosition({ x: (rect?.left ?? 0) + (isMobile ? 16 : paletteOpen ? 300 : 80), y: (rect?.top ?? 0) + 160 });
    const items = paletteItems();
    const p = addNode(items.find((i) => i.id === "prompt")!, at);
    const m = addNode(items.find((i) => i.id === "model-image")!, { x: at.x + 360, y: at.y - 40 });
    const o = addNode(items.find((i) => i.id === "output")!, { x: at.x + 720, y: at.y });
    if (!p || !m || !o) return;
    setEdges((es) => [...es, { id: newId("e"), source: p, sourceHandle: OUT, target: m, targetHandle: "prompt" }, { id: newId("e"), source: m, sourceHandle: OUT, target: o, targetHandle: PREVIEW_IN }]);
    setTimeout(() => void rf.fitView({ ...fitOptions, duration: 300 }), 60);
  };

  // ---- edges: coloured by what they carry, animated into running nodes. Rebuilt only when that
  // look changes (not on every keystroke), so React Flow doesn't re-render every edge.
  const edgeLook = edges
    .map((e) => {
      const src = byId.get(e.source);
      const r = results.get(e.target);
      return `${e.id}:${src ? typeOfNode(src) : ""}:${r?.state === "running" || r?.state === "queued" ? 1 : 0}`;
    })
    .join("|");
  const flowEdges = useMemo(
    () =>
      edges.map((e) => {
        const src = byId.get(e.source);
        const t = src ? typeOfNode(src) : null;
        const r = results.get(e.target);
        const live = r?.state === "running" || r?.state === "queued";
        return { ...e, animated: live, style: { stroke: t ? PORT_COLOR[t] : undefined, strokeWidth: e.selected ? 3 : 2 } };
      }),
    // byId and results are read through edgeLook (what the edges show of them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edges, edgeLook],
  );
  const miniColor = useCallback((n: FlowNode) => {
    const t = typeOfNode(n);
    return t ? PORT_COLOR[t] : "var(--muted-foreground)";
  }, []);

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

  // ---- what the header and the palette call: stable, so they skip the re-render a keystroke causes
  const uiHandlers = useRef<{ run: typeof run; switchEngine: typeof switchEngine; rename: typeof rename; addAtCenter: typeof addAtCenter } | null>(null);
  useLayoutEffect(() => {
    uiHandlers.current = { run, switchEngine, rename, addAtCenter };
  });
  const ui = useMemo<HeaderUi>(
    () => ({
      run: (targets, force) => uiHandlers.current!.run(targets, force),
      runSelected: (force) => uiHandlers.current!.run(latest.current.nodes.filter((n) => n.selected).map((n) => n.id), force),
      switchEngine: (e) => uiHandlers.current!.switchEngine(e),
      rename: (v) => void uiHandlers.current!.rename(v),
      addAtCenter: (p) => uiHandlers.current!.addAtCenter(p),
    }),
    [],
  );
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const otherEngineName = mode === "open" ? "cloud" : "open-source";
  const stuckNames = stuck.map((n) => `“${nodeLabel(n)}”`);

  return (
    <EditorStoreContext.Provider value={store}>
      <EditorActionsContext.Provider value={actions}>
        <div className="fuobe-canvas flex h-svh min-w-0 flex-col md:h-[calc(100svh-0.5rem)]">
          <EditorHeader
            name={name}
            setName={setName}
            saveState={saveState}
            saveRefused={saveRefused}
            busy={busy}
            summary={summary}
            boardEngine={boardEngine}
            selectedCount={isMobile ? 0 : selected.length}
            running={runM.isPending}
            canRun={generators.length > 0}
            mode={mode}
            ui={ui}
          />

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
                {offEngine.length} node{offEngine.length > 1 ? "s use" : " uses"} {otherEngineName} models, but this install is set to {mode === "open" ? "open source only" : "cloud only"}.
                {stuck.length > 0 && (
                  <>
                    {" "}
                    {stuckNames.join(", ")} {stuck.length > 1 ? "have" : "has"} no {mode === "open" ? "open-source" : "cloud"} version yet: remove {stuck.length > 1 ? "them" : "it"}, or change Settings → Engine mode.
                  </>
                )}
              </span>
              {switchable > 0 && (
                <Button size="sm" variant="secondary" className="h-7 rounded-full" onClick={() => switchEngine(mode as Engine)}>
                  Switch {switchable > 1 ? `${switchable} nodes` : stuck.length ? "the other" : "it"}
                </Button>
              )}
            </div>
          )}

          {isMobile && tab === "list" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NodeList
                onQuickStart={() => {
                  setTab("board");
                  setTimeout(quickStart, 0);
                }}
              />
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
                // Tab goes node to node (each node's menu connects and disconnects from the keyboard).
                edgesFocusable={false}
                connectionRadius={28}
                colorMode={resolvedTheme === "dark" ? "dark" : "light"}
                attributionPosition="top-right"
                aria-label="Canvas board"
              >
                <Background variant={BackgroundVariant.Dots} gap={GRID[0] * 1.5} size={1.4} />
                <Controls position="bottom-left" showInteractive={false} className="canvas-controls" fitViewOptions={fitOptions} />
                {!isMobile && <MiniMap position="bottom-right" pannable zoomable ariaLabel="Mini map" nodeBorderRadius={6} nodeColor={miniColor} />}
                {!isMobile && (
                  <Panel position="top-left" className="m-3! flex max-h-[calc(100%-7rem)] flex-col">
                    {paletteOpen ? <Palette items={palette} onAdd={ui.addAtCenter} onClose={closePalette} /> : <PaletteToggle onOpen={() => setPaletteOpen(true)} />}
                  </Panel>
                )}
              </ReactFlow>

              {nodes.length === 0 && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
                  <div className="pointer-events-auto max-w-md text-center">
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Build freely. Automate visually.</p>
                    <h2 className="mt-2 font-heading text-[28px] leading-tight text-balance">Wire models together, run them in order</h2>
                    <p className="mt-2 text-[14px] text-muted-foreground">
                      {isMobile
                        ? "Start with a ready-made chain or a template, then edit each node from the Nodes tab. Wiring new nodes takes a larger screen."
                        : "Double-click or right-click anywhere to add a node, or drag one in from the palette."}
                    </p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      <Button className="rounded-full" onClick={quickStart}>
                        <Sparkles /> Start with Text → Image
                      </Button>
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
      </EditorActionsContext.Provider>
    </EditorStoreContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Header: name, save state, plan summary, engine, Run. Memoized with stable handlers, so typing on
// the board doesn't re-render its menus and tooltips.

interface HeaderUi {
  run: (targets?: string[], force?: boolean) => void;
  runSelected: (force?: boolean) => void;
  switchEngine: (e: Engine) => void;
  rename: (name: string) => void;
  addAtCenter: (p: PaletteItem) => void;
}

const EditorHeader = memo(function EditorHeader({
  name,
  setName,
  saveState,
  saveRefused,
  busy,
  summary,
  boardEngine,
  selectedCount,
  running,
  canRun,
  mode,
  ui,
}: {
  name: string;
  setName: (v: string) => void;
  saveState: SaveState;
  saveRefused: boolean;
  busy: number;
  summary: string;
  boardEngine: Engine;
  selectedCount: number;
  running: boolean;
  canRun: boolean;
  mode: EngineMode;
  ui: HeaderUi;
}) {
  const mod = useModKey();
  return (
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
        onBlur={(e) => ui.rename(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={80}
        aria-label="Canvas name"
        className="h-9 w-0 min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 font-heading text-[20px] leading-none outline-none hover:bg-accent focus:bg-muted sm:max-w-[320px] sm:flex-none sm:w-[min(320px,30vw)]"
      />
      <span className={cn("shrink-0 items-center gap-1 text-[12px] text-muted-foreground", saveState === "error" ? "inline-flex" : "hidden sm:inline-flex")} aria-live="polite">
        {saveState === "saving" ? <Loader2 className="size-3 animate-spin" /> : saveState === "error" ? <TriangleAlert className="size-3 text-warning" /> : <Check className="size-3" />}
        <span className={cn(saveState === "error" && "max-sm:sr-only")}>{saveState === "saving" ? "Saving…" : saveState === "error" ? (saveRefused ? "Not saved" : "Not saved — retrying") : "Saved"}</span>
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {busy > 0 && (
          <span className="hidden items-center gap-1.5 text-[12px] font-medium text-brand-text lg:inline-flex">
            <Loader2 className="size-3.5 animate-spin" /> {busy} running
          </span>
        )}
        {summary && <span className="hidden font-mono text-[12px] text-muted-foreground lg:inline">{summary}</span>}
        <div className="hidden md:block">
          <EngineSwitch value={boardEngine} onChange={ui.switchEngine} size="sm" />
        </div>
        {selectedCount > 0 && (
          <Button variant="secondary" size="sm" className="h-8 rounded-full px-3" onClick={() => ui.runSelected()} disabled={running}>
            <Play /> Run selected <span className="font-mono text-muted-foreground">{selectedCount}</span>
          </Button>
        )}
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" className="h-8 rounded-l-full rounded-r-none pr-2.5 pl-3.5" onClick={() => ui.run()} disabled={running || !canRun}>
                {running ? <Loader2 className="animate-spin" /> : <Play />} Run all
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Run every node that changed <Kbd>{mod}</Kbd>
              <Kbd>↵</Kbd>
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-8 rounded-l-none rounded-r-full border-l border-primary-foreground/20 px-2" aria-label="More run options" disabled={!canRun}>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => ui.run()}>
                <Play /> Run all <span className="ml-auto text-[11px] text-muted-foreground">changed nodes</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => ui.run(undefined, true)}>
                <RotateCcw /> Re-run everything
              </DropdownMenuItem>
              {selectedCount > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => ui.runSelected()}>
                    <Play /> Run selected ({selectedCount})
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => ui.runSelected(true)}>
                    <RotateCcw /> Re-run selected
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={mode === "cloud"} onSelect={() => ui.switchEngine("open")}>
                <Cpu /> Switch all to open source
              </DropdownMenuItem>
              <DropdownMenuItem disabled={mode === "open"} onSelect={() => ui.switchEngine("cloud")}>
                <Cloud /> Switch all to cloud
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
});
