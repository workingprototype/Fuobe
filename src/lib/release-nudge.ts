import { openEngineReady, type ConnectionState } from "./connections";
import { HOME_RELEASE } from "./home-release";
import { minVramBytesFor } from "./lanes";
import { runsGoHere } from "./pool-rules";
import { runsHere, type Here } from "./runnable-here";
import type { ModelDef } from "./catalog/types";

/**
 * The studios' "is here" card for the newest open model (src/components/studio/release-nudge.tsx): the release is Home's
 * (HOME_RELEASE in src/lib/home-release.ts: its model, name, day and pictures), and this is the card's own part. Browser-
 * safe. The next release swaps HOME_RELEASE and these lines and pictures; its new model and day give the browser's "Not
 * now" a new key, so the card shows again to everyone who put the last one away.
 */
export const RELEASE_NUDGE = {
  /** The card's line in each studio that shows it (StudioConfig.releaseNudge). */
  lines: {
    image: "Photoreal people and products, painting, illustration and exact lettering.",
    edit: "Edits with up to 5 pictures, from photoreal people and products to exact lettering.",
  },
  /** Three of the release's pictures (slugs of HOME_RELEASE.art): left, middle (on top) and right of the card's fan. */
  art: ["emerald-watch", "couture-dunes", "gold-leaf-beauty"],
  /** The graphics memory the model's lane needs, in GB (the requirements index's): a visitor's own smaller GPU isn't offered it. */
  vramGb: 32,
} as const;

export type ReleaseStudio = keyof typeof RELEASE_NUDGE.lines;

/** The browser's key for "Not now" (and for Try it, after which the card isn't needed): one per release. */
export const nudgeKey = (r: { modelId: string; released: string } = HOME_RELEASE) => `fuobe:release-nudge:${r.modelId}:${r.released}`;

/** The parts of GET /api/status the card reads. */
export type NudgeStatus = ConnectionState & {
  viewer?: { hosted?: boolean; prefer?: "pool"; runOn?: string; gpu: { connected: boolean; vramBytes?: number } };
};

/**
 * Whether the viewer can run the release's model here now, so the card may offer it: the install runs open models, the
 * model is switched on, and the viewer's open runs have somewhere to go that takes it. The owner: his ComfyUI (or its
 * placeholder results) is connected, and on the workers one of them runs it. A guest or an account: this install's GPUs
 * run it for them (hosted runs, src/lib/runnable-here.ts), or its own GPU is connected and, where its size is known, large
 * enough. Unknown: no. Nothing here is ever said to the viewer: where it can't run, the card just doesn't show.
 */
export function releaseRunsFor(o: { status: NudgeStatus | undefined; here: Here | null; model: Pick<ModelDef, "id" | "kind" | "engine"> | undefined; offered: boolean; vramGb?: number }): boolean {
  const { status: s, model } = o;
  if (!s || !model || model.engine !== "open" || !o.offered || s.engineMode === "cloud") return false;
  if (o.here && !runsHere(o.here, model)) return false;
  const v = s.viewer;
  if (!v) return openEngineReady(s);
  if (runsGoHere(v)) return true;
  if (!v.gpu.connected) return false;
  const need = o.vramGb ? minVramBytesFor(o.vramGb) : 0;
  return !v.gpu.vramBytes || v.gpu.vramBytes >= need;
}
