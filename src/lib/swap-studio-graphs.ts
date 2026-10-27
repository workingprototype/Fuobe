/**
 * Character Swap Studio's two ComfyUI graphs, rewritten per job (pure, so the tests run them on the real files). The
 * graphs carry every branch a job can use, connected; a job that has no anchor, no history or no version to correct
 * loses those branches here, and the branches a job adds (the approved mask, the anchor as Picture 3, blank frames
 * before a mask that starts mid-shot) are inserted here. See video-character-swap-h3-segment and video-mask-h3-relay
 * in scripts/comfy/library.spec.mjs.
 */
import { cloneWorkflow, dropUnused, type ComfyWorkflow } from "./comfy";

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

export interface SegmentGraphOptions {
  /** An anchor image went in (image2). */
  anchor: boolean;
  /** The previous take's master went in (historyVideo). */
  history: boolean;
  /** With history and an anchor: the anchor is Picture 3, after the generated boundary. */
  anchorAfterHistory?: boolean;
  /** The approved mask: its ComfyUI input name, where the segment starts in it (seconds) and how long it is. */
  mask?: { file: string; start: number; duration: number } | null;
  /** Masked generation off: the whole frame is regenerated (the edit mask is bypassed). */
  useMask: boolean;
  /**
   * The lossless master keeps the take's last `frames` frames from `from` on (what the next segment reads as history):
   * a 16-bit master of the whole segment is hundreds of MB, more than ComfyUI takes as an upload by default.
   */
  masterTail?: { from: number; frames: number } | null;
  /** Output nodes (never dropped). */
  outputs: string[];
}

/**
 * One segment's graph: without history the plan, the window and the append lose their initial history (and its
 * loader goes); without an anchor and without history Picture 2 and the first-frame guide go too (the window's anchor
 * would otherwise be the clip's own first frame). With both, the anchor moves to Picture 3 at the canvas size and the
 * window's anchor output is the boundary. An approved mask replaces SAM's chain; masked generation off bypasses the
 * edit mask and SAM altogether. The master saves only the frames the next segment can read (masterTail).
 */
export function segmentGraph(wf: ComfyWorkflow, o: SegmentGraphOptions): ComfyWorkflow {
  const out = cloneWorkflow(wf);
  if (!o.history) for (const id of ["plan", "window", "append"]) if (out[id]) delete out[id].inputs.initial_history;
  const anchor = o.anchor && !!out.anchor_image;
  const cond = out.reference_conditioning?.inputs;
  if (cond) {
    if (!anchor && !o.history) {
      delete cond["ref_images.ref_image_1"];
      if (out.history) out.history.inputs.first_frame_guide = false;
    } else if (anchor && o.history && o.anchorAfterHistory) {
      out.anchor_fit = { class_type: "ImageScale", inputs: { image: ["anchor_image", 0], upscale_method: "lanczos", width: ["dimensions", 0], height: ["dimensions", 1], crop: "center" }, _meta: { title: "Anchor (Picture 3) at the canvas size" } };
      cond["ref_images.ref_image_2"] = ["anchor_fit", 0];
      if (out.window) delete out.window.inputs.anchor;
    }
  }
  if (!o.useMask) {
    // Readers of the edit mask read its latent instead, and nothing asks SAM for a mask.
    const src = out.edit_mask?.inputs.latent;
    if (isLink(src)) {
      for (const n of Object.values(out)) for (const [k, v] of Object.entries(n.inputs)) if (isLink(v) && v[0] === "edit_mask") n.inputs[k] = [...src];
      delete out.edit_mask;
    }
    if (out.window) delete out.window.inputs.mask;
  } else if (o.mask && out.expand_mask) {
    out.mask_source = { class_type: "LoadVideo", inputs: { file: o.mask.file }, _meta: { title: "Approved mask (the shot)" } };
    out.mask_trim = { class_type: "Video Slice", inputs: { video: ["mask_source", 0], start_time: o.mask.start, duration: o.mask.duration, strict_duration: false } };
    out.mask_components = { class_type: "GetVideoComponents", inputs: { video: ["mask_trim", 0] } };
    out.mask_fit = { class_type: "ImageScale", inputs: { image: ["mask_components", 0], upscale_method: "nearest-exact", width: ["dimensions", 0], height: ["dimensions", 1], crop: "center" } };
    out.mask_channel = { class_type: "ImageToMask", inputs: { image: ["mask_fit", 0], channel: "red" } };
    out.expand_mask.inputs.masks = ["mask_channel", 0];
  }
  const save = out.save_master?.inputs;
  if (o.masterTail && save && isLink(save.images)) {
    out.master_tail = { class_type: "ImageFromBatch", inputs: { image: [...save.images], batch_index: o.masterTail.from, length: o.masterTail.frames }, _meta: { title: "The take's last frames (the next segment's history)" } };
    save.images = ["master_tail", 0];
  }
  return dropUnused(out, o.outputs);
}

export interface MaskGraphOptions {
  /** Frames of the corrected version before the new part (0: none). */
  head: number;
  /** Frames of it after the new part (0: none). */
  tail: number;
  /** A version to correct went in (prevMask). */
  prev: boolean;
  outputs: string[];
}

/**
 * A mask job's graph: the new part alone, or spliced between the corrected version's frames before and after it.
 * A track that starts mid-shot with nothing to correct gets blank frames before it (no person: generating those frames
 * would stop with "SAM lost the selected person", as Akatz's empty frames block rendering).
 */
export function maskGraph(wf: ComfyWorkflow, o: MaskGraphOptions): ComfyWorkflow {
  const out = cloneWorkflow(wf);
  const head = o.head > 0;
  const tail = o.tail > 0 && o.prev;
  if (head && !o.prev) {
    out.head_blank = { class_type: "EmptyImage", inputs: { width: ["dimensions", 0], height: ["dimensions", 1], batch_size: o.head, color: 0 }, _meta: { title: "Before the new part (no mask yet)" } };
    if (out.join_head) out.join_head.inputs.image1 = ["head_blank", 0];
  }
  const before = head ? "join_head" : "new_images";
  if (tail) {
    if (out.join_tail) out.join_tail.inputs.image1 = [before, 0];
  } else if (out.video) out.video.inputs.images = [before, 0];
  return dropUnused(out, o.outputs);
}
