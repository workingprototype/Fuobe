import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Studio } from "@/components/studio/studio";
import { APPS, getPreset } from "@/lib/catalog";
import { appStudio } from "@/lib/studios";

export function generateStaticParams() {
  return APPS.map((a) => ({ id: a.id }));
}

export async function generateMetadata({ params }: PageProps<"/apps/[id]">): Promise<Metadata> {
  const { id } = await params;
  const preset = getPreset(id);
  return { title: preset?.type === "app" ? preset.name : "Not found" };
}

async function AppStudio({ params }: { params: PageProps<"/apps/[id]">["params"] }) {
  const { id } = await params;
  const preset = getPreset(id);
  if (!preset || preset.type !== "app") notFound();
  return <Studio config={appStudio(preset)} />;
}

export default function Page({ params }: PageProps<"/apps/[id]">) {
  return (
    <Suspense fallback={null}>
      <AppStudio params={params} />
    </Suspense>
  );
}
