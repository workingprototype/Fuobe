"use client";

import { YourGpu } from "@/components/gpu/your-gpu";
import { useViewer } from "@/lib/api";

/** Settings for an account (public sign-up): "Your GPU", at the top of the page. Nothing for the owner or a guest. */
export function AccountGpuSection() {
  const account = useViewer().data?.account;
  if (!account) return null;
  return (
    <section id="your-gpu" aria-labelledby="your-gpu-title" className="grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-6 border-b py-8 md:scroll-mt-20 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="your-gpu-title" className="text-[15px] font-semibold">
          Your GPU
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Signed in as {account.email}. Connect your own ComfyUI to run open-source models.</p>
      </div>
      <YourGpu />
    </section>
  );
}
