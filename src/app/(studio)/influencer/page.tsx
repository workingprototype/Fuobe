import type { Metadata } from "next";
import { InfluencerBuilder } from "@/components/influencer/influencer-builder";

export const metadata: Metadata = { title: "AI Influencer" };

export default function Page() {
  return <InfluencerBuilder />;
}
