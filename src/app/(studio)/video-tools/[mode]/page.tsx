import type { Metadata } from "next";
import { hubMetadata, HubModePage, hubParams } from "@/components/studio/mode-switch-studio";

export function generateStaticParams() {
  return hubParams("video-tools");
}

export async function generateMetadata({ params }: PageProps<"/video-tools/[mode]">): Promise<Metadata> {
  return hubMetadata("video-tools", (await params).mode);
}

export default function Page({ params }: PageProps<"/video-tools/[mode]">) {
  return <HubModePage kind="video-tools" params={params} />;
}
