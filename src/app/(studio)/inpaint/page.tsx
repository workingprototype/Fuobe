import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { INPAINT_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Inpaint" };

export default function Page() {
  return <Studio config={INPAINT_STUDIO} />;
}
