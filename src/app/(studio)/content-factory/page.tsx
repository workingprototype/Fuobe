import type { Metadata } from "next";
import { ContentFactoryHome } from "@/components/content-factory/home";
import { getModel } from "@/lib/catalog";
import { pickerData } from "@/lib/catalog/faceless";

export const metadata: Metadata = { title: "Content Factory" };

export default function Page() {
  return <ContentFactoryHome voices={pickerData(getModel).voices} />;
}
