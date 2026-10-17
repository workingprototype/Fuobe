import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { MOTION_CONTROL_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Motion control" };

export default function Page() {
  return <Studio config={MOTION_CONTROL_STUDIO} />;
}
