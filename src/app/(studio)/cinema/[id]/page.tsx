import type { Metadata } from "next";
import { Suspense } from "react";
import { CinemaWorkspace } from "@/components/cinema/workspace";

export const metadata: Metadata = { title: "Cinema Studio" };

async function Workspace({ params }: { params: PageProps<"/cinema/[id]">["params"] }) {
  const { id } = await params;
  return <CinemaWorkspace id={id} />;
}

export default function Page({ params }: PageProps<"/cinema/[id]">) {
  return (
    <Suspense fallback={null}>
      <Workspace params={params} />
    </Suspense>
  );
}
