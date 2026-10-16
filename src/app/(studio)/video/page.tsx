import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/studio-page";
import { VIDEO_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Create video" };

export default function Page() {
  return <StudioPage config={VIDEO_STUDIO} />;
}
