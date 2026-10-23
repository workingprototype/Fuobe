import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EpisodeView } from "@/components/faceless/episode-view";
import { recordExists } from "@/server/records";

export const metadata: Metadata = { title: "Episode" };

async function Episode({ params }: { params: PageProps<"/faceless/[id]/[episode]">["params"] }) {
  const { id, episode } = await params;
  if (!recordExists({ kind: "episode", ids: [id, episode] })) notFound();
  return <EpisodeView id={episode} backHref={`/faceless/${id}`} backLabel="Channel" />;
}

export default function Page({ params }: PageProps<"/faceless/[id]/[episode]">) {
  return (
    <Suspense fallback={null}>
      <Episode params={params} />
    </Suspense>
  );
}
