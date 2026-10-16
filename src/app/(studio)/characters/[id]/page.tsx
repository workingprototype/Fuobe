import type { Metadata } from "next";
import { Suspense } from "react";
import { CharacterStudio } from "@/components/characters-view";

export const metadata: Metadata = { title: "Character" };

async function Studio({ params }: { params: PageProps<"/characters/[id]">["params"] }) {
  const { id } = await params;
  return <CharacterStudio id={id} />;
}

export default function Page({ params }: PageProps<"/characters/[id]">) {
  return (
    <Suspense fallback={null}>
      <Studio params={params} />
    </Suspense>
  );
}
