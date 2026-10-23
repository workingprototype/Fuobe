import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ElementStudio } from "@/components/element-studio";
import { StudioSkeleton } from "@/components/skeletons";
import { recordExists } from "@/server/records";

export const metadata: Metadata = { title: "Element" };

async function Studio({ params }: { params: PageProps<"/elements/[id]">["params"] }) {
  const { id } = await params;
  if (!recordExists({ kind: "element", ids: [id] })) notFound();
  return <ElementStudio id={id} />;
}

export default function Page({ params }: PageProps<"/elements/[id]">) {
  return (
    <Suspense fallback={<StudioSkeleton />}>
      <Studio params={params} />
    </Suspense>
  );
}
