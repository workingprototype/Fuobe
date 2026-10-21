import type { Engine, Generation, GenerationRequest } from "@/lib/catalog/types";

/**
 * Image to 3D / Product spin: which model, and what a finished job gives the viewer — the .glb, a
 * turntable video (TRELLIS.2 renders one; for models that return only a mesh the page records one in
 * the browser), a poster, the source photo — and where "Animate the spin" goes next.
 */
export const MODEL3D_FEATURE = "image-to-3d";

export const MODELS_3D: Record<Engine, { id: string; note: string }[]> = {
  cloud: [
    { id: "hunyuan-3d-3-1-pro", note: "Textured, game-ready · ≈ $0.38" },
    { id: "hunyuan-3d-3-1-rapid", note: "Faster single view · ≈ $0.23" },
    { id: "trellis-2", note: "Detailed geometry · ≈ $0.30" },
    { id: "tripo-h3-1", note: "Clean topology, PBR · ≈ $0.30" },
    { id: "meshy-7-1", note: "Textured, optional rigging · ≈ $1.20" },
  ],
  open: [
    { id: "oss-trellis2", note: "Textured GLB + turntable video · 16 GB GPU · MIT" },
    { id: "oss-hunyuan3d-21", note: "Shape only · 10 GB GPU" },
  ],
};

export function model3dRequest(o: { engine: Engine; photo: string; modelId?: string }): GenerationRequest {
  const id = o.modelId && MODELS_3D[o.engine].some((m) => m.id === o.modelId) ? o.modelId : MODELS_3D[o.engine][0].id;
  return { feature: MODEL3D_FEATURE, modelId: id, op: "image-to-3d", inputs: { images: [o.photo] } };
}

export interface Model3dView {
  glb?: string;
  /** A rendered turntable that came with the model (TRELLIS.2 open, demo). */
  turntable?: string;
  poster?: string;
  /** The product photo it was made from. */
  photo?: string;
  /** Other formats the provider returned (OBJ, FBX, USDZ…), by extension. */
  formats: Record<string, string>;
}

export function model3dView(g: Pick<Generation, "outputs" | "request">): Model3dView {
  const mesh = g.outputs.find((o) => o.kind === "model3d");
  const meta = (mesh?.meta ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const videos = g.outputs.filter((o) => o.kind === "video");
  const video = videos.find((o) => o.meta?.role === "turntable" || o.meta?.turntable) ?? videos[0];
  const formats: Record<string, string> = {};
  const listed = meta.formats;
  if (listed && typeof listed === "object") for (const [k, v] of Object.entries(listed as Record<string, unknown>)) if (typeof v === "string") formats[k.toLowerCase()] = v;
  return {
    glb: mesh?.url,
    turntable: str(meta.turntable) ?? str(meta.video) ?? video?.url,
    poster: str(meta.preview) ?? str(meta.poster) ?? g.outputs.find((o) => o.kind === "image")?.url,
    photo: g.request.inputs?.images?.[0],
    formats,
  };
}

const SPIN_PROMPT = "The product rotates slowly 360 degrees on a turntable in a clean studio, soft key light sweeping across it, the design and label stay exactly the same";

/** "Animate the spin": restyle the turntable into a finished shot (Edit video), or animate the photo (Video). */
export function animateSpinHref(v: Model3dView, turntable?: string): string | null {
  const clip = turntable ?? v.turntable;
  if (clip) return `/video-edit?${new URLSearchParams({ video: clip, prompt: "Turn this product turntable into a premium commercial shot: studio lighting, soft reflections, a clean seamless backdrop; keep the product and its rotation exactly" })}`;
  if (v.photo) return `/video?${new URLSearchParams({ image: v.photo, prompt: SPIN_PROMPT })}`;
  return null;
}
