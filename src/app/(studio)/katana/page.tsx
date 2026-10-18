import type { Metadata } from "next";
import { KatanaStudio } from "@/components/katana/katana-studio";

export const metadata: Metadata = { title: "Katana" };

export default function Page() {
  return <KatanaStudio />;
}
