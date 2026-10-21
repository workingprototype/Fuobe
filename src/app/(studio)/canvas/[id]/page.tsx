import type { Metadata } from "next";
import { Suspense } from "react";
import { CanvasEditor } from "@/components/canvas/canvas-editor";

export const metadata: Metadata = { title: "Canvas" };

async function Editor({ params }: { params: PageProps<"/canvas/[id]">["params"] }) {
  const { id } = await params;
  return <CanvasEditor id={id} />;
}

export default function Page({ params }: PageProps<"/canvas/[id]">) {
  return (
    <Suspense fallback={null}>
      <Editor params={params} />
    </Suspense>
  );
}
