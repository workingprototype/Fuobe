import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandWorkspace } from "@/components/ads/brand-workspace";

export const metadata: Metadata = { title: "Ads Studio" };

async function Workspace({ params }: { params: PageProps<"/ads/[brandId]">["params"] }) {
  const { brandId } = await params;
  return <BrandWorkspace brandId={brandId} />;
}

export default function Page({ params }: PageProps<"/ads/[brandId]">) {
  return (
    <Suspense fallback={null}>
      <Workspace params={params} />
    </Suspense>
  );
}
