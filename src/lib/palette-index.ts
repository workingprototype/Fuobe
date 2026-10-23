/**
 * The slim catalog behind the ⌘K palette (GET /api/palette): names, categories and where each item
 * opens. Built on the server from the catalog, so the palette never ships prompt templates or routes.
 */
import { APPS, EFFECTS, MODELS, MOTIONS } from "@/lib/catalog";
import { OPERATION_LABELS, type ModelDef, type Preset } from "@/lib/catalog/types";
import type { PaletteIndex, PaletteModel, PalettePreset } from "@/lib/command-search";
import type { StudioConfig } from "@/components/studio/studio-context";
import {
  AUDIO_STUDIO,
  DIALOGUE_STUDIO,
  EDIT_STUDIO,
  EXTEND_STUDIO,
  FOLEY_STUDIO,
  IMAGE_STUDIO,
  INPAINT_STUDIO,
  LIPSYNC_STUDIO,
  MOTION_CONTROL_STUDIO,
  MUSIC_STUDIO,
  REFRAME_STUDIO,
  SFX_STUDIO,
  TRANSCRIBE_STUDIO,
  UPSCALE_STUDIO,
  VIDEO_EDIT_STUDIO,
  VIDEO_STUDIO,
  VIDEO_UPSCALE_STUDIO,
  VOICE_CHANGE_STUDIO,
} from "@/lib/studios";

/** Studios a model opens in (with ?model=), first match wins: the studio's picker lists its operation and kind. */
const MODEL_STUDIOS: [string, StudioConfig][] = [
  ["/image", IMAGE_STUDIO],
  ["/video", VIDEO_STUDIO],
  ["/edit", EDIT_STUDIO],
  ["/inpaint", INPAINT_STUDIO],
  ["/lipsync", LIPSYNC_STUDIO],
  ["/motion-control", MOTION_CONTROL_STUDIO],
  ["/video-edit", VIDEO_EDIT_STUDIO],
  ["/extend", EXTEND_STUDIO],
  ["/reframe", REFRAME_STUDIO],
  ["/upscale", UPSCALE_STUDIO],
  ["/upscale/video", VIDEO_UPSCALE_STUDIO],
  ["/audio", AUDIO_STUDIO],
  ["/audio/dialogue", DIALOGUE_STUDIO],
  ["/audio/voice-change", VOICE_CHANGE_STUDIO],
  ["/audio/transcribe", TRANSCRIBE_STUDIO],
  ["/audio/sfx", SFX_STUDIO],
  ["/audio/music", MUSIC_STUDIO],
  ["/audio/video", FOLEY_STUDIO],
];

/** Where a model opens: the first studio that offers it, else its row on the Models page. */
export function modelHref(m: ModelDef): string {
  const ops = new Set(m.routes.map((r) => r.op));
  const hit = MODEL_STUDIOS.find(([, c]) => c.kind === m.kind && (c.pickerOps ?? c.ops).some((op) => ops.has(op)));
  return hit ? `${hit[0]}?model=${encodeURIComponent(m.id)}` : `/models?q=${encodeURIComponent(m.name)}`;
}

const preset = (p: Preset): PalettePreset => ({ id: p.id, name: p.name, category: p.category, cloud: !!p.cloud, open: !!p.open });

const model = (m: ModelDef): PaletteModel => ({
  id: m.id,
  name: m.name,
  vendor: m.vendor,
  engine: m.engine,
  href: modelHref(m),
  ops: [...new Set(m.routes.map((r) => OPERATION_LABELS[r.op] ?? r.op))].join(", "),
});

export function paletteIndex(): PaletteIndex {
  return {
    apps: APPS.map(preset),
    motions: MOTIONS.map(preset),
    effects: EFFECTS.map(preset),
    // Chain helpers (hidden) aren't offered anywhere, so the palette leaves them out too.
    models: MODELS.filter((m) => !m.hidden).map(model),
  };
}
