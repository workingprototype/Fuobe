/**
 * What you can do with one result, shared by feed tiles, the viewer and the Library, so the same
 * action is in the same place everywhere (U15). Pure: the UI maps ids to icons and handlers.
 *
 * placement: "primary" = the labelled pill (Animate / Extend …), "bar" = icon buttons on tiles
 * (Download, Favorite), "menu" = the ⋯ menu. The viewer shows them all as labelled buttons.
 */
import type { Generation, OutputFile } from "./catalog/types";
import { cueText, type Cue } from "./cues";
import { downloadHref, downloadName, extensionOf } from "./library";

export type OutputActionId =
  | "animate"
  | "edit"
  | "upscale"
  | "reference"
  | "grade"
  | "layers"
  | "save-character"
  | "extend"
  | "reframe"
  | "lipsync"
  | "add-sound"
  | "voice-change"
  | "copy-text"
  | "view-3d"
  | "download"
  | "download-txt"
  | "download-srt"
  | "download-vtt"
  | "download-all"
  | "favorite"
  | "finalize"
  | "compare"
  | "reuse"
  | "copy-prompt"
  | "pin"
  | "review"
  | "delete"
  | "delete-upload"
  | "restore"
  | "delete-forever";

export interface OutputAction {
  id: OutputActionId;
  label: string;
  placement: "primary" | "bar" | "menu";
  /** A page to hand the output to (open with prefetch off) or a file to download. */
  href?: string;
  /** Set on file links: the browser downloads instead of navigating. */
  download?: string;
  destructive?: boolean;
}

export interface ActionContext {
  /** The view can load the request back into a composer. */
  reuse?: boolean;
  /** The output has a source image to compare with (viewer only). */
  compare?: boolean;
  /** Shown in the viewer: actions that only open the viewer are left out. */
  inViewer?: boolean;
}

const q = (url: string) => encodeURIComponent(url);

