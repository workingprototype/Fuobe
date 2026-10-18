import type { Metadata } from "next";
import { ShortsStudio } from "@/components/shorts/shorts-studio";
import { SHORTS_MODELS } from "@/lib/catalog/shorts";
import { modelInfos } from "@/lib/catalog/shorts-models";

export const metadata: Metadata = { title: "Shorts Studio" };

/** The restyle models per engine, slimmed on the server so the page ships no catalog. */
const MODELS = { cloud: modelInfos(SHORTS_MODELS.cloud), open: modelInfos(SHORTS_MODELS.open) };

export default function Page() {
  return <ShortsStudio models={MODELS} />;
}
