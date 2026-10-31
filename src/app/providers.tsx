"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { GuestPrompt } from "@/components/guest-prompt";
import { AUTH_CHANNEL } from "@/lib/api";

/** The GPU pre-flight's guided fix: loaded after the page, listening for "fuobe:gpu-setup". */
const GuidedFixHost = dynamic(() => import("@/components/gpu/guided-fix").then((m) => m.GuidedFixHost), { ssr: false });
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 } } }),
  );
  // Signed in or out in another tab: this one asks who is looking again (its sidebar, its studios' refusals).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(AUTH_CHANNEL);
    c.onmessage = () => {
      void client.invalidateQueries({ queryKey: ["viewer"] });
      void client.invalidateQueries({ queryKey: ["status"] });
    };
    return () => c.close();
  }, [client]);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster position="top-center" gap={8} offset={29} />
          <GuestPrompt />
          <GuidedFixHost />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
