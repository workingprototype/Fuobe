import type { Metadata } from "next";
import { Suspense } from "react";
import { EpisodeWizard } from "@/components/faceless/episode-wizard";
import { getModel } from "@/lib/catalog";
import { pickerData } from "@/lib/catalog/faceless";

export const metadata: Metadata = { title: "New episode" };

async function Wizard({ params }: { params: PageProps<"/faceless/[id]/new">["params"] }) {
  const { id } = await params;
  return <EpisodeWizard channelId={id} picker={pickerData(getModel)} />;
}

export default function Page({ params }: PageProps<"/faceless/[id]/new">) {
  return (
    <Suspense fallback={null}>
      <Wizard params={params} />
    </Suspense>
  );
}
