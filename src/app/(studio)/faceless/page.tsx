import type { Metadata } from "next";
import { FacelessHome } from "@/components/faceless/faceless-home";

export const metadata: Metadata = { title: "Faceless Studio" };

export default function Page() {
  return <FacelessHome />;
}
