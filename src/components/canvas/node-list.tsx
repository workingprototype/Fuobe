"use client";

import { AlertCircle, Play, RotateCcw, Square, Upload } from "lucide-react";
import { useRef } from "react";
import { getModel } from "@/lib/catalog";
import { isGenerator, NODE_SPECS, nodeLabel, topoOrder, type CanvasNode } from "@/lib/catalog/canvas";
import type { MediaKind } from "@/lib/catalog/types";
import { fileToSlot } from "@/components/studio/media-slot";
import { cn } from "@/lib/utils";
import { NodeIcon, useEditor } from "./canvas-context";
import { costLabel, EngineBadge, MediaPreview, OutputThumb, Results } from "./nodes";

const KIND: Partial<Record<CanvasNode["type"], MediaKind>> = { "image-input": "image", "video-input": "video", "audio-input": "audio" };

const field = "field-sizing-content max-h-40 min-h-12 w-full resize-none rounded-lg bg-muted px-3 py-2 text-[15px] leading-snug outline-none placeholder:text-subtle-foreground focus:ring-2 focus:ring-brand-faint";

/**
 * The phone view of a canvas: every node in run order as a card, with its text, files, results
 * and a Run button. Wiring stays on the board (pan and zoom it on the Board tab).
 */
export function NodeList() {
  const ed = useEditor();
  const byId = new Map(ed.graph.nodes.map((n) => [n.id, n]));
  const { order, cyclic } = topoOrder(ed.graph);
  const nodes = [...order, ...cyclic].map((id) => byId.get(id)!).filter((n) => n && n.type !== "note");
  if (!nodes.length) {
    return <p className="px-6 py-16 text-center text-[15px] text-muted-foreground">This canvas is empty. Add nodes on a larger screen, or start from a template.</p>;
  }
  return (
    <ol className="space-y-3 px-4 pt-3 pb-24" aria-label="Nodes in run order">
      {nodes.map((n, i) => (
        <li key={n.id}>
          <NodeCard node={n} index={i + 1} />
        </li>
      ))}
    </ol>
  );
}

function NodeCard({ node, index }: { node: CanvasNode; index: number }) {
  const ed = useEditor();
  const model = node.data.modelId ? getModel(node.data.modelId) : undefined;
  const kind = KIND[node.type];
  const file = useRef<HTMLInputElement>(null);
  const gen = isGenerator(node);
  const r = ed.results(node.id);
  const desc = gen ? ed.describe(node.id) : undefined;
  const step = ed.plan.steps.find((s) => s.nodeId === node.id);
  const running = r.state === "running" || r.state === "queued";
  const error = ed.runErrors[node.id] ?? desc?.error;
  const sources = node.type === "output" ? ed.graph.edges.filter((e) => e.target === node.id).map((e) => ed.graph.nodes.find((x) => x.id === e.source)).filter((x): x is CanvasNode => !!x) : [];
  return (
    <article className="rounded-xl border bg-card p-3 shadow-soft" data-testid={`canvas-card-${node.id}`}>
      <header className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-subtle-foreground">{index}</span>
        <NodeIcon name={NODE_SPECS[node.type].icon} className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{nodeLabel(node)}</h3>
        <EngineBadge model={model} />
        {gen && (
          <button
            onClick={() => (running ? ed.cancel(node.id) : ed.run([node.id], !step))}
            className={cn("grid size-9 shrink-0 place-items-center rounded-full", running ? "bg-muted" : "bg-primary text-primary-foreground")}
            aria-label={running ? "Cancel" : step ? "Run node" : "Run it again"}
          >
            {running ? <Square className="size-3.5" /> : step ? <Play className="size-4" /> : <RotateCcw className="size-4" />}
          </button>
        )}
      </header>
      <div className="mt-2.5 space-y-2.5">
        {node.type === "prompt" && <textarea value={node.data.text ?? ""} onChange={(e) => ed.update(node.id, { text: e.target.value })} className={field} aria-label="Text" placeholder="Write the text" />}
        {kind && (
          <>
            {node.data.url ? <MediaPreview kind={kind} url={node.data.url} /> : <p className="text-[13px] text-muted-foreground">No file yet.</p>}
            <button onClick={() => file.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-secondary px-3.5 text-[13px] font-medium">
              <Upload className="size-4" /> {node.data.url ? "Replace" : "Upload"}
            </button>
            <input
              ref={file}
              type="file"
              hidden
              accept={`${kind}/*`}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void fileToSlot(f, (v) => v && !v.uploading && ed.update(node.id, { url: v.ref, name: v.name }), kind);
                e.target.value = "";
              }}
            />
          </>
        )}
        {node.type === "element" && <p className="font-mono text-[13px] text-brand-text">{node.data.handle ? `@${node.data.handle}` : "No element picked"}</p>}
        {gen && (
          <>
            <p className="text-[12px] text-muted-foreground">
              {model?.name ?? "No model"} · {costLabel(ed, model, desc?.costUsd ?? null)}
            </p>
            {node.data.prompt !== undefined || node.type === "model" ? (
              <textarea value={node.data.prompt ?? ""} onChange={(e) => ed.update(node.id, { prompt: e.target.value })} className={field} aria-label="Prompt" placeholder="Prompt (connected text joins in)" />
            ) : null}
            <Results id={node.id} r={r} />
          </>
        )}
        {node.type === "output" &&
          (sources.length ? (
            <div className="grid grid-cols-2 gap-2">
              {sources.flatMap((s) => {
                const out = ed.results(s.id).outputs[0];
                return out ? [<OutputThumb key={s.id} o={out.o} onOpen={() => ed.open(s.id, 0)} />] : [];
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Nothing connected.</p>
          ))}
        {error && r.state !== "failed" && (
          <p className={cn("flex items-start gap-1.5 text-[13px] leading-snug", ed.runErrors[node.id] ? "text-destructive" : "text-warning")}>
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
