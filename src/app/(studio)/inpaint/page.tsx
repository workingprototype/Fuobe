import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/studio-page";
import { INPAINT_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Inpaint" };

export default function Page() {
  return <StudioPage config={INPAINT_STUDIO} />;
}
