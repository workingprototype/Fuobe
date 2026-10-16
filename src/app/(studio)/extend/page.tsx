import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/studio-page";
import { EXTEND_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Extend video" };

export default function Page() {
  return <StudioPage config={EXTEND_STUDIO} />;
}
