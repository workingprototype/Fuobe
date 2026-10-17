import type { Metadata } from "next";
import { Suspense } from "react";
import { ElementStudio } from "@/components/element-studio";
import { StudioSkeleton } from "@/components/skeletons";

export const metadata: Metadata = { title: "Element" };

async function Studio({ params }: { params: PageProps<"/elements/[id]">["params"] }) {
  const { id } = await params;
  return <ElementStudio id={id} />;
}

export default function Page({ params }: PageProps<"/elements/[id]">) {
  return (
    <Suspense fallback={<StudioSkeleton />}>
      <Studio params={params} />
    </Suspense>
  );
}
