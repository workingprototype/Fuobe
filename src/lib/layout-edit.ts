/*
 * Box maths for the Layout editor (src/components/studio/layout-editor.tsx): drawing, picking, moving, resizing and
 * nudging boxes on a canvas of the size the model renders. Pure. Boxes are LayoutBox fractions ([x0, y0, x1, y1] of the
 * canvas); the editing happens in the canvas's own pixels, so a box snaps to whole pixels of the picture made (the
 * Layers editor's rectFrom and resizeBox, src/lib/layers.ts).
 */
import { rectFrom, resizeBox, type Handle } from "./layers";
import type { LayoutBox } from "./layout-prompt";

export type { Handle };

/** The smallest box the editor draws, in canvas pixels (a click that barely moves is a click, not a box). */
export const MIN_BOX_PX = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number) => Math.round(v * 1e6) / 1e6;
const toBox = (x: number, y: number, w: number, h: number, width: number, height: number): LayoutBox => [snap(x / width), snap(y / height), snap((x + w) / width), snap((y + h) / height)];

/** A box drawn from one corner to the other (canvas pixels), kept inside the canvas; null when smaller than MIN_BOX_PX. */
export function drawnBox(x0: number, y0: number, x1: number, y1: number, width: number, height: number): LayoutBox | null {
  const r = rectFrom(x0, y0, x1, y1, { width, height }, MIN_BOX_PX);
  return r ? toBox(r[0], r[1], r[2], r[3], width, height) : null;
}

/** The boxes under a point (fractions), the one drawn last (on top) first. */
export function boxesAt(boxes: LayoutBox[], fx: number, fy: number): number[] {
  const out: number[] = [];
  for (let i = boxes.length - 1; i >= 0; i--) {
    const [x0, y0, x1, y1] = boxes[i];
    if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) out.push(i);
  }
  return out;
}

/**
 * Which box a press picks among the stack under it: pressing the same spot again (`again`, after a press that didn't
 * drag) steps to the next box down the stack, round to the top (LinXce's editor does this); otherwise the selected box
 * stays picked when it is in the stack (so it can be dragged out from under another), else the top one.
 */
export function pickBox(stack: number[], selected: number | null, again: boolean): number | null {
  if (!stack.length) return null;
  const at = selected === null ? -1 : stack.indexOf(selected);
  if (again && at >= 0) return stack[(at + 1) % stack.length];
  return at >= 0 ? selected : stack[0];
}

/** A box moved by dx, dy canvas pixels, kept whole inside the canvas. */
export function movedBox(box: LayoutBox, dx: number, dy: number, width: number, height: number): LayoutBox {
  const [x0, y0, x1, y1] = box;
  const w = (x1 - x0) * width;
  const h = (y1 - y0) * height;
  const x = clamp(x0 * width + dx, 0, Math.max(0, width - w));
  const y = clamp(y0 * height + dy, 0, Math.max(0, height - h));
  return toBox(Math.round(x), Math.round(y), Math.round(w), Math.round(h), width, height);
}

/**
 * A box resized by dragging one of its handles dx, dy canvas pixels: the opposite edge or corner stays put, corners
 * resize freely (resizeBox, unrotated), no side below MIN_BOX_PX, and the box stays inside the canvas.
 */
export function resizedBox(box: LayoutBox, handle: Handle, dx: number, dy: number, width: number, height: number): LayoutBox {
  const [x0, y0, x1, y1] = box;
  const node = { x: x0 * width, y: y0 * height, w: (x1 - x0) * width, h: (y1 - y0) * height, rotation: 0 };
  const r = resizeBox(node, handle, dx, dy, true);
  // Held at the canvas edges and the minimum size, the opposite side where it was.
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (handle.includes("w")) left = clamp(left, 0, right - MIN_BOX_PX);
  if (handle.includes("e")) right = clamp(right, left + MIN_BOX_PX, width);
  if (handle.includes("n")) top = clamp(top, 0, bottom - MIN_BOX_PX);
  if (handle.includes("s")) bottom = clamp(bottom, top + MIN_BOX_PX, height);
  const [l, t, rr, b] = [left, top, right, bottom].map(Math.round);
  return toBox(l, t, rr - l, b - t, width, height);
}

/** Arrow keys: one canvas pixel a press, ten with Shift. */
export function nudgedBox(box: LayoutBox, key: string, shift: boolean, width: number, height: number): LayoutBox | null {
  const step = shift ? 10 : 1;
  const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[key];
  return d ? movedBox(box, d[0], d[1], width, height) : null;
}

/** A new box in the middle of the canvas, for the keyboard (Add box): a third of each side, nudged down for each one already there. */
export function newBox(count: number): LayoutBox {
  const off = Math.min(0.3, (count % 6) * 0.05);
  return [snap(1 / 3 + off / 2), snap(1 / 3 + off), snap(2 / 3 + off / 2), snap(2 / 3 + off)].map((v) => Math.min(1, v)) as LayoutBox;
}
