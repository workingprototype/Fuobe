"use client";

import { Brush, PenLine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SketchEditor, type SketchMode } from "./sketch-editor";
import { useStudio } from "./studio-context";

/** "Paint area" / "Draw" buttons next to the first image, and the resulting drawing chip. */
export function SketchTools({ modes, image, autoOpen }: { modes: SketchMode[]; image: string; autoOpen?: SketchMode }) {
  const { draft, setDraft } = useStudio();
  const [editing, setEditing] = useState<SketchMode | null>(null);
  const opened = useRef<string | null>(null);
  const current = draft.slots.sketch;
  const mode: SketchMode | null = draft.slots.mask?.ref ? "mask" : current?.ref ? "draw" : null;

  useEffect(() => {
    if (autoOpen && !current && opened.current !== image) {
      opened.current = image;
      setEditing(autoOpen);
    }
  }, [autoOpen, image, current]);

  const clear = () =>
    setDraft((d) => {
      const extra = { ...d.params.extra };
      delete extra.motionPaths;
      return { slots: { ...d.slots, mask: null, sketch: null }, params: { ...d.params, extra } };
    });

  return (
    <>
      {current?.ref ? (
        <div className="group/slot relative size-14 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setEditing(mode)}
                className="size-full overflow-hidden rounded-xl border-2 border-primary bg-muted"
                aria-label={mode === "mask" ? "Edit the painted area" : "Edit the drawing"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={current.preview} alt="" className="size-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-primary/90 py-px text-center text-[9px] font-semibold text-primary-foreground">
                  {mode === "mask" ? "Area" : "Drawing"}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{mode === "mask" ? "Touch up the painted area" : "Touch up the drawing"}</TooltipContent>
          </Tooltip>
          <button
            onClick={clear}
            className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-soft"
            aria-label="Remove drawing"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        modes.map((m) => (
          <Tooltip key={m}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setEditing(m)}
                // Generate points here when the painted area is what it's waiting for.
                data-slot-key={m === "mask" ? "mask" : "sketch"}
                className="flex size-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-primary/50 bg-brand-faint text-brand-text transition-colors hover:border-primary"
              >
                {m === "mask" ? <Brush className="size-4" /> : <PenLine className="size-4" />}
                <span className="text-[10px] leading-none font-medium">{m === "mask" ? "Paint area" : "Draw"}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{m === "mask" ? "Brush over what should change (inpaint)" : "Sketch arrows and notes for the model to follow"}</TooltipContent>
          </Tooltip>
        ))
      )}
      {editing && (
        <SketchEditor
          open
          onOpenChange={(o) => !o && setEditing(null)}
          image={image}
          mode={editing}
          // Reopen the earlier strokes so a touch-up adds to the drawing instead of replacing it.
          initialStrokes={current?.sketch?.mode === editing ? current.sketch.strokes : undefined}
          onDone={(r) =>
            setDraft((d) => {
              const extra = { ...d.params.extra };
              if (r.motion?.paths.length) extra.motionPaths = r.motion;
              else delete extra.motionPaths;
              return {
                slots: {
                  ...d.slots,
                  mask: r.mask ? { ref: r.mask, preview: r.preview, kind: "image" } : null,
                  sketch: { ref: r.overlay, preview: r.preview, kind: "image", sketch: { mode: editing, strokes: r.strokes } },
                },
                params: { ...d.params, extra },
              };
            })
          }
        />
      )}
    </>
  );
}
