import type { Metadata } from "next";
import { GenjutsuStudio } from "@/components/genjutsu/genjutsu-studio";

export const metadata: Metadata = { title: "Genjutsu" };

export default function Page() {
  return <GenjutsuStudio />;
}
