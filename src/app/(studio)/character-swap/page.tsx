import type { Metadata } from "next";
import { SwapStudioHome } from "@/components/swap-studio/home";

export const metadata: Metadata = { title: "Character Swap Studio" };

export default function Page() {
  return <SwapStudioHome />;
}
