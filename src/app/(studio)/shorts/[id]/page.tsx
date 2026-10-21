import type { Metadata } from "next";
import { Suspense } from "react";
import { ShortsSessionView } from "@/components/shorts/session-view";

export const metadata: Metadata = { title: "Your short" };

async function Session({ params }: { params: PageProps<"/shorts/[id]">["params"] }) {
  const { id } = await params;
  return <ShortsSessionView id={id} />;
}

export default function Page({ params }: PageProps<"/shorts/[id]">) {
  return (
    <Suspense fallback={null}>
      <Session params={params} />
    </Suspense>
  );
}
