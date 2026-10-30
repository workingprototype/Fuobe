import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CinemaWorkspace } from "@/components/cinema/workspace";
import { pageRecordVisible } from "@/server/record-page";

export const metadata: Metadata = { title: "Cinema Studio" };

async function Workspace({ params }: { params: PageProps<"/cinema/[id]">["params"] }) {
  const { id } = await params;
  if (!(await pageRecordVisible({ kind: "cinema", ids: [id] }))) notFound();
  return <CinemaWorkspace id={id} />;
}

export default function Page({ params }: PageProps<"/cinema/[id]">) {
  return (
    <Suspense fallback={null}>
      <Workspace params={params} />
    </Suspense>
  );
}
