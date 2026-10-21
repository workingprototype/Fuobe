import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectView } from "@/components/assist/project-view";

export const metadata: Metadata = { title: "Project" };

async function Project({ params }: { params: PageProps<"/assist/projects/[id]">["params"] }) {
  const { id } = await params;
  return <ProjectView id={id} />;
}

export default function Page({ params }: PageProps<"/assist/projects/[id]">) {
  return (
    <Suspense fallback={null}>
      <Project params={params} />
    </Suspense>
  );
}
