import type { Metadata } from "next";
import { ElementsView } from "@/components/elements-view";

export const metadata: Metadata = { title: "Elements" };

export default function Page() {
  return <ElementsView />;
}
