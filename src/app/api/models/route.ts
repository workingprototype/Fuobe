import { connection } from "next/server";
import { MODELS } from "@/lib/catalog";
import { OPERATION_LABELS, type Engine, type MediaKind, type ModelDef, type Operation } from "@/lib/catalog/types";
import { findModels, MODEL_KINDS, toModelInfo } from "@/lib/model-list";
import { AUDIO_STUDIO, EDIT_STUDIO, IMAGE_STUDIO, VIDEO_STUDIO } from "@/lib/studios";
import { provider } from "@/server/providers";
import { llmBackends } from "@/server/providers/llm";
import { engineMode } from "@/server/settings";

/** A provider for one of its routes is set up (else it runs as a demo). */
const connected = (m: ModelDef) => m.routes.some((r) => (r.provider === "llm" ? llmBackends(r).length > 0 : provider(r.provider).isConfigured()));

/**
 * Models this install can run, for scripts and the `fuobe` CLI. Filters: kind, engine (open |
 * cloud), op, q (words that must all match), hidden=1 (chain helpers too). Models of an engine the
 * install has switched off (Settings → Engine mode) are left out. `defaults` are the studios' own
 * picks (image, edit, video, audio) per engine.
 */
export async function GET(request: Request) {
  await connection();
  const p = new URL(request.url).searchParams;
  const kind = p.get("kind") || undefined;
  if (kind && !MODEL_KINDS.includes(kind as MediaKind)) return Response.json({ error: `kind is one of ${MODEL_KINDS.join(", ")}` }, { status: 400 });
  const engine = p.get("engine") || undefined;
  if (engine && engine !== "open" && engine !== "cloud") return Response.json({ error: "engine is open or cloud" }, { status: 400 });
  const op = p.get("op") || undefined;
  if (op && !(op in OPERATION_LABELS)) return Response.json({ error: `Unknown operation ${op}` }, { status: 400 });
  const mode = engineMode();
  const list = findModels(MODELS, { kind: kind as MediaKind | undefined, engine: engine as Engine | undefined, op: op as Operation | undefined, q: p.get("q") ?? undefined, hidden: p.get("hidden") === "1" }).filter(
    (m) => mode === "both" || m.engine === mode,
  );
  const defaults = Object.fromEntries(
    Object.entries({ image: IMAGE_STUDIO, edit: EDIT_STUDIO, video: VIDEO_STUDIO, audio: AUDIO_STUDIO }).map(([k, s]) => [
      k,
      { ...(mode !== "open" && s.defaultModels.cloud && { cloud: s.defaultModels.cloud }), ...(mode !== "cloud" && s.defaultModels.open && { open: s.defaultModels.open }) },
    ]),
  );
  return Response.json({ engineMode: mode, defaults, items: list.map((m) => ({ ...toModelInfo(m), connected: connected(m) })) });
}
