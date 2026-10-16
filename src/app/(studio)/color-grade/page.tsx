import type { Metadata } from "next";
import { ColorGradeView } from "@/components/color-grade-view";

export const metadata: Metadata = { title: "Color grading" };

export default function Page() {
  return <ColorGradeView />;
}
