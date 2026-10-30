import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChannelView } from "@/components/faceless/channel-view";
import { getModel } from "@/lib/catalog";
import { pickerData } from "@/lib/catalog/faceless";
import { pageRecordVisible } from "@/server/record-page";

export const metadata: Metadata = { title: "Faceless channel" };

async function Channel({ params }: { params: PageProps<"/faceless/[id]">["params"] }) {
  const { id } = await params;
  if (!(await pageRecordVisible({ kind: "channel", ids: [id] }))) notFound();
  return <ChannelView id={id} picker={pickerData(getModel)} />;
}

export default function Page({ params }: PageProps<"/faceless/[id]">) {
  return (
    <Suspense fallback={null}>
      <Channel params={params} />
    </Suspense>
  );
}
