import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/studio-page";
import { MOTION_CONTROL_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Motion control" };

export default function Page() {
  return <StudioPage config={MOTION_CONTROL_STUDIO} />;
}
