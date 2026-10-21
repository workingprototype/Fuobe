import type { Metadata } from "next";
import { CinemaProjects } from "@/components/cinema/projects-view";

export const metadata: Metadata = { title: "Cinema Studio" };

export default function Page() {
  return <CinemaProjects />;
}
