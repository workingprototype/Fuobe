import { connection } from "next/server";
import { getModel, MODELS } from "@/lib/catalog";
import { ENGINE_MODELS } from "@/lib/catalog/faceless";
import { OPERATION_LABELS, type Engine, type MediaKind, type ModelDef, type Operation } from "@/lib/catalog/types";
import { findModels, MODEL_KINDS, toModelInfo } from "@/lib/model-list";
import { AUDIO_STUDIO, DIALOGUE_STUDIO, EDIT_STUDIO, IMAGE_STUDIO, VIDEO_STUDIO } from "@/lib/studios";
import { provider } from "@/server/providers";
import { llmBackends } from "@/server/providers/llm";
import { engineMode, getSetting } from "@/server/settings";

/** A provider for one of its routes is set up. */
const connected = (m: ModelDef) => m.routes.some((r) => (r.provider === "llm" ? llmBackends(r).length > 0 : provider(r.provider).isConfigured()));

/**
 * How a run of the model goes today, the way chooseRoute decides: "real" on its provider, "demo"
 * (placeholder media, free: Demo mode on, or auto with no provider set up) or "refused" (Demo mode
 * off and no provider: the run fails with "Connect … in Settings").
 */
function runsAs(m: ModelDef, demoMode: string): "real" | "demo" | "refused" {
  if (demoMode === "on") return "demo";
  if (connected(m)) return "real";
  return demoMode === "off" ? "refused" : "demo";
}

/** Per engine, the ids that clone voices (a dialogue studio's cloud default uses premade voices only). */
const cloning = (ids: { cloud?: string; open?: string }) => Object.fromEntries(Object.entries(ids).filter(([, id]) => id && getModel(id)?.options.voiceClone));

/**
 * The studios' own picks per engine: image, edit (images attached), video, audio (text to speech),
 * dialogue, clone (text to speech in the voice of a sample) and cloneDialogue (two speakers, each
 * cloned from a sample).
 */
const DEFAULTS: Record<string, { cloud?: string; open?: string }> = {
  image: IMAGE_STUDIO.defaultModels,
  edit: EDIT_STUDIO.defaultModels,
  video: VIDEO_STUDIO.defaultModels,
  audio: AUDIO_STUDIO.defaultModels,
  dialogue: DIALOGUE_STUDIO.defaultModels,
  clone: cloning({ cloud: ENGINE_MODELS.cloud.cloneNarration, open: ENGINE_MODELS.open.cloneNarration }),
  cloneDialogue: cloning(DIALOGUE_STUDIO.defaultModels),
};

/**
 * Models this install can run, for scripts and the `fuobe` CLI. Filters: kind, engine (open |
 * cloud), op, q (words that must all match), hidden=1 (chain helpers too). Models of an engine the
 * install has switched off (Settings → Engine mode) are left out. `defaults` are the studios' own
 * picks per engine (DEFAULTS); each item says whether its provider is `connected` and how a run
 * goes today (`runs`, which follows Settings → Demo mode).
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
    Object.entries(DEFAULTS).map(([k, ids]) => [k, { ...(mode !== "open" && ids.cloud && { cloud: ids.cloud }), ...(mode !== "cloud" && ids.open && { open: ids.open }) }]),
  );
  const demoMode = getSetting("demoMode");
  return Response.json({ engineMode: mode, demoMode, defaults, items: list.map((m) => ({ ...toModelInfo(m), connected: connected(m), runs: runsAs(m, demoMode) })) });
}
