import type { Metadata } from "next";
import { CharacterStudio } from "@/components/characters-view";

export const metadata: Metadata = { title: "Character" };

export default async function Page({ params }: PageProps<"/characters/[id]">) {
  const { id } = await params;
  return <CharacterStudio id={id} />;
}
