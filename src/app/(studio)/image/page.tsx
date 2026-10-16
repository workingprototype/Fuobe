import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/studio-page";
import { IMAGE_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Create image" };

export default function Page() {
  return <StudioPage config={IMAGE_STUDIO} />;
}
