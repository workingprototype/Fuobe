import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/studio-page";
import { VIDEO_EDIT_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Edit video" };

export default function Page() {
  return <StudioPage config={VIDEO_EDIT_STUDIO} />;
}
