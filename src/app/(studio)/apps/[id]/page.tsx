import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StudioPage } from "@/components/studio/studio-page";
import { APPS, getPreset } from "@/lib/catalog";
import { appStudio } from "@/lib/studios";

export function generateStaticParams() {
  return APPS.map((a) => ({ id: a.id }));
}

export async function generateMetadata({ params }: PageProps<"/apps/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: getPreset(id)?.name ?? "App" };
}

async function AppStudio({ params }: { params: PageProps<"/apps/[id]">["params"] }) {
  const { id } = await params;
  const preset = getPreset(id);
  if (!preset || preset.type !== "app") notFound();
  return <StudioPage config={appStudio(preset)} />;
}

export default function Page({ params }: PageProps<"/apps/[id]">) {
  return (
    <Suspense fallback={null}>
      <AppStudio params={params} />
    </Suspense>
  );
}
