import type { Metadata } from "next";
import { Suspense } from "react";
import { EpisodeView } from "@/components/faceless/episode-view";

export const metadata: Metadata = { title: "Episode" };

async function Episode({ params }: { params: PageProps<"/faceless/[id]/[episode]">["params"] }) {
  const { id, episode } = await params;
  return <EpisodeView id={episode} backHref={`/faceless/${id}`} backLabel="Channel" />;
}

export default function Page({ params }: PageProps<"/faceless/[id]/[episode]">) {
  return (
    <Suspense fallback={null}>
      <Episode params={params} />
    </Suspense>
  );
}
