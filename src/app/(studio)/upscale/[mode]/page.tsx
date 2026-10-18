import type { Metadata } from "next";
import { hubMetadata, HubModePage, hubParams } from "@/components/studio/mode-switch-studio";

export function generateStaticParams() {
  return hubParams("upscale");
}

export async function generateMetadata({ params }: PageProps<"/upscale/[mode]">): Promise<Metadata> {
  return hubMetadata("upscale", (await params).mode);
}

export default function Page({ params }: PageProps<"/upscale/[mode]">) {
  return <HubModePage kind="upscale" params={params} />;
}
