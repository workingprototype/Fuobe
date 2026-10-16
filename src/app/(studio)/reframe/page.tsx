import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/studio-page";
import { REFRAME_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Reframe" };

export default function Page() {
  return <StudioPage config={REFRAME_STUDIO} />;
}
