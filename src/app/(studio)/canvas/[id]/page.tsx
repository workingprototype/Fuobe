import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CanvasEditor } from "@/components/canvas/canvas-editor";
import { pageRecordVisible } from "@/server/record-page";

export const metadata: Metadata = { title: "Canvas" };

async function Editor({ params }: { params: PageProps<"/canvas/[id]">["params"] }) {
  const { id } = await params;
  if (!(await pageRecordVisible({ kind: "canvas", ids: [id] }))) notFound();
  return <CanvasEditor id={id} />;
}

export default function Page({ params }: PageProps<"/canvas/[id]">) {
  return (
    <Suspense fallback={null}>
      <Editor params={params} />
    </Suspense>
  );
}
