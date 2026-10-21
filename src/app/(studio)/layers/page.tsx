import type { Metadata } from "next";
import { LayersProjects } from "@/components/layers/projects-view";

export const metadata: Metadata = { title: "Layers" };

export default function Page() {
  return <LayersProjects />;
}
