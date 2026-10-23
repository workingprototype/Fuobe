import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EpisodeView } from "@/components/faceless/episode-view";
import { recordExists } from "@/server/records";

export const metadata: Metadata = { title: "Explainer" };

async function Explainer({ params }: { params: PageProps<"/explainer/[id]">["params"] }) {
  const { id } = await params;
  if (!recordExists({ kind: "explainer", ids: [id] })) notFound();
  return <EpisodeView id={id} backHref="/explainer" backLabel="Explainer" />;
}

export default function Page({ params }: PageProps<"/explainer/[id]">) {
  return (
    <Suspense fallback={null}>
      <Explainer params={params} />
    </Suspense>
  );
}
