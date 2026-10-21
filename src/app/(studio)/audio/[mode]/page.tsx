import type { Metadata } from "next";
import { hubMetadata, HubModePage, hubParams } from "@/components/studio/mode-switch-studio";

export function generateStaticParams() {
  return hubParams("audio");
}

export async function generateMetadata({ params }: PageProps<"/audio/[mode]">): Promise<Metadata> {
  return hubMetadata("audio", (await params).mode);
}

export default function Page({ params }: PageProps<"/audio/[mode]">) {
  return <HubModePage kind="audio" params={params} />;
}
