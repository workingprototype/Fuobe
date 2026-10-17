import type { Metadata } from "next";
import { Suspense } from "react";
import { AssistView } from "@/components/assist-view";

export const metadata: Metadata = { title: "Assist" };

export default function Page() {
  return (
    <Suspense>
      <AssistView />
    </Suspense>
  );
}
