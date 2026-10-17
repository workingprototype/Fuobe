import type { Metadata } from "next";
import { CanvasList } from "@/components/canvas/canvas-list";

export const metadata: Metadata = { title: "Canvas" };

export default function Page() {
  return <CanvasList />;
}
