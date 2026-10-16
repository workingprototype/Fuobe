import type { Metadata } from "next";
import { CharactersView } from "@/components/characters-view";

export const metadata: Metadata = { title: "Characters" };

export default function Page() {
  return <CharactersView />;
}
