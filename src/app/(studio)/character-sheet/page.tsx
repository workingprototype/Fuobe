import type { Metadata } from "next";
import { CharacterSheetView } from "@/components/fashion/character-sheet";
import { castDefaults, SOUL_CAST_FIELDS } from "@/lib/catalog/cinema";
import type { CastFieldData } from "@/lib/catalog/packs";

export const metadata: Metadata = { title: "Character Sheet" };

/** Soul Cast's fields without their visibility functions (the page applies the same rules, castFieldVisible). */
const FIELDS: CastFieldData[] = SOUL_CAST_FIELDS.map(({ key, label, tab, question, kind, options, default: d, format, manual }) => ({
  key,
  label,
  tab,
  kind,
  options,
  ...(question && { question }),
  ...(d !== undefined && { default: d }),
  ...(format && { format }),
  ...(manual && { manual }),
}));

export default function Page() {
  return <CharacterSheetView fields={FIELDS} defaults={castDefaults()} />;
}
