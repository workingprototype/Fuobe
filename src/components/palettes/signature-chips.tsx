"use client";

import { Images, Palette as PaletteIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Chip, ClearableChip } from "@/components/studio/chip";
import { ResponsivePanel } from "@/components/studio/responsive-panel";
import { CuratedCover } from "@/components/moodboards/cards";
import { useMoodboards } from "@/components/moodboards/hooks";
import { curatedPick, soulPick, toPick } from "@/components/moodboards/logic";
import { MoodboardPanel } from "@/components/moodboards/moodboard-panel";
import { cardStrip, type MoodboardPick, type Signature } from "@/lib/catalog/palettes";
import { hueOf } from "@/lib/catalog/packs";
import type { Engine } from "@/lib/catalog/types";
import { ColorSignaturePanel, toPalettePick } from "./color-signature-panel";
import { usePalettes } from "./hooks";
import { SwatchDot } from "./palette-card";

/**
 * Hand-offs into the Image studio: /image?moodboard=<id> (or curated:<id>) and /image?palette=<id>
 * pick them once, as soon as the lists are known.
 */
function UrlSignature({ onChange }: { onChange: (update: (s: Signature | undefined) => Signature) => void }) {
  const sp = useSearchParams();
  const mb = sp.get("moodboard");
  const pal = sp.get("palette");
  const boards = useMoodboards(!!mb);
  const palettes = usePalettes(!!pal);
  const done = useRef({ mb: false, pal: false });
  useEffect(() => {
    if (mb && !done.current.mb && boards.data) {
      done.current.mb = true;
      const curated = boards.data.curated.find((c) => c.id === mb.replace(/^curated:/, ""));
      const mine = boards.data.items.find((m) => m.id === mb);
      const pick = mine ? toPick(mine) : curated ? curatedPick(curated) : mb.startsWith("curated:") ? soulPick(mb.slice(8)) : undefined;
      if (pick) onChange((s) => ({ ...s, moodboard: pick }));
    }
  }, [mb, boards.data, onChange]);
  useEffect(() => {
    if (pal && !done.current.pal && palettes.items) {
      done.current.pal = true;
      const p = palettes.items.find((x) => x.id === pal);
      if (p) onChange((s) => ({ ...s, palette: toPalettePick(p) }));
    }
  }, [pal, palettes.items, onChange]);
  return null;
}

/**
 * The Image studio's style signature chips: Color signature (a saved palette) and Moodboard. Each
 * opens a popover on desktop and a bottom sheet on phones; the choice lives in the composer's draft.
 */
export default function SignatureChips({
  value,
  onChange,
  engine,
  modelId,
  styleId,
  onStyleIdTaken,
}: {
  value: Signature | undefined;
  onChange: (update: (s: Signature | undefined) => Signature) => void;
  engine: Engine;
  /** The composer's model (the Moodboard panel opens on Soul's styles for Soul). */
  modelId?: string;
  /** A Soul `style_id` in the draft's settings (a reused Soul run): shown and kept as the Moodboard pick. */
  styleId?: string;
  onStyleIdTaken?: () => void;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const pal = value?.palette;
  const mb = value?.moodboard;
  // Soul's style picker is this chip: a style id restored by Reuse becomes the curated pick (a picked moodboard wins).
  useEffect(() => {
    if (!styleId) return;
    // A live Higgsfield style the built-in list doesn't know still shows (and clears) as one.
    const pick: MoodboardPick = soulPick(styleId) ?? { id: styleId, kind: "curated", name: "Soul style", status: "complete", ...(modelId === "soul-1" && { source: "soul-v1" as const }) };
    onChange((s) => (s?.moodboard ? { ...s } : { ...s, moodboard: pick }));
    onStyleIdTaken?.();
  }, [styleId, modelId, onChange, onStyleIdTaken]);
  return (
    <>
      <Suspense fallback={null}>
        <UrlSignature onChange={onChange} />
      </Suspense>
      <ClearableChip active={!!pal} onClear={() => onChange((s) => ({ ...s, palette: undefined }))} clearLabel="Clear color signature">
        <ResponsivePanel
          open={colorOpen}
          onOpenChange={setColorOpen}
          title="Color signature"
          tooltip="Color signature"
          className="w-[min(92vw,440px)]"
          trigger={
            <Chip icon={pal ? undefined : PaletteIcon} active={!!pal} aria-label={pal ? `Color signature: ${pal.name}` : "Color signature"}>
              {pal && <SwatchDot colors={cardStrip(pal)} />}
              <span className="max-w-32 truncate">{pal ? pal.name : "Color"}</span>
            </Chip>
          }
        >
          <ColorSignaturePanel
            value={pal}
            engine={engine}
            onPick={(p) => {
              onChange((s) => ({ ...s, palette: p }));
              // Toggling the lock keeps the panel open; picking a palette closes it.
              if (!p || p.id !== pal?.id) setColorOpen(false);
            }}
          />
        </ResponsivePanel>
      </ClearableChip>
      <ClearableChip active={!!mb} onClear={() => onChange((s) => ({ ...s, moodboard: undefined }))} clearLabel="Clear moodboard">
        <ResponsivePanel
          open={boardOpen}
          onOpenChange={setBoardOpen}
          title="Moodboard"
          tooltip="Moodboard"
          className="w-[min(92vw,460px)]"
          trigger={
            <Chip icon={mb ? undefined : Images} active={!!mb} aria-label={mb ? `Moodboard: ${mb.name}` : "Moodboard"}>
              {mb &&
                (mb.kind === "curated" ? (
                  <CuratedCover m={{ name: "", hue: hueOf(mb.id) }} className="size-4 rounded-full" />
                ) : mb.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mb.cover} alt="" className="size-4 rounded-full object-cover" />
                ) : null)}
              <span className="max-w-32 truncate">{mb ? mb.name : "Moodboard"}</span>
            </Chip>
          }
        >
          <MoodboardPanel
            value={mb}
            modelId={modelId}
            onPick={(m) => {
              onChange((s) => ({ ...s, moodboard: m }));
              setBoardOpen(false);
            }}
          />
        </ResponsivePanel>
      </ClearableChip>
    </>
  );
}
