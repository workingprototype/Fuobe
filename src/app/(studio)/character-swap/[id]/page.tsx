import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SwapWorkbench } from "@/components/swap-studio/workbench";
import { recordExists } from "@/server/records";

export const metadata: Metadata = { title: "Character Swap" };

async function Project({ params }: { params: PageProps<"/character-swap/[id]">["params"] }) {
  const { id } = await params;
  if (!recordExists({ kind: "swap-project", ids: [id] })) notFound();
  return <SwapWorkbench id={id} />;
}

export default function Page({ params }: PageProps<"/character-swap/[id]">) {
  return (
    <Suspense fallback={null}>
      <Project params={params} />
    </Suspense>
  );
}
