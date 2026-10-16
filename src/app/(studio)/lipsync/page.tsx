import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/studio-page";
import { LIPSYNC_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Lipsync & avatars" };

export default function Page() {
  return <StudioPage config={LIPSYNC_STUDIO} />;
}
