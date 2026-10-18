"use client";

import { Check, Loader2, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorState, NotFoundState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CompareSlider } from "@/components/studio/compare-slider";
import { useIsMobile } from "@/hooks/use-mobile";
import { uploadFile, useEngine, useStatus } from "@/lib/api";
import {
  APPLIES_TO_DOC,
  deleteNode,
  duplicateNode,
  getNode,
  historyReducer,
  nativeSize,
  updateNode,
  type Box,
  type LayerDoc,
  type LayerModelInfo,
  type LayerNode,
  type LayerProjectView,
} from "@/lib/layers";
import { applyJob } from "./apply";
import { Ctx, isFailed, isRunning, type EditorCtx, type MaskEdit, type RunInput, type StageMode, type ToolId } from "./editor-context";
import { LayersPanel } from "./layers-panel";
import { MobileView } from "./mobile-view";
import { loadImage, ratioOf, renderDoc, renderNative, toBlob, uploadRender } from "./render";
import { Stage } from "./stage";
import { ToolRail } from "./tools";
import { TopBar, type SaveState } from "./top-bar";
import { LayersRequestError, saveCover, saveDoc, useLayerActions, useLayerProject } from "./use-layers";

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** The document is still just the image it was opened on (models can take the original file as is). */
function pristine(doc: LayerDoc): boolean {
  if (doc.nodes.length !== 1) return false;
  const n = doc.nodes[0];
  return n.src === doc.source && !n.crop && !n.maskSrc && !n.feather && !n.rotation && !n.hidden && (n.opacity ?? 1) === 1 && n.x === 0 && n.y === 0 && n.w === doc.width && n.h === doc.height;
}

/** A layer whose file is exactly what it shows. */
const plain = (n: LayerNode) => !n.crop && !n.maskSrc && !n.feather;

