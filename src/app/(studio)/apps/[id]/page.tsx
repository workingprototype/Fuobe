import type { Metadata } from "next";
import { notFound } from "next/navigation";
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

export default async function Page({ params }: PageProps<"/apps/[id]">) {
  const { id } = await params;
  const preset = getPreset(id);
  if (!preset || preset.type !== "app") notFound();
  return <StudioPage config={appStudio(preset)} />;
}
