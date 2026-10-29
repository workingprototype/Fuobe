import type { Metadata } from "next";
import { CanvasList, type TemplateCardData } from "@/components/canvas/canvas-list";
import { getModel } from "@/lib/catalog";
import { CANVAS_TEMPLATES, isGenerator, outline, type CanvasTemplate } from "@/lib/catalog/canvas";
import type { Engine } from "@/lib/catalog/types";

export const metadata: Metadata = { title: "Canvas" };

/** One template's board outline and model names on an engine. */
function forEngine(t: CanvasTemplate, engine: Engine): TemplateCardData["byEngine"][Engine] {
  const graph = t.build(engine);
  const names = graph.nodes.filter(isGenerator).map((n) => getModel(n.data.modelId ?? "")?.name);
  return { outline: outline(graph), models: [...new Set(names.filter((m): m is string => !!m))] };
}

/** Template cards built here, so the browser never loads the model catalog for /canvas (nor for the pages that prefetch it). */
function templateCards(): TemplateCardData[] {
  return CANVAS_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    hue: t.hue,
    ...(t.group && { group: t.group }),
    byEngine: { cloud: forEngine(t, "cloud"), open: forEngine(t, "open") },
  }));
}

export default function Page() {
  return <CanvasList templates={templateCards()} />;
}
