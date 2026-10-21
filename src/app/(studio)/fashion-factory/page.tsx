import type { Metadata } from "next";
import { FashionView } from "@/components/fashion/fashion-view";

export const metadata: Metadata = { title: "Fashion Factory" };

export default function Page() {
  return <FashionView />;
}
