import type { Metadata } from "next";
import { MoodboardsView } from "@/components/moodboards/moodboards-view";

export const metadata: Metadata = { title: "Moodboards" };

export default function Page() {
  return <MoodboardsView />;
}
