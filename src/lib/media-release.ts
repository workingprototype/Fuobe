/**
 * Letting go of media elements the page created itself (color grading's detached <video>s and
 * WebGL canvases). Browsers keep decoding a detached video until its src is gone, and cap the
 * number of live WebGL contexts, so both are released explicitly.
 */

/** The parts of HTMLVideoElement this needs (a fake in tests). */
export interface ReleasableVideo {
  pause(): void;
  removeAttribute(name: string): void;
  load(): void;
}

/** Stop a detached video for good: pause it, drop its source and reset the element. */
export function releaseVideo(v: ReleasableVideo | null | undefined): void {
  if (!v) return;
  v.pause();
  v.removeAttribute("src");
  v.load();
}

/** Free a WebGL context now instead of waiting for garbage collection. */
export function loseContext(gl: Pick<WebGLRenderingContext, "getExtension"> | null | undefined): void {
  (gl?.getExtension("WEBGL_lose_context") as { loseContext(): void } | null | undefined)?.loseContext();
}