/** Every action for output `index` of `g`, in display order. */
export function outputActions(g: Generation, index: number, ctx: ActionContext = {}): OutputAction[] {
  const o = g.outputs[index];
  if (!o) return [];
  const name = downloadName(g, o, index);
  const ext = extensionOf(o);
  const file: OutputAction = { id: "download", label: o.kind === "text" ? `Download .${ext}` : "Download", placement: "bar", href: downloadHref(o.url, name), download: name };
  if (g.deletedAt) {
    return [
      { id: "restore", label: "Restore", placement: "primary" },
      file,
      { id: "delete-forever", label: "Delete forever", placement: "menu", destructive: true },
    ];
  }
  const out: OutputAction[] = [];
  const link = (id: OutputActionId, label: string, href: string, placement: OutputAction["placement"] = "menu") => out.push({ id, label, href, placement });
  switch (o.kind) {
    case "image":
      if (isVector(g, o)) {
        // The hand-offs all send the picture to models that read pixels, and nothing rasterises an .svg on the way.
        out.push({ ...file, label: "Download .svg" }, { id: "favorite", label: g.favorite ? "Unfavorite" : "Favorite", placement: "bar" });
        break;
      }
      link("animate", "Animate", `/video?image=${q(o.url)}`, "primary");
      out.push(file, { id: "favorite", label: g.favorite ? "Unfavorite" : "Favorite", placement: "bar" });
      link("edit", "Edit", `/edit?image=${q(o.url)}`);
      link("upscale", "Upscale", `/upscale?image=${q(o.url)}`);
      link("reference", "Use as reference", `/image?ref=${q(o.url)}`);
      link("grade", "Color grade", `/color-grade?image=${q(o.url)}`);
      link("layers", "Open in Layers", layersHref(g, o.url));
      out.push({ id: "save-character", label: "Save as character", placement: "menu" });
      break;
    case "video":
      link("extend", "Extend", `/extend?video=${q(o.url)}`, "primary");
      out.push(file, { id: "favorite", label: g.favorite ? "Unfavorite" : "Favorite", placement: "bar" });
      link("reframe", "Reframe", `/reframe?video=${q(o.url)}`);
      link("lipsync", "Lipsync", `/lipsync?video=${q(o.url)}`);
      link("upscale", "Upscale", `/upscale/video?video=${q(o.url)}`);
      link("add-sound", "Add sound", `/audio/video?video=${q(o.url)}`);
      link("grade", "Color grade", `/color-grade?video=${q(o.url)}`);
      break;
    case "audio":
      link("lipsync", "Lipsync", `/lipsync?audio=${q(o.url)}`, "primary");
      out.push(file, { id: "favorite", label: g.favorite ? "Unfavorite" : "Favorite", placement: "bar" });
      link("voice-change", "Change voice", `/audio/voice-change?audio=${q(o.url)}`);
      break;
    case "text":
      out.push({ id: "copy-text", label: "Copy", placement: "primary" }, file, { id: "favorite", label: g.favorite ? "Unfavorite" : "Favorite", placement: "bar" });
      if (ext !== "txt" && o.text) out.push({ id: "download-txt", label: "Download .txt", placement: "menu" });
      if (cuesOf(o).length) {
        if (ext !== "srt") out.push({ id: "download-srt", label: "Download .srt", placement: "menu" });
        if (ext !== "vtt") out.push({ id: "download-vtt", label: "Download .vtt", placement: "menu" });
      }
      break;
    case "model3d":
      if (!ctx.inViewer) out.push({ id: "view-3d", label: "View in 3D", placement: "primary" });
      out.push({ ...file, label: `Download .${ext}` }, { id: "favorite", label: g.favorite ? "Unfavorite" : "Favorite", placement: "bar" });
      break;
  }
  // Uploads (the Library's Uploads tab) are files, not generations: hand-offs, download, and a
  // delete that first checks nothing uses the file.
  if (g.feature === "upload") return [...out.filter((a) => a.id !== "favorite"), { id: "delete-upload", label: "Delete", placement: "menu", destructive: true }];
  if (g.outputs.length > 1) out.push({ id: "download-all", label: `Download all ${g.outputs.length} (.zip)`, placement: "menu", href: `/api/generations/zip?ids=${g.id}`, download: "" });
  if (o.draftId) out.push({ id: "finalize", label: "Render this draft in 1080p", placement: "menu" });
  if (ctx.compare) out.push({ id: "compare", label: "Compare with original", placement: "menu" });
  if (ctx.reuse) out.push({ id: "reuse", label: "Reuse settings", placement: "menu" });
  if (g.prompt) out.push({ id: "copy-prompt", label: "Copy prompt", placement: "menu" });
  // Library: pinned results stay at the top of their view; the review status is a sub-menu of its own.
  out.push({ id: "pin", label: g.pinnedAt ? "Unpin" : "Pin to top", placement: "menu" }, { id: "review", label: "Review status", placement: "menu" });
  out.push({ id: "delete", label: "Delete", placement: "menu", destructive: true });
  return out;
}

/** The hand-offs offered as next steps under a fresh result, best first (UX-18). */
const NEXT_STEPS: Partial<Record<OutputFile["kind"], OutputActionId[]>> = {
  image: ["animate", "upscale", "edit"],
  video: ["extend", "upscale", "add-sound"],
  audio: ["lipsync", "voice-change"],
};

/**
 * Up to `max` next steps for output `index` (Animate, Upscale, Edit for a picture), taken from
 * outputActions so they go where the tile's own actions go. Only hand-offs to another studio.
 */
export function nextSteps(g: Generation, index: number, max = 3): OutputAction[] {
  const o = g.outputs[index];
  if (!o || g.status !== "succeeded") return [];
  const all = outputActions(g, index);
  return (NEXT_STEPS[o.kind] ?? [])
    .map((id) => all.find((a) => a.id === id && a.href))
    .filter((a): a is OutputAction => !!a)
    .slice(0, max);
}

/**
 * A vector result (an SVG: Vectorize, Recraft's vector styles, an uploaded .svg). Demo pictures are
 * SVG placeholders standing in for raster results, so they keep the raster hand-offs (except Vectorize's).
 */
