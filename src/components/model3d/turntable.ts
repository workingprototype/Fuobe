"use client";

/**
 * Record a turntable video of a <model-viewer> in the browser: one full turn of the camera around the
 * model, captured from its canvas with MediaRecorder (WebM). For cloud 3D models that return only a .glb.
 */

/** The WebM codec the browser can record, or null. */
export function recordableType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

type ViewerElement = HTMLElement & { cameraOrbit: string; jumpCameraToGoal?: () => void; shadowRoot: ShadowRoot | null };

/** Degrees per second of the recorded turn; a full turn takes 360 / TURN_SPEED seconds. */
export const TURN_SPEED = 60;

export async function recordTurntable(viewer: ViewerElement, o: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<Blob> {
  const type = recordableType();
  if (!type) throw new Error("This browser can't record video — download the .glb instead");
  const canvas = viewer.shadowRoot?.querySelector("canvas");
  if (!canvas || !("captureStream" in canvas)) throw new Error("The 3D viewer isn't ready yet");
  const stream = (canvas as HTMLCanvasElement).captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  // Drive the camera ourselves: auto-rotate off, one turn at a steady speed.
  const auto = viewer.hasAttribute("auto-rotate");
  viewer.removeAttribute("auto-rotate");
  const parts = (viewer.cameraOrbit || "0deg 75deg 105%").split(/\s+/);
  const [, phi = "75deg", radius = "105%"] = parts;
  const seconds = 360 / TURN_SPEED;
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const done = t >= seconds || o.signal?.aborted;
      viewer.cameraOrbit = `${Math.min(360, t * TURN_SPEED)}deg ${phi} ${radius}`;
      viewer.jumpCameraToGoal?.();
      o.onProgress?.(Math.min(1, t / seconds));
      if (done) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  if (auto) viewer.setAttribute("auto-rotate", "");
  if (o.signal?.aborted) throw new Error("Stopped");
  return new Blob(chunks, { type: "video/webm" });
}
