import type { Metadata } from "next";
import { MixedStudio } from "@/components/mixed-media/mixed-studio";
import { MIXED_FRAME_MODELS, MIXED_MODELS } from "@/lib/catalog/mixed-media";
import { modelInfos } from "@/lib/catalog/shorts-models";

export const metadata: Metadata = { title: "Mixed Media" };

/** The restyle models per engine (cloud: Fast), slimmed on the server so the page ships no catalog. */
const MODELS = { cloud: modelInfos(MIXED_MODELS.cloud), open: modelInfos(MIXED_MODELS.open) };
/** The cloud image editors that redraw each frame (Per frame). */
const FRAME_MODELS = modelInfos([...MIXED_FRAME_MODELS]);

export default function Page() {
  return <MixedStudio models={MODELS} frameModels={FRAME_MODELS} />;
}
