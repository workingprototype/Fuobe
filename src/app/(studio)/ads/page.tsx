import type { Metadata } from "next";
import { AdsHome } from "@/components/ads/ads-home";

export const metadata: Metadata = { title: "Ads Studio" };

export default function Page() {
  return <AdsHome />;
}