export function isVector(g: Pick<Generation, "provider" | "op">, o: Pick<OutputFile, "url" | "kind" | "contentType">): boolean {
  if (o.kind !== "image") return false;
  const svg = /^image\/svg\+xml\b/i.test(o.contentType ?? "") || o.url.startsWith("data:image/svg+xml") || extensionOf(o) === "svg";
  return svg && (g.provider !== "mock" || g.op === "vectorize");
}

/**
 * Open an image in the Layers editor (/layers?image=…). A layers result opens with its layers
 * already split, on the picture it was made from.
 */
export function layersHref(g: Pick<Generation, "id" | "op" | "status" | "request">, url: string): string {
  const source = g.request?.inputs?.images?.[0];
  if (g.op === "layers" && g.status === "succeeded" && source?.startsWith("/api/files/")) return `/layers?image=${q(source)}&generation=${g.id}`;
  return `/layers?image=${q(url)}`;
}

// ---------------------------------------------------------------------------
// Text, layers and 3D outputs

/** Timed lines of a transcript (OutputFile.meta.cues, seconds; SRT / VTT writers in src/lib/cues.ts). */
export function cuesOf(o: Pick<OutputFile, "meta">): Cue[] {
  const cues = o.meta?.cues;
  if (!Array.isArray(cues)) return [];
  return cues.filter((c): c is Cue => !!c && typeof c === "object" && typeof c.start === "number" && typeof c.end === "number" && typeof c.text === "string");
}

/** 75.5 → "1:15.5": the viewer's short timing (files use the SRT / VTT stamps). */
export function cueTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const tenths = Math.floor((ms % 1000) / 100);
  return `${h ? `${h}:${p(m)}` : m}:${p(sec)}${tenths ? `.${tenths}` : ""}`;
}

/** The text of a text output: OutputFile.text, else the cues joined. */
export function textOf(o: Pick<OutputFile, "text" | "meta">): string {
  return o.text ?? cueText(cuesOf(o));
}

/**
 * The outputs a result shows as tiles (and the viewer browses): a 3D model's turntable video is
 * its preview, not a result of its own.
 */
export function shownOutputs(g: Pick<Generation, "kind" | "outputs">): number[] {
  const all = g.outputs.map((_, i) => i);
  if (g.kind !== "model3d") return all;
  const own = all.filter((i) => g.outputs[i].kind === "model3d");
  return own.length ? own : all;
}

/** A layer's name and stacking order (meta.name / meta.z, or meta.layer.{name,z}). */
export function layerInfo(o: Pick<OutputFile, "meta">, index: number): { name: string; z: number } {
  const m = (o.meta ?? {}) as Record<string, unknown>;
  const layer = (m.layer && typeof m.layer === "object" ? m.layer : {}) as Record<string, unknown>;
  const name = typeof m.name === "string" ? m.name : typeof layer.name === "string" ? layer.name : index === 0 ? "Background" : `Layer ${index + 1}`;
  const z = typeof m.z === "number" ? m.z : typeof layer.z === "number" ? layer.z : index;
  return { name, z };
}

/** A generation whose outputs are the layers of one picture (Layers, text layers). */
export function isLayered(g: Pick<Generation, "op" | "outputs">): boolean {
  return (g.op === "layers" || g.op === "text-layers" || g.outputs.some((o) => !!(o.meta && ("layer" in o.meta || "z" in o.meta)))) && g.outputs.length > 1;
}

/** A 3D model's still and turntable: meta.poster / meta.preview, meta.video / meta.turntable, or a sibling output. */
export function modelPreview(g: Pick<Generation, "outputs">, o: OutputFile): { poster?: string; video?: string } {
  const m = (o.meta ?? {}) as Record<string, unknown>;
  const str = (...keys: string[]) => keys.map((k) => m[k]).find((v): v is string => typeof v === "string" && v.length > 0);
  return {
    poster: str("poster", "preview", "thumbnail", "image") ?? g.outputs.find((x) => x.kind === "image")?.url,
    video: str("video", "turntable") ?? g.outputs.find((x) => x.kind === "video")?.url,
  };
}
