import type { Metadata } from "next";
import { PhotodumpView } from "@/components/photodump/photodump-view";

export const metadata: Metadata = { title: "Photodump" };

export default function Page() {
  return <PhotodumpView />;
}
