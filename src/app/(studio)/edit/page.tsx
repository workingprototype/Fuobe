import type { Metadata } from "next";
import { StudioPage } from "@/components/studio/studio-page";
import { EDIT_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Edit image" };

export default function Page() {
  return <StudioPage config={EDIT_STUDIO} />;
}
