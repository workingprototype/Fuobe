import type { Metadata } from "next";
import { StoryboardView } from "@/components/storyboard-view";

export const metadata: Metadata = { title: "Storyboard" };

export default function Page() {
  return <StoryboardView />;
}
