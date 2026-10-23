import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ShortsSessionView } from "@/components/shorts/session-view";
import { recordExists } from "@/server/records";

export const metadata: Metadata = { title: "Your short" };

async function Session({ params }: { params: PageProps<"/shorts/[id]">["params"] }) {
  const { id } = await params;
  if (!recordExists({ kind: "shorts", ids: [id] })) notFound();
  return <ShortsSessionView id={id} />;
}

export default function Page({ params }: PageProps<"/shorts/[id]">) {
  return (
    <Suspense fallback={null}>
      <Session params={params} />
    </Suspense>
  );
}
