import type { Metadata } from "next";
import { ViralityStudio } from "@/components/virality/virality-studio";

export const metadata: Metadata = { title: "Virality predictor" };

export default function Page() {
  return <ViralityStudio />;
}