function EditorSkeleton() {
  return (
    <div className="flex h-svh min-w-0 flex-col overflow-hidden md:h-[calc(100svh-0.5rem)]">
      <div className="flex h-14 items-center gap-3 border-b px-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="ml-auto h-8 w-64 rounded-full" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[280px] space-y-2 border-r p-3 md:block">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
        <div className="grid flex-1 place-items-center bg-muted/40">
          <Skeleton className="aspect-[4/3] w-1/2 rounded-sm" />
        </div>
        <div className="hidden w-[300px] space-y-2 border-l p-3 md:block">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function LayersEditor({ id, models }: { id: string; models: Record<string, LayerModelInfo> }) {
  const q = useLayerProject(id);
  if (q.data) return <Editor key={id} initial={q.data} models={models} />;
  if (q.error) {
    if (q.error instanceof LayersRequestError && q.error.status === 404) {
      return <NotFoundState title="This project doesn't exist">It may have been deleted. The images it was opened on are still in your library.</NotFoundState>;
    }
    return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  }
  return <EditorSkeleton />;
}

function Editor({ initial, models }: { initial: LayerProjectView; models: Record<string, LayerModelInfo> }) {
  const id = initial.project.id;
  const q = useLayerProject(id);
  const view = q.data ?? initial;
  const actions = useLayerActions();
  const isMobile = useIsMobile();
  const [engine, setEngine] = useEngine();
  const status = useStatus().data;

  const [hist, dispatch] = useReducer(historyReducer, initial.doc, (doc) => ({ past: [], present: doc, future: [] }));
  const doc = hist.present;
  const docRef = useRef(doc);
  useLayoutEffect(() => {
    docRef.current = doc;
  }, [doc]);
  const headRef = useRef(initial.headVersionId);
  const [head, setHeadState] = useState(initial.headVersionId);
  const setHead = useCallback((v: string) => {
    headRef.current = v;
    setHeadState(v);
  }, []);
  const savedRef = useRef<LayerDoc>(initial.doc);
  const [save, setSave] = useState<SaveState>("saved");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = getNode(doc, selectedId);
  const [tool, setTool] = useState<ToolId | null>(() => (!initial.doc.decomposed && initial.doc.nodes.length === 1 ? "decompose" : null));
  const [splitTarget, setSplitTarget] = useState<string | null>(null);
  const [mode, setModeState] = useState<StageMode>("select");
  const [region, setRegion] = useState<Box | null>(null);
  const [frame, setFrame] = useState<Box | null>(null);
  const [highlight, setHighlight] = useState<Box | null>(null);
  const [previews, setPreviews] = useState<Map<string, HTMLCanvasElement>>(() => new Map());
  const [mask, setMask] = useState<MaskEdit | null>(null);
  const [maskVersion, setMaskVersion] = useState(0);
  const [brushSize, setBrushSize] = useState(() => Math.round(Math.max(initial.doc.width, initial.doc.height) / 30));
  const [compare, setCompare] = useState(false);

  const commit = useCallback((d: LayerDoc) => dispatch({ type: "commit", doc: d }), []);
  const resetTo = useCallback(
    (v: LayerProjectView) => {
      setHead(v.headVersionId);
      savedRef.current = v.doc;
      dispatch({ type: "reset", doc: v.doc });
      setSave("saved");
    },
    [setHead],
  );
  const refetch = q.refetch;

  // ---- Autosave into the head version (debounced; flushed with keepalive when leaving).
  const pending = useRef<LayerDoc | null>(null);
  useEffect(() => {
    if (doc === savedRef.current) return;
    pending.current = doc;
    setSave("dirty");
    const t = setTimeout(async () => {
      setSave("saving");
      try {
        await saveDoc(id, doc, headRef.current);
        savedRef.current = doc;
        if (pending.current === doc) pending.current = null;
        setSave("saved");
      } catch (e) {
        if (e instanceof LayersRequestError && e.status === 409) {
          setSave("conflict");
          toast.error(e.message, { id: "layers-conflict", action: { label: "Reload", onClick: () => void refetch().then((r) => r.data && resetTo(r.data)) } });
        } else setSave("error");
      }
    }, 700);
    return () => clearTimeout(t);
  }, [doc, id, refetch, resetTo]);
  useEffect(() => {
    const flush = () => {
      const d = pending.current;
      if (d && d !== savedRef.current) void saveDoc(id, d, headRef.current, true).catch(() => {});
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [id]);

  // ---- The project card's cover follows the composite (a small JPEG, a few seconds after edits settle).
  useEffect(() => {
    if (doc === initial.doc) return;
    let gone = false;
    const t = setTimeout(async () => {
      try {
        const c = await renderDoc(doc, { scale: Math.min(1, 360 / Math.max(doc.width, doc.height)), fill: "#ffffff" });
        if (!gone) await saveCover(id, c.toDataURL("image/jpeg", 0.8));
      } catch {
        // The card keeps its last cover.
      }
    }, 2500);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [doc, id, initial.doc]);

  // ---- Jobs: start, and lay out their results as they land.
  const busyJob = useCallback(
    (nodeId: string) => view.jobs.find((j) => j.nodeId === nodeId && j.tool !== "text-detect" && j.state === "pending" && !isFailed(j)),
    [view.jobs],
  );

  const run = useCallback<EditorCtx["run"]>(
    async (input: RunInput) => {
      const d = docRef.current;
      const { target, image: given, frame: givenFrame, ...rest } = input;
      try {
        let image = given;
        let jobFrame = givenFrame;
        let aspect: string | undefined;
        const needsImage = !(input.tool === "generate-layer");
        if (target.kind === "node") {
          const n = target.node;
          jobFrame ??= [n.x, n.y, n.w, n.h];
          if (!image && needsImage) {
            if (plain(n)) image = n.src;
            else image = await uploadRender(await renderNative(n), `layers-${n.name}`);
          }
          const [w, h] = nativeSize(n, 1e9);
          aspect = ratioOf(w, h);
        } else if (target.kind === "region") {
          jobFrame ??= target.rect;
          if (!image) image = await uploadRender(await renderDoc(d, { rect: target.rect, scale: Math.min(1, 2048 / Math.max(target.rect[2], target.rect[3])) }), "layers-region");
          aspect = ratioOf(target.rect[2], target.rect[3]);
        } else {
          jobFrame ??= [0, 0, d.width, d.height];
          if (!image && needsImage) image = pristine(d) ? d.source : await uploadRender(await renderDoc(d, { scale: Math.min(1, 4096 / Math.max(d.width, d.height)) }), "layers-composite");
          aspect = ratioOf(d.width, d.height);
        }
        return await actions.startJob(id, {
          ...rest,
          engine,
          image,
          frame: jobFrame,
          nodeId: target.kind === "node" ? target.node.id : undefined,
          settings: { aspect, ...rest.settings },
        });
      } catch (e) {
        toast.error((e as Error).message || "Could not start the tool");
        return null;
      }
    },
    [actions, engine, id],
  );

  const endJob = useCallback<EditorCtx["endJob"]>(
    (jobId, how) => void actions.endJob(id, jobId, how).catch((e) => toast.error((e as Error).message)),
    [actions, id],
  );

  const applying = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    for (const j of view.jobs) {
      if (j.state !== "pending" || j.result?.status !== "succeeded" || !APPLIES_TO_DOC.has(j.tool) || applying.current.has(j.id)) continue;
      applying.current.add(j.id);
      queue.current = queue.current.then(async () => {
        try {
          const res = await applyJob(docRef.current, j, () => nanoid(8));
          const v = await actions.version(id, { doc: res.doc, label: j.label, jobId: j.id });
          setHead(v.headVersionId);
          savedRef.current = res.doc;
          dispatch({ type: "commit", doc: res.doc });
          if (res.select) setSelectedId(res.select);
          if (j.tool === "split") setSplitTarget(null);
          toast.success(res.message, { duration: 2500 });
        } catch (e) {
          if (e instanceof LayersRequestError && e.status === 409) {
            // Another tab laid it out first: take the saved version.
            const r = await refetch();
            if (r.data) resetTo(r.data);
          } else {
            toast.error(`Couldn't add the result to your layers: ${(e as Error).message}`);
            endJob(j.id, "dismiss");
          }
        }
      });
    }
  }, [view.jobs, actions, id, refetch, resetTo, endJob, setHead]);

  // ---- Masks (brush paints the layer back, eraser hides it).
  const setMode = useCallback(
    (m: StageMode) => {
      setModeState(m);
      if (m !== "brush" && m !== "eraser") setMask(null);
    },
    [],
  );
  useEffect(() => {
    if ((mode !== "brush" && mode !== "eraser") || !selected) return;
    if (mask?.nodeId === selected.id) return;
    let gone = false;
    const node = selected;
    void (async () => {
      const [w, h] = nativeSize(node, 1024);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      if (node.maskSrc) {
        try {
          ctx.drawImage(await loadImage(node.maskSrc), 0, 0, w, h);
        } catch {
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
        }
      } else {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
      }
      if (!gone) setMask({ nodeId: node.id, canvas: c, size: w, version: 0 });
    })();
    return () => {
      gone = true;
    };
  }, [mode, selected, mask?.nodeId]);
  const [savingMask, setSavingMask] = useState(false);
  const finishMask = async () => {
    if (!mask) return;
    setSavingMask(true);
    try {
      const blob = await toBlob(mask.canvas);
      const asset = await uploadFile(new File([blob], "layer-mask.png", { type: "image/png" }));
      commit(updateNode(docRef.current, mask.nodeId, { maskSrc: asset.url }));
      toast.success("Mask saved", { duration: 1500 });
      setMode("select");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingMask(false);
    }
  };

  // ---- Selection changes end mask editing and per-layer previews.
  const select = useCallback(
    (nid: string | null) => {
      setSelectedId(nid);
      setModeState((m) => (m === "brush" || m === "eraser" ? "select" : m));
      setMask((m) => (m && m.nodeId !== nid ? null : m));
    },
    [],
  );

  const setPreview = useCallback((pid: string, c: HTMLCanvasElement | null) => {
    setPreviews((old) => {
      if (!c && !old.has(pid)) return old;
      const next = new Map(old);
      if (c) next.set(pid, c);
      else next.delete(pid);
      return next;
    });
  }, []);

  const openTool = useCallback((t: ToolId | null) => {
    setTool(t);
    if (t !== "decompose") setSplitTarget(null);
  }, []);

  // ---- Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      const d = docRef.current;
      const sel = getNode(d, selectedId);
      if (mod && e.key.toLowerCase() === "d" && sel) {
        e.preventDefault();
        commit(duplicateNode(d, sel.id, nanoid(8)));
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === "Escape") {
        if (mode === "brush" || mode === "eraser") setMode("select");
        else select(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        if (busyJob(sel.id)) toast.error("Can't delete while this layer is generating");
        else {
          commit(deleteNode(d, sel.id));
          select(null);
        }
        return;
      }
      if (sel && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        commit(updateNode(d, sel.id, { x: sel.x + dx, y: sel.y + dy }));
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "v") setMode("select");
      else if (k === "h") setMode("hand");
      else if ((k === "b" || k === "e") && sel) setMode(k === "b" ? "brush" : "eraser");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, mode, commit, select, setMode, busyJob]);

  // ---- Compare: the original against the current composite.
  const [composite, setComposite] = useState<string | null>(null);
  useEffect(() => {
    if (!compare) return;
    let url: string | null = null;
    let gone = false;
    void renderDoc(doc, { scale: Math.min(1, 1600 / Math.max(doc.width, doc.height)) })
      .then((c) => toBlob(c))
      .then((b) => {
        if (gone) return;
        url = URL.createObjectURL(b);
        setComposite(url);
      })
      .catch(() => toast.error("Couldn't render the comparison"));
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
      setComposite(null);
    };
  }, [compare, doc]);

  const isDemo = useCallback(
    (m: LayerModelInfo | undefined) => {
      if (!m || !status) return false;
      if (status.demoMode === "on") return true;
      if (status.demoMode === "off") return false;
      return !m.providers.some((p) => status.providers[p]?.configured);
    },
    [status],
  );

  const busy = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of view.jobs) if (j.nodeId && j.state === "pending" && isRunning(j)) m.set(j.nodeId, j.tool === "split" ? "Separating…" : `${j.label}…`);
    return m;
  }, [view.jobs]);

  const sources = useMemo(() => ({ masks: mask ? new Map([[mask.nodeId, mask.canvas]]) : undefined, maskVersion, previews }), [mask, maskVersion, previews]);
  const overlay = useMemo<LayerNode[] | undefined>(() => {
    if (!previews.has("__whole")) return undefined;
    return [{ id: "__whole", name: "Preview", z: 1e6, x: 0, y: 0, w: doc.width, h: doc.height, rotation: 0, src: doc.source, revisions: [], revision: 0 }];
  }, [previews, doc.width, doc.height, doc.source]);

  const ctx: EditorCtx = {
    projectId: id,
    project: view.project,
    versions: view.versions,
    headVersionId: head,
    doc,
    commit,
    selectedId,
    selected,
    select,
    engine,
    models,
    isDemo,
    jobs: view.jobs,
    busyJob,
    run,
    endJob,
    mode,
    setMode,
    region,
    setRegion,
    frame,
    setFrame,
    mask,
    setHighlight,
    setPreview,
    tool,
    openTool,
    splitTarget,
    setSplitTarget,
  };

  if (isMobile) return <MobileView project={view.project} doc={doc} jobs={view.jobs} />;

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-svh min-w-0 flex-col overflow-hidden md:h-[calc(100svh-0.5rem)]">
        <TopBar
          name={view.project.name}
          onRename={(n) => void actions.rename(id, n).catch((e) => toast.error((e as Error).message))}
          save={save}
          canUndo={hist.past.length > 0}
          canRedo={hist.future.length > 0}
          onUndo={() => dispatch({ type: "undo" })}
          onRedo={() => dispatch({ type: "redo" })}
          versions={view.versions}
          headVersionId={head}
          onRestore={async (vid) => {
            try {
              const v = await actions.version(id, { from: vid });
              resetTo(v);
              select(null);
              toast.success("Version restored", { duration: 1500 });
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
          compare={compare}
          onCompare={setCompare}
          doc={doc}
          jobs={view.jobs}
          engine={engine}
          setEngine={setEngine}
        />
        <div className="flex min-h-0 flex-1">
          <ToolRail />
          <main className="relative flex min-w-0 flex-1 flex-col">
            {compare ? (
              <div className="checkerboard grid min-h-0 flex-1 place-items-center overflow-hidden p-6">
                {composite ? <CompareSlider before={doc.source} after={composite} alt="Your layers" /> : <Loader2 className="size-5 animate-spin text-muted-foreground" />}
              </div>
            ) : (
              <Stage
                doc={doc}
                selectedId={selectedId}
                onSelect={select}
                onCommit={commit}
                mode={mode}
                setMode={setMode}
                region={region}
                setRegion={setRegion}
                frame={frame}
                setFrame={setFrame}
                mask={mask}
                onMaskChange={() => setMaskVersion((v) => v + 1)}
                brushSize={brushSize}
                setBrushSize={setBrushSize}
                highlight={highlight}
                sources={sources}
                overlay={overlay}
                busy={busy}
              />
            )}
            {mask && selected && !compare && (
              <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 py-1 pr-1 pl-3.5 text-[12px] shadow-normal backdrop-blur" role="status">
                <span className="max-w-[40vw] truncate">
                  Mask · <span className="font-medium">{selected.name}</span> — the eraser hides, the brush paints back
                </span>
                <Button size="xs" variant="ghost" className="rounded-full" onClick={() => setMode("select")}>
                  <X /> Cancel
                </Button>
                <Button size="xs" className="rounded-full" onClick={() => void finishMask()} disabled={savingMask}>
                  {savingMask ? <Loader2 className="animate-spin" /> : <Check />} Done
                </Button>
              </div>
            )}
          </main>
          <LayersPanel />
        </div>
      </div>
    </Ctx.Provider>
  );
}
