import type { Metadata } from "next";
import { Suspense } from "react";
import { LayersEditor } from "@/components/layers/layers-editor";
import { getModel } from "@/lib/catalog";
import { CUTOUT_MODELS, TOOL_MODELS, type LayerModelInfo } from "@/lib/layers";

export const metadata: Metadata = { title: "Layers" };

/** Names, prices and providers of the tools' models, built here so the editor ships no catalog. */
function toolModels(): Record<string, LayerModelInfo> {
  const ids = new Set([...Object.values(TOOL_MODELS).flatMap((t) => [...t.cloud, ...t.open]), CUTOUT_MODELS.cloud, CUTOUT_MODELS.open]);
  const out: Record<string, LayerModelInfo> = {};
  for (const id of ids) {
    const m = getModel(id);
    if (!m) continue;
    out[id] = {
      id,
      name: m.name,
      engine: m.engine,
      tagline: m.tagline,
      ...(m.pricing ? { pricing: { unit: m.pricing.unit, usd: m.pricing.usd, ...(m.pricing.note ? { note: m.pricing.note } : {}) } } : {}),
      providers: [...new Set(m.routes.map((r) => r.provider))],
    };
  }
  return out;
}

async function Editor({ params }: { params: PageProps<"/layers/[id]">["params"] }) {
  const { id } = await params;
  return <LayersEditor id={id} models={toolModels()} />;
}

export default function Page({ params }: PageProps<"/layers/[id]">) {
  return (
    <Suspense fallback={null}>
      <Editor params={params} />
    </Suspense>
  );
}
