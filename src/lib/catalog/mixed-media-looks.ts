/**
 * Fuobe Mixed Media's look LoRAs (build plan O9): a Mixed Media preset id → the Z-Image LoRAs its frames are drawn with,
 * from the research (studios[mixed-media].original.looks) through the LoRA library (pinned downloads, licences).
 * 14 of the 33 looks have one; the rest run on their words. Unverified until the evaluation harness measures each.
 *
 * Kept apart from mixed-media.ts so the studio page doesn't ship the LoRA library: the server (and DoP's Mixed Media
 * effects) hand the planner the LoRAs a run can reach.
 */
import { MIXED_MEDIA_LOOK_LORAS } from "./lora-library.generated";
import { loraEntry, loraRef } from "./loras";
import type { LoraRef } from "./types";

export function mixedLoras(presetId: string): LoraRef[] {
  return (MIXED_MEDIA_LOOK_LORAS[presetId] ?? []).flatMap((l) => {
    const e = loraEntry(l.key);
    return e ? [loraRef(e, l.strength)] : [];
  });
}
