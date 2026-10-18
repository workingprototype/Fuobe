"use client";

import { Brush, Eraser, Hand, Maximize, Minus, MousePointer2, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { resizeBox, rotationTo, toLocal, type Box, type Handle, type LayerDoc, type LayerNode } from "@/lib/layers";
import { cn } from "@/lib/utils";
import type { MaskEdit, StageMode } from "./editor-context";
import { drawNode, opaqueAt, type Sources } from "./render";

interface View {
  zoom: number;
  x: number;
  y: number;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; id: string; px: number; py: number; node: LayerNode; moved: boolean }
  | { kind: "resize"; id: string; handle: Handle; px: number; py: number; node: LayerNode }
  | { kind: "rotate"; id: string; node: LayerNode }
  | { kind: "region"; px: number; py: number }
  | { kind: "frame"; handle: Handle | "move"; px: number; py: number; start: Box }
  | { kind: "paint"; last: [number, number] | null };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const HANDLE_CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export interface StageProps {
  doc: LayerDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (doc: LayerDoc) => void;
  mode: StageMode;
  setMode: (m: StageMode) => void;
  region: Box | null;
  setRegion: (r: Box | null) => void;
  frame: Box | null;
  setFrame: (r: Box | null) => void;
  mask: MaskEdit | null;
  onMaskChange: () => void;
  brushSize: number;
  setBrushSize: (n: number) => void;
  highlight: Box | null;
  sources: Sources;
  /** Extra layers drawn over the document without being part of it (a whole-image grade preview). */
  overlay?: LayerNode[];
  /** Layers a tool is working on, with what to say. */
  busy: Map<string, string>;
  readOnly?: boolean;
}

export function Stage(p: StageProps) {
  const { doc, selectedId, mode } = p;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const fitted = useRef("");
  const drag = useRef<Drag | null>(null);
  /** Geometry while a layer is dragged (committed on release). */
  const [live, setLive] = useState<LayerNode | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [space, setSpace] = useState(false);
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const [tick, setTick] = useState(0);
  /** What the pointer is doing (render-safe copy of drag.current's kind). */
  const [dragKind, setDragKind] = useState<Drag["kind"] | null>(null);
  const redraw = useCallback(() => setTick((t) => t + 1), []);

  // Container size.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const pad = size.w < 500 ? 24 : 56;
    const zoom = Math.min((size.w - pad * 2) / doc.width, (size.h - pad * 2) / doc.height, 4);
    setView({ zoom, x: (size.w - doc.width * zoom) / 2, y: (size.h - doc.height * zoom) / 2 });
  }, [size.w, size.h, doc.width, doc.height]);

  // Fit on first layout and whenever the canvas changes size (Expand & Crop).
  useEffect(() => {
    const key = `${doc.width}x${doc.height}|${size.w > 0}`;
    if (!size.w || fitted.current === key) return;
    fitted.current = key;
    fit();
  }, [doc.width, doc.height, size.w, fit]);

  const nodes = useMemo(() => {
    const list = [...doc.nodes].sort((a, b) => a.z - b.z).map((n) => (live && n.id === live.id ? live : n));
    return p.overlay?.length ? [...list, ...p.overlay] : list;
  }, [doc.nodes, live, p.overlay]);

  // Paint.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(size.w * dpr);
    const H = Math.round(size.h * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    ctx.clip();
    ctx.imageSmoothingQuality = "high";
    for (const n of nodes) if (!n.hidden) drawNode(ctx, n, dpr * view.zoom, p.sources, redraw);
    ctx.restore();
  }, [nodes, view, size, doc.width, doc.height, p.sources, redraw, tick]);

  // Wheel: pinch / ⌘-scroll zooms around the pointer, scrolling pans.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          const zoom = Math.min(16, Math.max(0.05, v.zoom * Math.exp(-e.deltaY * 0.01)));
          return { zoom, x: mx - ((mx - v.x) / v.zoom) * zoom, y: my - ((my - v.y) / v.zoom) * zoom };
        }
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Space held = hand tool; zoom keys.
  const zoomBy = useCallback(
    (k: number) =>
      setView((v) => {
        const zoom = Math.min(16, Math.max(0.05, v.zoom * k));
        const cx = size.w / 2;
        const cy = size.h / 2;
        return { zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom };
      }),
    [size.w, size.h],
  );
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space" && !e.repeat) {
        setSpace(true);
        e.preventDefault();
      } else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-") zoomBy(0.8);
      else if (e.key === "0") fit();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [zoomBy, fit]);

  const toDoc = (clientX: number, clientY: number): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [(clientX - r.left - view.x) / view.zoom, (clientY - r.top - view.y) / view.zoom];
  };

  /** The topmost visible layer under a point, by its pixels (transparent parts let clicks through). */
  const hitTest = (px: number, py: number): LayerNode | undefined => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.hidden || n.id.startsWith("__")) continue;
      const uv = toLocal(n, px, py);
      if (uv && opaqueAt(n, uv[0], uv[1])) return n;
    }
    return undefined;
  };

  const paint = (px: number, py: number) => {
    const m = p.mask;
    const d = drag.current;
    if (!m || d?.kind !== "paint") return;
    const n = doc.nodes.find((x) => x.id === m.nodeId);
    if (!n) return;
    // Local coordinates may run past the edges; strokes there are simply clipped.
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const r = (-n.rotation * Math.PI) / 180;
    const lx = (px - cx) * Math.cos(r) - (py - cy) * Math.sin(r);
    const ly = (px - cx) * Math.sin(r) + (py - cy) * Math.cos(r);
    const x = (lx / n.w + 0.5) * m.canvas.width;
    const y = (ly / n.h + 0.5) * m.canvas.height;
    const ctx = m.canvas.getContext("2d")!;
    ctx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = (p.brushSize * m.canvas.width) / n.w;
    ctx.beginPath();
    if (d.last) {
      ctx.moveTo(d.last[0], d.last[1]);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    d.last = [x, y];
    p.onMaskChange();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const [px, py] = toDoc(e.clientX, e.clientY);
    const panning = e.button === 1 || mode === "hand" || space || (p.readOnly && mode !== "region");
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const begin = (d: Drag) => {
      drag.current = d;
      setDragKind(d.kind);
    };
    if (panning) {
      begin({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    if ((mode === "brush" || mode === "eraser") && p.mask) {
      begin({ kind: "paint", last: null });
      paint(px, py);
      return;
    }
    if (mode === "region") {
      begin({ kind: "region", px, py });
      p.setRegion(null);
      return;
    }
    if (mode === "frame") return;
    const hit = hitTest(px, py);
    p.onSelect(hit?.id ?? null);
    if (hit && !p.readOnly) begin({ kind: "move", id: hit.id, px, py, node: hit, moved: false });
  };

  const startHandle = (e: React.PointerEvent, kind: "resize" | "rotate" | "move", handle?: Handle) => {
    e.stopPropagation();
    if (e.button !== 0 || p.readOnly) return;
    const node = nodes.find((n) => n.id === selectedId);
    if (!node) return;
    box.current!.setPointerCapture(e.pointerId);
    const [px, py] = toDoc(e.clientX, e.clientY);
    drag.current = kind === "rotate" ? { kind, id: node.id, node } : kind === "resize" ? { kind, id: node.id, handle: handle!, px, py, node } : { kind: "move", id: node.id, px, py, node, moved: false };
    setDragKind(drag.current.kind);
  };

  const startFrame = (e: React.PointerEvent, handle: Handle | "move") => {
    e.stopPropagation();
    if (e.button !== 0 || !p.frame) return;
    box.current!.setPointerCapture(e.pointerId);
    const [px, py] = toDoc(e.clientX, e.clientY);
    drag.current = { kind: "frame", handle, px, py, start: p.frame };
    setDragKind("frame");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [px, py] = toDoc(e.clientX, e.clientY);
    setPointer([px, py]);
    const d = drag.current;
    if (!d) {
      if (mode === "select" && !space) setHover(hitTest(px, py)?.id ?? null);
      return;
    }
    switch (d.kind) {
      case "pan":
        setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
        break;
      case "paint":
        paint(px, py);
        break;
      case "move": {
        const dx = px - d.px;
        const dy = py - d.py;
        if (!d.moved && Math.hypot(dx * view.zoom, dy * view.zoom) < 3) return;
        d.moved = true;
        setLive({ ...d.node, x: d.node.x + dx, y: d.node.y + dy });
        break;
      }
      case "resize":
        setLive({ ...d.node, ...resizeBox(d.node, d.handle, px - d.px, py - d.py, e.shiftKey) });
        break;
      case "rotate":
        setLive({ ...d.node, rotation: rotationTo(d.node.x + d.node.w / 2, d.node.y + d.node.h / 2, px, py, e.shiftKey) });
        break;
      case "region": {
        const x0 = Math.max(0, Math.min(doc.width, Math.min(d.px, px)));
        const y0 = Math.max(0, Math.min(doc.height, Math.min(d.py, py)));
        const x1 = Math.max(0, Math.min(doc.width, Math.max(d.px, px)));
        const y1 = Math.max(0, Math.min(doc.height, Math.max(d.py, py)));
        p.setRegion(x1 - x0 >= 2 && y1 - y0 >= 2 ? [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)] : null);
        break;
      }
      case "frame": {
        const [x, y, w, h] = d.start;
        const dx = px - d.px;
        const dy = py - d.py;
        if (d.handle === "move") p.setFrame([Math.round(x + dx), Math.round(y + dy), w, h]);
        else {
          const r = resizeBox({ x, y, w, h, rotation: 0 }, d.handle, dx, dy, true);
          p.setFrame([Math.round(r.x), Math.round(r.y), Math.max(8, Math.round(r.w)), Math.max(8, Math.round(r.h))]);
        }
        break;
      }
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragKind(null);
    if (!d) return;
    if ((d.kind === "move" && d.moved) || d.kind === "resize" || d.kind === "rotate") {
      const n = live;
      setLive(null);
      if (n && n.id === d.id) {
        const g = { x: n.x, y: n.y, w: n.w, h: n.h, rotation: n.rotation };
        p.onCommit({ ...doc, nodes: doc.nodes.map((x) => (x.id === n.id ? { ...x, ...g } : x)) });
      }
    }
    if (d.kind === "region" && p.region && (p.region[2] < 8 || p.region[3] < 8)) p.setRegion(null);
  };

  const sel = nodes.find((n) => n.id === selectedId && !n.hidden);
  const hov = hover && hover !== selectedId ? nodes.find((n) => n.id === hover) : undefined;
  const at = (b: Box | Pick<LayerNode, "x" | "y" | "w" | "h">) => {
    const [x, y, w, h] = Array.isArray(b) ? b : [b.x, b.y, b.w, b.h];
    return { left: view.x + x * view.zoom, top: view.y + y * view.zoom, width: w * view.zoom, height: h * view.zoom };
  };
  const cursor = space || mode === "hand" ? (dragKind === "pan" ? "grabbing" : "grab") : mode === "region" ? "crosshair" : mode === "brush" || mode === "eraser" ? "none" : undefined;
  const maskNode = p.mask ? doc.nodes.find((n) => n.id === p.mask!.nodeId) : undefined;

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/40" style={{ cursor }}>
      <div
        ref={box}
        className="absolute inset-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          setHover(null);
          setPointer(null);
        }}
      >
        <div className="checkerboard absolute shadow-soft" style={at([0, 0, doc.width, doc.height])} />
        <canvas ref={canvas} className="absolute inset-0 size-full" role="img" aria-label={`Canvas, ${doc.nodes.length} layer${doc.nodes.length === 1 ? "" : "s"}`} />

        {/* Layers a tool is working on. */}
        {[...p.busy].map(([id, text]) => {
          const n = nodes.find((x) => x.id === id);
          if (!n) return null;
          return (
            <div key={id} className="pointer-events-none absolute" style={{ ...at(n), transform: `rotate(${n.rotation}deg)` }}>
              <div className="absolute inset-0 animate-pulse rounded-sm border-2 border-dashed border-primary bg-primary/10" />
              <span className="absolute top-1 left-1 max-w-[calc(100%-8px)] truncate rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium shadow-soft">{text}</span>
            </div>
          );
        })}

        {hov && mode === "select" && !dragKind && (
          <div className="pointer-events-none absolute border border-primary/70" style={{ ...at(hov), transform: `rotate(${hov.rotation}deg)` }} />
        )}

        {sel && mode === "select" && !p.readOnly && (
          <div className="absolute border-[1.5px] border-primary" style={{ ...at(sel), transform: `rotate(${sel.rotation}deg)` }}>
            <div className="absolute inset-0 cursor-move" onPointerDown={(e) => startHandle(e, "move")} aria-hidden />
            <button
              type="button"
              aria-label="Rotate layer"
              title="Rotate layer (Shift snaps to 15°)"
              className="absolute -top-7 left-1/2 size-4 -translate-x-1/2 cursor-grab rounded-full border-[1.5px] border-primary bg-background shadow-soft"
              onPointerDown={(e) => startHandle(e, "rotate")}
            />
            <span className="pointer-events-none absolute -top-3 left-1/2 h-3 w-px -translate-x-1/2 bg-primary" />
            {HANDLES.map((h) => (
              <span
                key={h}
                aria-hidden
                onPointerDown={(e) => startHandle(e, "resize", h)}
                className="absolute size-2.5 -translate-1/2 rounded-[3px] border-[1.5px] border-primary bg-background"
                style={{ left: `${HANDLE_POS[h][0] * 100}%`, top: `${HANDLE_POS[h][1] * 100}%`, cursor: HANDLE_CURSOR[h] }}
              />
            ))}
          </div>
        )}

        {p.highlight && <div className="pointer-events-none absolute rounded-sm ring-2 ring-primary ring-offset-1 ring-offset-transparent" style={at(p.highlight)} />}

        {p.region && (
          <div className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" style={at(p.region)}>
            <span className="absolute -top-6 left-0 rounded-full bg-primary px-2 py-0.5 font-mono text-[11px] text-primary-foreground">
              {p.region[2]} × {p.region[3]}
            </span>
          </div>
        )}

        {mode === "frame" && p.frame && (
          <div className="absolute border-2 border-primary shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" style={at(p.frame)}>
            <div className="absolute inset-0 cursor-move" onPointerDown={(e) => startFrame(e, "move")} aria-hidden />
            <span className="pointer-events-none absolute -top-6 left-0 rounded-full bg-primary px-2 py-0.5 font-mono text-[11px] text-primary-foreground">
              {p.frame[2]} × {p.frame[3]}
            </span>
            {HANDLES.map((h) => (
              <span
                key={h}
                aria-hidden
                onPointerDown={(e) => startFrame(e, h)}
                className="absolute size-3 -translate-1/2 rounded-[3px] border-2 border-primary bg-background"
                style={{ left: `${HANDLE_POS[h][0] * 100}%`, top: `${HANDLE_POS[h][1] * 100}%`, cursor: HANDLE_CURSOR[h] }}
              />
            ))}
          </div>
        )}

        {maskNode && (mode === "brush" || mode === "eraser") && (
          <div className="pointer-events-none absolute border border-dashed border-primary" style={{ ...at(maskNode), transform: `rotate(${maskNode.rotation}deg)` }} />
        )}
        {pointer && (mode === "brush" || mode === "eraser") && p.mask && (
          <div
            className="pointer-events-none absolute rounded-full border-2 border-white mix-blend-difference"
            style={{ left: view.x + pointer[0] * view.zoom - (p.brushSize * view.zoom) / 2, top: view.y + pointer[1] * view.zoom - (p.brushSize * view.zoom) / 2, width: p.brushSize * view.zoom, height: p.brushSize * view.zoom }}
          />
        )}
      </div>

      {/* Canvas tools */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border bg-background/95 p-1 shadow-normal backdrop-blur">
        {!p.readOnly && (
          <>
            <ModeButton icon={MousePointer2} label="Select and move" k="V" active={mode === "select"} onClick={() => p.setMode("select")} />
            <ModeButton icon={Hand} label="Pan" k="H" active={mode === "hand"} onClick={() => p.setMode("hand")} />
            <ModeButton icon={Brush} label={selectedId ? "Brush: paint the mask back" : "Brush (pick a layer first)"} k="B" active={mode === "brush"} disabled={!selectedId} onClick={() => p.setMode("brush")} />
            <ModeButton icon={Eraser} label={selectedId ? "Eraser: hide parts of the layer" : "Eraser (pick a layer first)"} k="E" active={mode === "eraser"} disabled={!selectedId} onClick={() => p.setMode("eraser")} />
            {(mode === "brush" || mode === "eraser") && (
              <div className="flex w-32 items-center gap-2 px-2">
                <Slider aria-label="Brush size" min={4} max={Math.max(64, Math.round(Math.max(doc.width, doc.height) / 6))} step={1} value={[p.brushSize]} onValueChange={([v]) => p.setBrushSize(v)} />
              </div>
            )}
            <span className="mx-1 h-5 w-px bg-border" />
          </>
        )}
        <ModeButton icon={Minus} label="Zoom out" k="−" onClick={() => zoomBy(0.8)} />
        <button type="button" onClick={fit} className="h-8 min-w-12 rounded-full px-1.5 font-mono text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Fit to screen">
          {Math.round(view.zoom * 100)}%
        </button>
        <ModeButton icon={Plus} label="Zoom in" k="+" onClick={() => zoomBy(1.25)} />
        <ModeButton icon={Maximize} label="Fit to screen" k="0" onClick={fit} />
      </div>
    </div>
  );
}

function ModeButton({ icon: Icon, label, k, active, disabled, onClick }: { icon: typeof Hand; label: string; k?: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent",
            active && "bg-brand-faint text-brand-text hover:bg-brand-faint-hover",
          )}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {k && <Kbd>{k}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
